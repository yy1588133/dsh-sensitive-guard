/**
 * 出站网络：给 Jev 客户端提供一个能在中国大陆直连环境下工作的 fetch。
 *
 * 背景（实测，2026-11）：从云南移动出口直连 `api.typesafe.ai` 会被 Cloudflare 按
 * 地域判到 LHR 并返回 HTTP 451「Typesafe is not available in your region」；
 * 走本地 HTTP 代理后落到 NRT，同一个 key 返回 200。所以这里自带一个零依赖的
 * CONNECT 隧道，不依赖宿主一定配了代理。
 *
 * 判定顺序：显式配置 → 环境变量 → Windows 系统代理 → 直连。
 * 回环目标与 no_proxy 命中项、以及非 https 目标一律走全局 fetch，
 * 让宿主自己的 `dsh-http-proxy` 有机会接管。
 *
 * @module dsh-decision-guard/net
 */

import { execFileSync } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'

/** Windows 系统代理缓存，避免每次请求都起一个 reg.exe。 */
let systemProxyCache
const SYSTEM_PROXY_TTL = 30_000

/**
 * 把 `host:port` / `http://host:port` 规范化。
 * @param {unknown} value 原始值
 * @returns {{ host: string; port: number; url: string; auth?: string; protocol: string } | undefined} 解析结果
 */
function normalizeProxy(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length === 0) return undefined
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text) ? text : `http://${text}`
  let url
  try {
    url = new URL(withScheme)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.hostname.length === 0) return undefined
  const auth =
    url.username.length > 0 ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}` : undefined
  return {
    host: url.hostname,
    port: url.port.length > 0 ? Number(url.port) : url.protocol === 'https:' ? 443 : 80,
    url: `${url.protocol}//${url.host}`,
    ...(auth === undefined ? {} : { auth }),
    protocol: url.protocol,
  }
}

/**
 * `ProxyServer` 可能是 `127.0.0.1:7890` 或 `http=x;https=y`；优先 https。
 * @param {unknown} raw 原始注册表值
 * @returns {string | undefined} 选中的代理
 */
function pickProxyServer(raw) {
  const entries = String(raw)
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  /** @type {string | undefined} */
  let httpEntry
  /** @type {string | undefined} */
  let httpsEntry
  for (const entry of entries) {
    const at = entry.indexOf('=')
    if (at < 0) {
      httpEntry ??= entry
      continue
    }
    const scheme = entry.slice(0, at).trim().toLowerCase()
    const value = entry.slice(at + 1).trim()
    if (scheme === 'https') httpsEntry = value
    else if (scheme === 'http') httpEntry = value
  }
  return httpsEntry ?? httpEntry
}

/**
 * 读 HKCU 的 ProxyEnable / ProxyServer；非 Windows 或关闭时返回 undefined。
 * @returns {string | undefined} 系统代理
 */
function readSystemProxy() {
  if (process.platform !== 'win32') return undefined
  const now = Date.now()
  if (systemProxyCache !== undefined && now - systemProxyCache.at < SYSTEM_PROXY_TTL) return systemProxyCache.value
  /** @type {string | undefined} */
  let value
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    const enabled = execFileSync('reg', ['query', key, '/v', 'ProxyEnable'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabled)) {
      const server = execFileSync('reg', ['query', key, '/v', 'ProxyServer'], {
        encoding: 'utf8',
        windowsHide: true,
      })
      const match = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(server)
      if (match !== null) value = pickProxyServer(match[1].trim())
    }
  } catch {
    value = undefined
  }
  systemProxyCache = { at: now, value }
  return value
}

/**
 * 解析本次请求该走哪个代理。
 * @param {string} configured 面板里显式填写的代理
 * @returns {{ host: string; port: number; url: string; auth?: string; protocol: string; source: string } | undefined} 代理或直连
 */
export function resolveProxyTarget(configured) {
  const explicit = normalizeProxy(configured)
  if (explicit !== undefined) return { ...explicit, source: 'config' }
  for (const name of ['https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY', 'http_proxy', 'HTTP_PROXY']) {
    const parsed = normalizeProxy(process.env[name])
    if (parsed !== undefined) return { ...parsed, source: 'env' }
  }
  const system = normalizeProxy(readSystemProxy())
  if (system !== undefined) return { ...system, source: 'system' }
  return undefined
}

/** @param {string} hostname 主机名 */
function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

/**
 * 简单 no_proxy 匹配：`*`、精确主机、后缀 `.example.com`、可带端口。
 * @param {string} hostname 主机
 * @param {number} port 端口
 * @returns {boolean} 是否绕过代理
 */
function bypassedByNoProxy(hostname, port) {
  const raw = process.env['no_proxy'] ?? process.env['NO_PROXY'] ?? ''
  if (raw.trim().length === 0) return false
  const host = hostname.toLowerCase()
  for (const entry of raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)) {
    if (entry === '*') return true
    const [patternHost, patternPort] = entry.split(':')
    if (patternPort !== undefined && patternPort.length > 0 && patternPort !== String(port)) continue
    if (patternHost === host) return true
    if (patternHost.startsWith('.') && (host === patternHost.slice(1) || host.endsWith(patternHost))) return true
    if (!patternHost.startsWith('.') && host.endsWith(`.${patternHost}`)) return true
  }
  return false
}

/** @returns {Error} 一个标准的 AbortError */
function abortError() {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

/**
 * 经 HTTP 代理建 CONNECT 隧道，返回已完成 TLS 握手的 socket。
 * @param {{ host: string; port: number; auth?: string; protocol?: string }} proxy 代理
 * @param {{ hostname: string; port: string }} target 目标
 * @param {AbortSignal | undefined} signal 取消信号
 * @returns {Promise<import('node:tls').TLSSocket>} 已握手的 socket
 */
function openTunnel(proxy, target, signal) {
  return new Promise((resolve, reject) => {
    const host = target.hostname
    const port = target.port.length > 0 ? target.port : '443'
    /** @type {Record<string, string>} */
    const headers = { host: `${host}:${port}` }
    if (proxy.auth !== undefined) headers['proxy-authorization'] = `Basic ${Buffer.from(proxy.auth).toString('base64')}`
    // 代理本身可以是 https://（TLS 上的 CONNECT）；用 http 去连它的 443 端口只会握手失败。
    const request = (proxy.protocol === 'https:' ? https : http).request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers,
      agent: false,
    })
    const cleanup = () => {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      request.destroy()
      reject(abortError())
    }
    if (signal !== undefined) {
      if (signal.aborted) {
        request.destroy()
        reject(abortError())
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    request.once('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        cleanup()
        socket.destroy()
        reject(new Error(`proxy CONNECT failed: ${String(response.statusCode)}`))
        return
      }
      const secure = tls.connect({ socket, servername: host, ALPNProtocols: ['http/1.1'] }, () => {
        cleanup()
        resolve(secure)
      })
      secure.once('error', (error) => {
        cleanup()
        reject(error)
      })
    })
    request.once('error', (error) => {
      cleanup()
      reject(signal?.aborted === true ? abortError() : error)
    })
    request.end()
  })
}

/**
 * 生成给 Jev 客户端用的 fetch。
 * @param {() => { host: string; port: number; auth?: string } | undefined} resolveProxy 每次请求现解一次代理，配置改了立刻生效
 * @returns {typeof fetch} 与 fetch 同形状的函数
 */
export function createFetchFn(resolveProxy) {
  return async function guardFetch(url, init = {}) {
    const target = new URL(url)
    const proxy = resolveProxy()
    const port = target.port.length > 0 ? Number(target.port) : target.protocol === 'https:' ? 443 : 80
    if (
      proxy === undefined ||
      isLoopbackHost(target.hostname) ||
      bypassedByNoProxy(target.hostname, port) ||
      target.protocol !== 'https:'
    ) {
      return await fetch(url, init)
    }
    const secure = await openTunnel(proxy, target, init.signal)
    try {
      return await new Promise((resolve, reject) => {
        /** @type {Record<string, string>} */
        const headers = { ...(init.headers ?? {}) }
        if (typeof init.body === 'string' && headers['content-length'] === undefined) {
          headers['content-length'] = String(Buffer.byteLength(init.body))
        }
        const agent = new https.Agent({ keepAlive: false })
        agent.createConnection = (_options, callback) => {
          callback(null, secure)
          return undefined
        }
        const request = https.request(
          {
            host: target.hostname,
            port,
            path: `${target.pathname}${target.search}`,
            method: init.method ?? 'GET',
            headers,
            agent,
          },
          (response) => {
            /** @type {Buffer[]} */
            const chunks = []
            response.on('data', (chunk) => chunks.push(chunk))
            response.once('end', () => {
              const body = Buffer.concat(chunks)
              const status = response.statusCode ?? 0
              resolve({
                status,
                ok: status >= 200 && status < 300,
                headers: response.headers,
                text: async () => body.toString('utf8'),
                json: async () => JSON.parse(body.toString('utf8')),
              })
            })
            response.once('error', reject)
          },
        )
        const onAbort = () => {
          request.destroy()
          reject(abortError())
        }
        // 请求结束后摘掉监听：调用方可能复用同一个 signal，留着会越积越多。
        const cleanup = () => {
          init.signal?.removeEventListener('abort', onAbort)
        }
        request.once('close', cleanup)
        if (init.signal !== undefined) {
          if (init.signal.aborted) {
            request.destroy()
            reject(abortError())
            return
          }
          init.signal.addEventListener('abort', onAbort, { once: true })
        }
        request.once('error', reject)
        request.end(typeof init.body === 'string' ? init.body : undefined)
      })
    } finally {
      secure.destroy()
    }
  }
}
