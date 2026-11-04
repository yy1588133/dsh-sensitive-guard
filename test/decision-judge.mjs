/**
 * 通用 judge() 自测：不连网，用注入的假 fetch 验证
 * - 无 key 直接返回 unavailable，不发请求
 * - 成功路径解析答案并带回 model
 * - 取消信号
 * - 网络失败降级
 *
 * 用法：node test/decision-judge.mjs
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

/** 造一个客户端，可选注入假 fetch。 */
function makeClient({ apiKey = 'test-key', respond } = {}) {
  const settings = normalizeSettings({ ...DEFAULT_SETTINGS, apiKey, enabled: true })
  const calls = []
  const client = new DecisionClient({
    getSettings: () => settings,
    logger: { warn: () => {} },
  })
  if (respond !== undefined) {
    client.fetchFn = async (url, init) => {
      const body = JSON.parse(init.body)
      calls.push({ url, body })
      return respond(body)
    }
  }
  return { client, calls, settings }
}

const okBody = (answers) => ({
  status: 200,
  ok: true,
  headers: {},
  text: async () => '',
  json: async () => ({ answers, model: 'jev-test' }),
})

const request = {
  state: { task: '选择一个工具' },
  questions: {
    a: { type: 'noul', instructions: 'Does it help?', criteria: { yes: 'helps', no: 'does not' } },
  },
}

await test('无 key 返回 unavailable 且不发请求', async () => {
  const { client, calls } = makeClient({ apiKey: '' })
  const result = await client.judge(request)
  assert.deepEqual(result, { unavailable: 'no-key' })
  assert.equal(calls.length, 0)
})

await test('成功路径带回解析后的答案与 model', async () => {
  const { client, calls, settings } = makeClient({
    respond: () => okBody({ a: { type: 'noul', noul: 0.87 } }),
  })
  const result = await client.judge(request)
  assert.equal(result.ok, true)
  assert.equal(result.answers.a.noul, 0.87)
  assert.equal(result.model, settings.model)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].body.state.task, '选择一个工具')
  assert.equal(calls[0].body.questions.a.type, 'noul')
})

await test('已取消的信号直接返回 aborted', async () => {
  const { client, calls } = makeClient({ respond: () => okBody({}) })
  const controller = new AbortController()
  controller.abort()
  const result = await client.judge({ ...request, signal: controller.signal })
  assert.deepEqual(result, { unavailable: 'aborted' })
  assert.equal(calls.length, 0)
})

await test('网络失败降级为 unavailable 而不是抛错', async () => {
  const { client } = makeClient({
    respond: () => {
      throw new Error('boom')
    },
  })
  const result = await client.judge(request)
  assert.equal(result.ok, undefined)
  assert.equal(typeof result.unavailable, 'string')
})

console.log(`decision-judge: ${passed} passed`)