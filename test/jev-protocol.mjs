/**
 * Jev 协议层自测：不连网，用注入的假 fetch 验证
 * - 请求体形状（state / model / questions 三题，score 用有序 criteria）
 * - 答案解析（choice / score，数字 key 与 label key 两种）
 * - 失败降级（无 key、HTTP 错误、答案不合规、超时）
 * - 缓存命中与冷却
 *
 * 用法：node test/jev-protocol.mjs
 */

import assert from 'node:assert/strict'
import { DecisionClient } from '../lib/jev.js'
import { DEFAULT_SETTINGS, normalizeSettings } from '../lib/store.js'

let passed = 0
/** @param {string} name 用例名 @param {() => Promise<void> | void} body 断言体 */
async function test(name, body) {
  try {
    await body()
    passed += 1
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

/** 造一个总能成功的响应体。 */
const okBody = (answers) => ({
  status: 200,
  ok: true,
  headers: {},
  text: async () => '',
  json: async () => ({ answers, model: 'jev-test' }),
})

/**
 * 造一个把请求记下来、按给定回应作答的客户端。
 * @param {(body: any) => any} respond 收到请求体后返回 Response 形状的对象
 */
function makeClient(respond) {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, apiKey: 'test-key', enabled: true })
  /** @type {any[]} */
  const calls = []
  const client = new DecisionClient({
    getSettings: () => settings,
    logger: { warn: () => {} },
  })
  client.fetchFn = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body, headers: init.headers })
    return respond(body)
  }
  return { client, calls, settings }
}

/** 标准的三题答案。 */
const answers = (verdict, { reason = 'scopedChange', severity = '1' } = {}) => ({
  verdict: { type: 'choice', choice: verdict, confidence: 0.91, probabilities: { allow: 0.09, deny: 0.91 } },
  reason: { type: 'choice', choice: reason, confidence: 0.8, probabilities: { [reason]: 0.8 } },
  severity: { type: 'score', score: Number(severity), probabilities: { '0': 0.05, '1': 0.15, '2': 0.8 } },
})

const context = {
  command: 'rm -rf build',
  description: '清理构建产物',
  workingDirectory: 'C:\\proj',
  matchedRules: [{ commandId: 'rm', pattern: '(?:^|[^-\\w])rm\\s+\\S', description: 'Delete files' }],
  conversation: undefined,
}

// ── 请求体形状 ───────────────────────────────────────────────────────
await test('请求体是 state / model / questions 三个顶层字段', async () => {
  const { client, calls } = makeClient(() => okBody(answers('deny')))
  await client.evaluateCommand(context, undefined)
  assert.equal(calls.length, 1)
  const body = calls[0].body
  assert.deepEqual(Object.keys(body).sort(), ['model', 'questions', 'state'])
  assert.equal(body.state.command, 'rm -rf build')
  assert.equal(body.state.workingDirectory, 'C:\\proj')
  assert.equal(body.state.platform, process.platform)
  assert.equal(body.state.matchedRules.length, 1)
  assert.equal(body.state.matchedRules[0].pattern, '(?:^|[^-\\w])rm\\s+\\S')
})

await test('三题齐全：verdict / reason / severity', async () => {
  const { client, calls } = makeClient(() => okBody(answers('allow')))
  await client.evaluateCommand(context, undefined)
  const questions = calls[0].body.questions
  assert.deepEqual(Object.keys(questions).sort(), ['reason', 'severity', 'verdict'])
  assert.equal(questions.verdict.type, 'choice')
  assert.equal(questions.reason.type, 'choice')
  assert.equal(questions.severity.type, 'score')
  // score 用有序 criteria 数组，不是 levels
  assert.ok(Array.isArray(questions.severity.criteria))
  assert.equal(questions.severity.criteria.length, 3)
  assert.equal(questions.severity.levels, undefined)
})

await test('理由分类有 7 档，且含 unclear', async () => {
  const { client, calls } = makeClient(() => okBody(answers('allow')))
  await client.evaluateCommand(context, undefined)
  const criteria = calls[0].body.questions.reason.criteria
  assert.equal(Object.keys(criteria).length, 7)
  assert.ok('unclear' in criteria)
})

await test('Authorization 头带 Bearer key，content-type 是 JSON', async () => {
  const { client, calls } = makeClient(() => okBody(answers('allow')))
  await client.evaluateCommand(context, undefined)
  assert.equal(calls[0].headers.authorization, 'Bearer test-key')
  assert.equal(calls[0].headers['content-type'], 'application/json')
})

await test('命中规则但没有会话时不带 recentConversation', async () => {
  const { client, calls } = makeClient(() => okBody(answers('allow')))
  await client.evaluateCommand(context, undefined)
  assert.equal(calls[0].body.state.recentConversation, undefined)
})

await test('有会话时塞进 state.recentConversation', async () => {
  const { client, calls } = makeClient(() => okBody(answers('allow')))
  await client.evaluateCommand(
    {
      ...context,
      conversation: [
        { role: 'user', text: '帮我清理构建产物', toolCalls: [] },
        { role: 'assistant', text: '好的', toolCalls: [{ name: 'bash', arguments: '{"command":"ls"}', output: 'a.txt' }] },
      ],
    },
    undefined,
  )
  const recent = calls[0].body.state.recentConversation
  assert.equal(recent.messages.length, 2)
  assert.equal(recent.messages[0].role, 'user')
  assert.equal(recent.messages[1].toolCalls[0].name, 'bash')
  // arguments 是合法 JSON 时要保留结构
  assert.deepEqual(recent.messages[1].toolCalls[0].arguments, { command: 'ls' })
})

// ── 答案解析 ────────────────────────────────────────────────────────
await test('allow 判定被正确识别', async () => {
  const { client } = makeClient(() => okBody(answers('allow', { reason: 'readOnly' })))
  const decision = await client.evaluateCommand(context, undefined)
  assert.equal(decision.allow, true)
  assert.equal(decision.reason, 'readOnly')
  assert.equal(decision.confidence, 0.91)
})

await test('deny 判定被正确识别', async () => {
  const { client } = makeClient(() => okBody(answers('deny', { reason: 'dataLoss' })))
  const decision = await client.evaluateCommand(context, undefined)
  assert.equal(decision.allow, false)
  assert.equal(decision.reason, 'dataLoss')
})

await test('未知理由分类降级成 unclear，判定仍有效', async () => {
  const { client } = makeClient(() =>
    okBody({
      verdict: { type: 'choice', choice: 'deny', confidence: 0.7, probabilities: {} },
      reason: { type: 'choice', choice: 'nonsense', confidence: 0.5, probabilities: {} },
      severity: { type: 'score', score: 1, probabilities: { '0': 0.1, '1': 0.8, '2': 0.1 } },
    }),
  )
  const decision = await client.evaluateCommand(context, undefined)
  assert.equal(decision.allow, false)
  assert.equal(decision.reason, 'unclear')
})

await test('severity 用数字 key 解析成 high（0.8 在档位 2）', async () => {
  const { client } = makeClient(() =>
    okBody({
      verdict: { type: 'choice', choice: 'deny', confidence: 0.9, probabilities: {} },
      reason: { type: 'choice', choice: 'dataLoss', confidence: 0.9, probabilities: {} },
      severity: { type: 'score', score: 1.8, probabilities: { '0': 0.05, '1': 0.15, '2': 0.8 } },
    }),
  )
  const decision = await client.evaluateCommand(context, undefined)
  assert.equal(decision.severity, 'high')
  // 档位 0/1/2 加权平均：0*0.05 + 1*0.15 + 2*0.8 = 1.75
  assert.ok(Math.abs(decision.severityScore - 1.75) < 0.01, `severityScore=${decision.severityScore}`)
})

await test('severity 用 label key 也能解析', async () => {
  const { client } = makeClient(() =>
    okBody({
      verdict: { type: 'choice', choice: 'allow', confidence: 0.9, probabilities: {} },
      reason: { type: 'choice', choice: 'readOnly', confidence: 0.9, probabilities: {} },
      severity: { type: 'score', score: 0.2, probabilities: { low: 0.8, medium: 0.15, high: 0.05 } },
    }),
  )
  const decision = await client.evaluateCommand(context, undefined)
  assert.equal(decision.severity, 'low')
})

await test('severity 缺失不影响 verdict', async () => {
  const { client } = makeClient(() =>
    okBody({
      verdict: { type: 'choice', choice: 'deny', confidence: 0.9, probabilities: {} },
      reason: { type: 'choice', choice: 'dataLoss', confidence: 0.9, probabilities: {} },
    }),
  )
  const decision = await client.evaluateCommand(context, undefined)
  assert.equal(decision.allow, false)
  assert.equal(decision.severity, undefined)
})

// ── 失败降级 ────────────────────────────────────────────────────────
await test('没有 key 时返回 unavailable=no-key，不发请求', async () => {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, apiKey: '' })
  let called = 0
  const client = new DecisionClient({ getSettings: () => settings, logger: { warn: () => {} } })
  client.fetchFn = async () => {
    called += 1
    return okBody(answers('allow'))
  }
  const decision = await client.evaluateCommand(context, undefined)
  assert.equal(decision.unavailable, 'no-key')
  assert.equal(called, 0)
})

await test('HTTP 500 重试一次后返回 unavailable=http', async () => {
  let attempts = 0
  const { client } = makeClient(() => {
    attempts += 1
    return { status: 500, ok: false, headers: {}, text: async () => '', json: async () => ({}) }
  })
  const decision = await client.evaluateCommand(context, undefined)
  assert.equal(decision.unavailable, 'http')
  assert.equal(attempts, 2)
})

await test('verdict 缺失时返回 unavailable=invalid-response', async () => {
  const { client } = makeClient(() => okBody({ reason: { type: 'choice', choice: 'unclear', confidence: 0.5, probabilities: {} } }))
  const decision = await client.evaluateCommand(context, undefined)
  assert.equal(decision.unavailable, 'invalid-response')
})

await test('非 JSON 响应返回 unavailable=invalid-response', async () => {
  const { client } = makeClient(() => ({
    status: 200,
    ok: true,
    headers: {},
    text: async () => 'not json',
    json: async () => {
      throw new Error('bad json')
    },
  }))
  const decision = await client.evaluateCommand(context, undefined)
  assert.equal(decision.unavailable, 'invalid-response')
})

await test('已取消的信号返回 unavailable=aborted', async () => {
  const { client } = makeClient(() => okBody(answers('allow')))
  const controller = new AbortController()
  controller.abort()
  const decision = await client.evaluateCommand(context, controller.signal)
  assert.equal(decision.unavailable, 'aborted')
})

// ── 缓存与冷却 ──────────────────────────────────────────────────────
await test('同样的输入命中缓存，只发一次请求', async () => {
  const { client, calls } = makeClient(() => okBody(answers('deny')))
  await client.evaluateCommand(context, undefined)
  const second = await client.evaluateCommand(context, undefined)
  assert.equal(calls.length, 1)
  assert.equal(second.cached, true)
})

await test('连续 3 次失败后进入冷却，不再发请求', async () => {
  let attempts = 0
  const { client } = makeClient(() => {
    attempts += 1
    return { status: 400, ok: false, headers: {}, text: async () => '', json: async () => ({}) }
  })
  await client.evaluateCommand(context, undefined)
  await client.evaluateCommand(context, undefined)
  await client.evaluateCommand(context, undefined)
  const after = await client.evaluateCommand(context, undefined)
  assert.equal(after.unavailable, 'cooldown')
  assert.equal(attempts, 3)
})

// ── ping ────────────────────────────────────────────────────────────
await test('ping 成功返回 ok 与模型名', async () => {
  const { client, calls } = makeClient(() => ({
    status: 200,
    ok: true,
    headers: {},
    text: async () => '',
    json: async () => ({ answers: { ping: { type: 'noul', noul: 0.99 } }, model: 'jev-1.14.0' }),
  }))
  const result = await client.ping()
  assert.equal(result.ok, true)
  assert.equal(result.model, 'jev-1.14.0')
  // ping 用的是 noul 题
  assert.equal(calls[0].body.questions.ping.type, 'noul')
})

await test('ping 遇到 451 给出 http-451', async () => {
  const { client } = makeClient(() => ({ status: 451, ok: false, headers: {}, text: async () => '', json: async () => ({}) }))
  const result = await client.ping()
  assert.equal(result.ok, false)
  assert.equal(result.error, 'http-451')
})

await test('ping 遇到 429 视为 key 有效', async () => {
  const { client } = makeClient(() => ({ status: 429, ok: false, headers: {}, text: async () => '', json: async () => ({}) }))
  const result = await client.ping()
  assert.equal(result.ok, true)
  assert.equal(result.error, 'rate-limited')
})

console.log(process.exitCode === 1 ? `\n有失败用例（通过 ${passed}）` : `全部 ${passed} 个协议用例通过`)
