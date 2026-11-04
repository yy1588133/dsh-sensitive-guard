/**
 * 面板路由的挂载时机。
 *
 * 复现的现场：DSH 启动时各插件的 fiber 并行初始化，`webServer` 未必比本插件早
 * 就绪。插件若在 `ctx.effect()` 里用一次性的 `ctx.get('webServer')` 取服务，取不到
 * 就直接 return，路由永远不会补挂——设置面板随后读到 HTTP 404。
 *
 * 期望：服务晚到也能挂上；服务消失时能收干净。这里用最小假上下文模拟 cordis
 * 的 `inject` / `get` 语义，不依赖 DSH 本体。
 * 用法：node test/web-route-timing.mjs
 */

import assert from 'node:assert/strict'
import { apply } from '../index.js'

/**
 * 最小 cordis 上下文：只实现插件用到的那几样。
 * `inject(deps, cb)` 在 deps 全部就绪时执行，并记录 disposer——与
 * `@deepseek-ai/cordis` 的 `ctx.inject` 语义一致（服务未就绪不会调用）。
 */
function makeHarness() {
  /** @type {Map<string, unknown>} */
  const services = new Map()
  /** @type {Array<{ deps: string[], callback: Function, active: boolean, dispose?: Function }>} */
  const injectors = []
  /** @type {Array<{ kind: string, path: string, handler: Function }>} */
  const routes = []
  const listeners = []

  const flush = () => {
    for (const item of injectors) {
      if (item.active) continue
      if (!item.deps.every((dep) => services.has(dep))) continue
      item.active = true
      item.dispose = item.callback(ctx)
    }
  }

  const ctx = {
    get(name) {
      return services.get(name)
    },
    /** cordis 里服务也能直接当属性用；这里照做，否则 ctx.tools.register 拿不到。 */
    get tools() {
      return services.get('tools')
    },
    on(event) {
      listeners.push(event)
      return () => {}
    },
    effect(fn) {
      const dispose = fn()
      return () => (typeof dispose === 'function' ? dispose() : undefined)
    },
    inject(deps, callback) {
      injectors.push({ deps: [...deps], callback, active: false })
      flush()
    },
    logger: { warn() {}, info() {}, error() {} },
  }

  const server = {
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }

  return {
    ctx,
    routes,
    listeners,
    /** 模拟某个服务就绪。 @param {string} name 服务名 @param {unknown} value 值 */
    provide(name, value) {
      services.set(name, value)
      flush()
    },
    /** 模拟某个服务下线。 @param {string} name 服务名 */
    retract(name) {
      services.delete(name)
      for (const item of injectors) {
        if (!item.active) continue
        item.active = false
        try {
          item.dispose?.()
        } catch {
          /* 已经收过了 */
        }
        item.dispose = undefined
      }
    },
    server,
  }
}

let passed = 0
/** @param {string} name 用例名 @param {() => void} body 断言体 */
function test(name, body) {
  try {
    body()
    passed += 1
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

const EXPECTED = ['/sensitive-guard/api/select', '/sensitive-guard/api/config', '/sensitive-guard/api/rules', '/sensitive-guard/api/test', '/sensitive-guard/api/log'].sort()

test('服务未就绪时不注册路由、也不影响守卫钩子', () => {
  const h = makeHarness()
  h.provide('tools', { register: () => () => {} })
  apply(h.ctx)
  assert.equal(h.routes.length, 0, 'webServer 还没就绪，不该有路由')
  assert.ok(h.listeners.includes('tools/pre-execute'), '命令守卫必须照常挂上')
})

test('webServer 晚于插件就绪时，路由要补挂上来', () => {
  const h = makeHarness()
  h.provide('tools', { register: () => () => {} })
  apply(h.ctx)
  h.provide('webServer', h.server)
  assert.deepEqual(
    h.routes.map((route) => route.path).sort(),
    EXPECTED,
    '四条面板接口都应该挂上',
  )
  assert.ok(h.routes.every((route) => route.kind === 'exact'), '路由类型应为 exact')
})

test('webServer 先就绪时照常挂上', () => {
  const h = makeHarness()
  h.provide('tools', { register: () => () => {} })
  h.provide('webServer', h.server)
  apply(h.ctx)
  assert.deepEqual(h.routes.map((route) => route.path).sort(), EXPECTED)
})

test('webServer 下线后路由要收干净，恢复后重新挂上', () => {
  const h = makeHarness()
  h.provide('tools', { register: () => () => {} })
  h.provide('webServer', h.server)
  apply(h.ctx)
  assert.equal(h.routes.length, 5)
  h.retract('webServer')
  assert.equal(h.routes.length, 0, '服务下线后不该留下悬空路由')
  h.provide('webServer', h.server)
  assert.equal(h.routes.length, 5, '服务恢复后要重新挂上')
})

console.log(`web-route-timing: ${passed} 通过`)
if (process.exitCode === 1) process.exit(1)