/**
 * Jev（TypeSafe System One）决策客户端。
 *
 * 与 snow-app 的 `native/src/api/decision_model.rs` 对齐的三点：
 * 1. 请求体是 `{ model, state, questions }`，问题类型 `choice`（带 criteria）、
 *    理由分类也用 choice、风险等级用 `score`（原版是 `levels`，Jev 这边是
 *    按顺序的 `criteria`，响应回 `score` + `probabilities`）。
 * 2. 只有明确的 `allow` 才可能放行；`verdict` 缺失、类型不符、请求失败一律算
 *    「不可用」，由调用方回退到人工确认，绝不因为判不清就放过。
 * 3. 会话片段按「最新优先」塞到 state 的预算内，超出预算从最旧的开始丢。
 *
 * 与那版的差异：这里是 JS 侧的独立实现，额外带 LRU 缓存、失败冷却与并发上限，
 * 让 provider 挂掉时的代价是「回到原生行为」，而不是把工具调用拖死。
 *
 * @module dsh-decision-guard/jev
 */

import { createHash } from 'node:crypto'
import { createFetchFn, resolveProxyTarget } from './net.js'

/** 风险等级：低 → 高，顺序即档位序号。 */
export const SEVERITY_LEVELS = [
  [
    'low',
    'Harmless or trivially undone: it only reads, touches generated or regenerable artifacts, or makes small edits inside the working directory',
  ],
  [
    'medium',
    'Bounded damage that takes effort to recover: project files, local data or environment state could be lost or changed, but it stays recoverable (version control, reinstall, rebuild)',
  ],
  [
    'high',
    'Severe or irreversible: unrecoverable data loss, paths outside the working directory, system-wide changes, or data published or sent off this machine',
  ],
]

/** 理由分类的稳定 key，界面负责本地化。 */
export const REASON_CATEGORIES = [
  ['readOnly', 'Only reads information; files, system state and remote state stay untouched'],
  ['regenerable', 'Touches only generated or regenerable artifacts (build output, caches, temporary files, dependencies)'],
  ['scopedChange', 'Changes stay inside the working directory and can be undone (edit, rename, move)'],
  ['dataLoss', 'Deletes or overwrites data that cannot be recovered'],
  ['systemState', 'Changes system or environment state (permissions, packages, services, processes)'],
  ['externalEffect', 'Publishes or sends data outside this machine (git push, upload, network write)'],
  ['unclear', 'The target or the blast radius of the command is unclear'],
]

/** 答案缺失或选项未知时回退的理由分类。 */
export const REASON_UNKNOWN = 'unclear'

/** 单次请求里 state 的字符预算（与原版 TypeSafe 档位一致）。 */
const MAX_STATE_CHARS = 48_000

/** 错误分类。 */
export class JevError extends Error {
  /**
   * @param {'no-key'|'timeout'|'network'|'http'|'invalid-response'|'aborted'} code 失败类别
   * @param {string} message 人读的说明
   */
  constructor(code, message) {
    super(message)
    this.name = 'JevError'
    this.code = code
  }
}

/** 一个极简的 LRU：够用、无依赖、上限固定。 */
class LruCache {
  /**
   * @param {number} capacity 容量，0 表示不缓存
   */
  constructor(capacity) {
    this.capacity = capacity
    /** @type {Map<string, unknown>} */
    this.map = new Map()
  }

  /** @param {string} key 键 */
  get(key) {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key)
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  /**
   * @param {string} key 键
   * @param {unknown} value 值
   */
  set(key, value) {
    if (this.capacity <= 0) return
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next()
      if (oldest.done === true) break
      this.map.delete(oldest.value)
    }
  }
}

/** 连续失败到阈值后开门，成功一次就复位。 */
class CooldownGate {
  /**
   * @param {number} threshold 连续失败次数阈值
   * @param {number} cooldownMs 冷却时长
   */
  constructor(threshold, cooldownMs) {
    this.threshold = threshold
    this.cooldownMs = cooldownMs
    this.failures = 0
    this.until = 0
  }

  /** @returns {boolean} 是否处于冷却中 */
  open() {
    return Date.now() < this.until
  }

  /** @returns {boolean} 这次失败是否正好打开了冷却 */
  onFailure() {
    this.failures += 1
    if (this.failures < this.threshold) return false
    this.failures = 0
    this.until = Date.now() + this.cooldownMs
    return true
  }

  onSuccess() {
    this.failures = 0
  }
}

/** 有界并发信号量。 */
class Semaphore {
  /** @param {number} limit 上限 */
  constructor(limit) {
    this.limit = limit
    this.active = 0
    /** @type {Array<() => void>} */
    this.waiters = []
  }

  /**
   * @param {AbortSignal | undefined} signal 取消信号
   * @returns {Promise<boolean>} 是否拿到名额
   */
  async acquire(signal) {
    if (signal?.aborted === true) return false
    if (this.active < this.limit) {
      this.active += 1
      return true
    }
    return await new Promise((resolve) => {
      const grant = () => {
        this.active += 1
        signal?.removeEventListener('abort', onAbort)
        resolve(true)
      }
      const onAbort = () => {
        const index = this.waiters.indexOf(grant)
        if (index >= 0) this.waiters.splice(index, 1)
        resolve(false)
      }
      this.waiters.push(grant)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  release() {
    this.active = Math.max(0, this.active - 1)
    const next = this.waiters.shift()
    if (next !== undefined) next()
  }
}

/**
 * 从响应里校验答案。任何一处不合规都抛错——宁可回退人工，也不猜。
 * @param {unknown} body 响应体
 * @returns {Record<string, any>} 校验过的答案
 */
function parseAnswers(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new JevError('invalid-response', 'jev: 响应体不是对象')
  }
  /** @type {Record<string, any>} */
  const answers = {}
  for (const [id, raw] of Object.entries(body)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new JevError('invalid-response', `jev: 答案 "${id}" 不是对象`)
    }
    const record = /** @type {Record<string, unknown>} */ (raw)
    if (record['type'] === 'choice') {
      const probabilities = record['probabilities']
      if (typeof record['choice'] !== 'string' || typeof record['confidence'] !== 'number' || probabilities === null || typeof probabilities !== 'object') {
        throw new JevError('invalid-response', `jev: choice 答案 "${id}" 字段不全`)
      }
      answers[id] = {
        type: 'choice',
        choice: record['choice'],
        confidence: record['confidence'],
        probabilities,
      }
      continue
    }
    if (record['type'] === 'score') {
      if (typeof record['score'] !== 'number' || !Number.isFinite(record['score'])) {
        throw new JevError('invalid-response', `jev: score 答案 "${id}" 缺少 score`)
      }
      answers[id] = {
        type: 'score',
        score: record['score'],
        confidence: typeof record['confidence'] === 'number' ? record['confidence'] : 0,
        probabilities: record['probabilities'] !== null && typeof record['probabilities'] === 'object' ? record['probabilities'] : undefined,
      }
      continue
    }
    if (record['type'] === 'noul') {
      if (typeof record['noul'] !== 'number') {
        throw new JevError('invalid-response', `jev: noul 答案 "${id}" 缺少概率`)
      }
      answers[id] = { type: 'noul', noul: record['noul'] }
      continue
    }
    throw new JevError('invalid-response', `jev: 答案 "${id}" 类型未知`)
  }
  return answers
}

/**
 * 由 score 答案解析风险等级：取概率最大的档位，并列取更高档。
 *
 * Jev 的 score 题用有序 `criteria` 数组表达档位，返回的档位概率是
 * `{"0": p, "1": p, "2": p}` 这样的数字字符串 key（没有 label）；
 * 少数兼容实现会回 label，两种都认。
 * 解析失败不算失败，只是没有等级——verdict 照常生效。
 * @param {any} answer score 答案
 * @returns {{ severity: string; severityScore: number } | undefined} 等级
 */
function resolveSeverity(answer) {
  if (answer === undefined) return undefined
  /** @type {number[]} */
  const probabilities = new Array(SEVERITY_LEVELS.length).fill(0)
  /** @type {{ rank: number; probability: number } | undefined} */
  let best
  const raw = answer.probabilities
  if (raw !== null && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
      // 先按数字档位序号认，再按 label 认；都不认就跳过这一档。
      const asIndex = Number(key)
      const rank = Number.isInteger(asIndex)
        ? asIndex
        : SEVERITY_LEVELS.findIndex(([label]) => label === key)
      if (rank < 0 || rank >= SEVERITY_LEVELS.length) continue
      probabilities[rank] = value
      if (best === undefined || value > best.probability || (value === best.probability && rank > best.rank)) {
        best = { rank, probability: value }
      }
    }
  }
  if (best === undefined) {
    // 没有分布时退回 score 本身：四舍五入到最近的档位。
    const rank = Math.min(SEVERITY_LEVELS.length - 1, Math.max(0, Math.round(answer.score)))
    best = { rank, probability: 1 }
  }
  const total = probabilities.reduce((sum, value) => sum + value, 0)
  const severityScore =
    total > 0
      ? probabilities.reduce((sum, value, index) => sum + index * value, 0) / total
      : Math.min(SEVERITY_LEVELS.length - 1, Math.max(0, answer.score))
  return { severity: SEVERITY_LEVELS[best.rank][0], severityScore }
}

/** 一条会话消息的字数（按字符算，不做 token 估算）。 */
function conversationMessageChars(message) {
  const text = typeof message.text === 'string' ? message.text : ''
  let total = text.length
  if (Array.isArray(message.toolCalls)) {
    for (const call of message.toolCalls) {
      total += String(call?.name ?? '').length + String(call?.arguments ?? '').length + String(call?.output ?? '').length
    }
  }
  return total
}

/**
 * 从最新一条往前保留，直到超出预算。
 * @param {ReadonlyArray<object>} messages 时间正序
 * @param {number} budget 字符预算
 * @returns {{ kept: ReadonlyArray<object>; truncated: boolean }} 保留片段与是否丢过
 */
function fitConversation(messages, budget) {
  let used = 0
  let start = messages.length
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const cost = conversationMessageChars(messages[index])
    if (used + cost > budget) break
    used += cost
    start = index
  }
  return { kept: messages.slice(start), truncated: start > 0 }
}

/** 参数摘要：合法 JSON 保留结构，否则按字符串处理。 */
function toolArgumentsValue(argumentsText) {
  const trimmed = String(argumentsText ?? '').trim()
  if (trimmed === '') return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

/**
 * 构造 TypeSafe 的 state 结构（含可选的最近会话）。
 * @param {object} context 判定上下文
 * @returns {{ state: Record<string, unknown>; contextUsage: { messages: number; truncated: boolean; empty: boolean } | undefined }} 请求体片段
 */
function buildState(context) {
  /** @type {Record<string, unknown>} */
  const state = { command: context.command }
  if (typeof context.description === 'string' && context.description.trim() !== '') {
    state['description'] = context.description.trim()
  }
  if (typeof context.workingDirectory === 'string' && context.workingDirectory.trim() !== '') {
    state['workingDirectory'] = context.workingDirectory.trim()
  }
  state['platform'] = process.platform
  state['matchedRules'] = context.matchedRules.map((rule) => ({
    pattern: rule.pattern,
    description: rule.description,
  }))

  if (!Array.isArray(context.conversation)) return { state, contextUsage: undefined }

  const budget = MAX_STATE_CHARS - JSON.stringify(state).length
  const { kept, truncated } = fitConversation(context.conversation, Math.max(0, budget))
  if (kept.length === 0) {
    return { state, contextUsage: { messages: 0, truncated, empty: true } }
  }
  state['recentConversation'] = {
    note: 'Recent conversation before this command, oldest first. User messages show what the user actually asked for; the command under review was proposed by the assistant, not typed by the user.',
    messages: kept.map((message) => {
      /** @type {Record<string, unknown>} */
      const entry = { role: message.role }
      if (typeof message.text === 'string' && message.text.trim() !== '') entry['text'] = message.text
      if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
        entry['toolCalls'] = message.toolCalls.map((call) => ({
          name: call.name,
          arguments: toolArgumentsValue(call.arguments),
          output: call.output ?? '[no output recorded]',
        }))
      }
      return entry
    }),
  }
  return { state, contextUsage: { messages: kept.length, truncated, empty: false } }
}

/**
 * 组装三个问题：判定、理由、风险等级。与原版逐字对齐。
 * @returns {Record<string, unknown>} questions
 */
function buildQuestions() {
  /** @type {Record<string, string>} */
  const reasonCriteria = {}
  for (const [key, description] of REASON_CATEGORIES) reasonCriteria[key] = description
  return {
    verdict: {
      type: 'choice',
      instructions:
        "Judging the real effect of this exact command in this working directory, does it have to wait for the user's confirmation before it runs?",
      criteria: {
        allow:
          'Low risk — it can run unattended. It only reads, or it touches generated or regenerable artifacts (build output, caches, temporary files, package or dependency directories), or its effect stays inside the working directory and is easy to undo. A matched rule is not a risk by itself: rules also fire on file names, arguments and commit messages. Typical cases: inspecting files, builds, tests, formatting, cleaning build output, installing dependencies, git status/diff/add/commit inside the project.',
        deny:
          'Real risk of an effect the user did not ask for and could not easily undo: deleting or overwriting source code, documents, databases or paths outside the working directory; wiping data that cannot be regenerated; changing system or environment state (permissions, packages, services, processes); publishing or sending data off this machine; or the target is unknown so the effect cannot be bounded. Typical cases: recursive deletion of unresolved paths, disk formatting, force push, dropping a database, piping local files to a remote host.',
      },
    },
    reason: {
      type: 'choice',
      instructions: "Which of these best describes the command's effect?",
      criteria: reasonCriteria,
    },
    severity: {
      type: 'score',
      instructions:
        'If this exact command runs in this working directory, how severe is the worst realistic outcome?',
      criteria: SEVERITY_LEVELS.map(([, description]) => description),
    },
  }
}

/** @param {number} ms 毫秒 */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 判定客户端。每次调用现读设置，所以面板里改了 key / 端点 / 代理都立刻生效。
 */
export class DecisionClient {
  /**
   * @param {object} options 依赖
   * @param {() => import('./store.js').Settings} options.getSettings 读当前设置
   * @param {{ warn: (message: string) => void }} options.logger 日志
   */
  constructor({ getSettings, logger }) {
    this.getSettings = getSettings
    this.logger = logger
    this.gate = new CooldownGate(3, 60_000)
    this.semaphore = new Semaphore(4)
    this.cache = new LruCache(256)
    this.fetchFn = createFetchFn(() => resolveProxyTarget(this.getSettings().proxy))
  }

  /** @returns {{ endpoint: string; model: string; source: string | undefined } | undefined} 当前代理信息，供面板展示 */
  proxyInfo() {
    const target = resolveProxyTarget(this.getSettings().proxy)
    if (target === undefined) return { endpoint: 'direct', model: '', source: 'direct' }
    return { endpoint: target.url, model: '', source: target.source }
  }

  /**
   * 通用判定：发一组问题，拿回原始答案。
   *
   * 与 {@link evaluateCommand} 共用冷却、信号量与重试，但不做缓存——工具与技能选择
   * 每个会话只问一次，缓存收益抵不上多一份状态。
   * @param {{ state: Record<string, unknown>; questions: Record<string, unknown>; signal?: AbortSignal }} request 请求
   * @returns {Promise<{ ok: true; answers: Record<string, any>; model: string } | { unavailable: string }>} 结果
   */
  async judge({ state, questions, signal }) {
    const settings = this.getSettings()
    if (settings.apiKey.trim() === '') return { unavailable: 'no-key' }
    if (this.gate.open()) return { unavailable: 'cooldown' }
    if (signal?.aborted === true) return { unavailable: 'aborted' }
    const acquired = await this.semaphore.acquire(signal)
    if (!acquired) return { unavailable: signal?.aborted === true ? 'aborted' : 'timeout' }
    try {
      const answers = await this.#request(settings, state, questions, signal)
      this.gate.onSuccess()
      return { ok: true, answers, model: settings.model }
    } catch (error) {
      const code = error instanceof JevError ? error.code : 'network'
      if (code !== 'aborted') {
        if (this.gate.onFailure()) {
          this.logger.warn(
            `dsh-decision-guard: 决策模型连续失败（${code}），进入 60 秒冷却——期间新功能回退原生行为`,
          )
        }
      }
      return { unavailable: code }
    } finally {
      this.semaphore.release()
    }
  }

  /**
   * 判定一条命中规则的命令。
   * @param {object} context 见 {@link buildState}
   * @param {AbortSignal | undefined} signal 取消信号
   * @returns {Promise<{ allow: boolean; reason: string; confidence: number; severity?: string; severityScore?: number; model: string; cached: boolean; latencyMs: number; contextUsage?: object } | { unavailable: string }>} 判定
   */
  async evaluateCommand(context, signal) {
    const settings = this.getSettings()
    if (settings.apiKey.trim() === '') return { unavailable: 'no-key' }
    if (this.gate.open()) return { unavailable: 'cooldown' }
    const { state, contextUsage } = buildState(context)
    const questions = buildQuestions()
    const cacheKey = createHash('sha256')
      .update(JSON.stringify([settings.model, settings.endpoint, state, questions]))
      .digest('hex')
    const hit = this.cache.get(cacheKey)
    if (hit !== undefined) return { .../** @type {object} */ (hit), cached: true, latencyMs: 0 }

    if (signal?.aborted === true) return { unavailable: 'aborted' }
    const acquired = await this.semaphore.acquire(signal)
    if (!acquired) return { unavailable: signal?.aborted === true ? 'aborted' : 'timeout' }
    try {
      const raw = await this.#request(settings, state, questions, signal)
      const verdictAnswer = raw['verdict']
      if (verdictAnswer === undefined || verdictAnswer.type !== 'choice') {
        return { unavailable: 'invalid-response' }
      }
      const verdict = verdictAnswer.choice
      const reasonImage = REASON_CATEGORIES.find(([key]) => key === raw['reason']?.choice)
      const severity = resolveSeverity(raw['severity'])
      const result = {
        allow: verdict === 'allow',
        reason: reasonImage === undefined ? REASON_UNKNOWN : reasonImage[0],
        confidence:
          typeof verdictAnswer.confidence === 'number'
            ? Math.min(1, Math.max(0, verdictAnswer.confidence))
            : 0,
        ...(severity === undefined ? {} : severity),
        model: settings.model,
        cached: false,
        latencyMs: 0,
        ...(contextUsage === undefined ? {} : { contextUsage }),
      }
      this.cache.set(cacheKey, result)
      this.gate.onSuccess()
      return result
    } catch (error) {
      const code = error instanceof JevError ? error.code : 'network'
      if (code !== 'aborted') {
        if (this.gate.onFailure()) {
          this.logger.warn(
            `dsh-decision-guard: 决策模型连续失败（${code}），进入 60 秒冷却——期间命令回退到原生审批流程`,
          )
        }
      }
      return { unavailable: code }
    } finally {
      this.semaphore.release()
    }
  }

  /**
   * 发一次请求，最多重试一次可重试状态码。
   * @param {import('./store.js').Settings} settings 当前设置
   * @param {Record<string, unknown>} state 状态
   * @param {Record<string, unknown>} questions 问题
   * @param {AbortSignal | undefined} signal 取消
   * @returns {Promise<Record<string, any>>} 答案
   */
  async #request(settings, state, questions, signal) {
    const started = Date.now()
    for (let attempt = 1; ; attempt += 1) {
      const budget = settings.timeoutMs - (Date.now() - started)
      if (budget <= 0) throw new JevError(signal?.aborted === true ? 'aborted' : 'timeout', 'jev: 预算耗尽')
      const timer = AbortSignal.timeout(budget)
      const composed = signal === undefined ? timer : AbortSignal.any([signal, timer])
      /** @type {Response} */
      let response
      try {
        response = await this.fetchFn(settings.endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${settings.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ model: settings.model, state, questions }),
          signal: composed,
        })
      } catch (error) {
        if (signal?.aborted === true) throw new JevError('aborted', 'jev: 调用方取消')
        if (timer.aborted || (error instanceof Error && error.name === 'AbortError')) {
          throw new JevError('timeout', `jev: ${settings.timeoutMs}ms 内没有响应`)
        }
        throw new JevError('network', `jev: 网络错误 ${error instanceof Error ? error.message : String(error)}`)
      }
      if (response.status === 429 || response.status === 529 || response.status >= 500) {
        if (attempt < 2 && settings.timeoutMs - (Date.now() - started) > 400) {
          // 重试前把响应体丢掉：不消费的 body 会一直占着连接，重试几次就把池子塞满。
          try {
            await response.body?.cancel?.()
          } catch {
            /* 丢不掉也不影响重试 */
          }
          await sleep(400, signal)
          continue
        }
        throw new JevError('http', `jev: 服务端拒绝 ${response.status}`)
      }
      if (!response.ok) throw new JevError('http', `jev: HTTP ${response.status}`)
      let body
      try {
        body = await response.json()
      } catch {
        throw new JevError('invalid-response', 'jev: 响应不是 JSON')
      }
      const answers = /** @type {{ answers?: unknown }} */ (body)['answers']
      return parseAnswers(answers)
    }
  }

  /**
   * 连接测试：绕过缓存与冷却，独立放宽预算。
   * @param {{ apiKeyOverride?: string; signal?: AbortSignal }} options 参数
   * @returns {Promise<{ ok: boolean; latencyMs: number; model?: string; error?: string }>} 结果
   */
  async ping(options = {}) {
    const settings = this.getSettings()
    const key = (options.apiKeyOverride ?? settings.apiKey).trim()
    const started = Date.now()
    if (key === '') return { ok: false, latencyMs: 0, error: 'no-key' }
    const timer = AbortSignal.timeout(Math.max(settings.timeoutMs, 8000))
    const signal = options.signal === undefined ? timer : AbortSignal.any([options.signal, timer])
    /** @type {Response} */
    let response
    try {
      response = await this.fetchFn(settings.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: settings.model,
          state: { ping: 'connection-test' },
          questions: {
            ping: {
              type: 'noul',
              instructions:
                'This is an API connectivity test. Reply with the probability that the input is an automated test message.',
              criteria: { true: 'It is an automated connectivity test', false: 'It is not a test' },
            },
          },
        }),
        signal,
      })
    } catch (error) {
      const latencyMs = Date.now() - started
      if (options.signal?.aborted === true) return { ok: false, latencyMs, error: 'aborted' }
      const timedOut = timer.aborted || (error instanceof Error && error.name === 'AbortError')
      return { ok: false, latencyMs, error: timedOut ? 'timeout' : 'network' }
    }
    const latencyMs = Date.now() - started
    if (response.status === 401 || response.status === 403) return { ok: false, latencyMs, error: 'auth' }
    if (response.status === 404) return { ok: false, latencyMs, error: 'not-found' }
    if (response.status === 429) return { ok: true, latencyMs, error: 'rate-limited' }
    if (response.status >= 500) return { ok: false, latencyMs, error: 'server' }
    if (response.status === 451) return { ok: false, latencyMs, error: 'http-451' }
    if (!response.ok) return { ok: false, latencyMs, error: `http-${String(response.status)}` }
    try {
      const body = await response.json()
      parseAnswers(/** @type {{ answers?: unknown }} */ (body)['answers'])
      const model = /** @type {{ model?: unknown }} */ (body)['model']
      return { ok: true, latencyMs, model: typeof model === 'string' ? model : settings.model }
    } catch {
      return { ok: false, latencyMs, error: 'invalid-response' }
    }
  }
}
