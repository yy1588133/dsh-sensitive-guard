/**
 * glob 结果排序自测：不连网、不加载宿主，用假 ctx + 假 client 验证
 * - 关闭 / 非 glob / 错误结果 / 超候选数：一条模型请求都不发
 * - 排序顺序：概率降序，value.paths 原样保留（路径一条不丢）
 * - 失败降级：judge 不可用或抛错时返回原始结果
 *
 * 用法：node test/file-rank.mjs
 */

import assert from 'node:assert/strict'
import { createFileRanker } from '../lib/file-rank.js'

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

/** 原始工具结果：带 content 与结构化 value。 */
const originalContent = [{ type: 'text', text: 'original glob output' }]

/** @param {string[]} paths 路径 @param {string} root 根目录 */
function makeResult(paths, root = 'C:\\proj') {
  return { content: originalContent, value: { root, paths: [...paths] }, isError: false }
}

/** @param {object} overrides 覆盖字段 */
function makeExec(overrides = {}) {
  return { name: 'glob', token: 'tok-1', arguments: { pattern: '**/*.js', path: 'lib' }, ...overrides }
}

/** 按路径顺序造一份「概率递增」的答案。 @param {number[]} probabilities 概率 */
function answersFor(probabilities) {
  const answers = {}
  probabilities.forEach((noul, index) => {
    answers[`path-${index}`] = { type: 'noul', noul }
  })
  return { ok: true, answers, model: 'jev-test' }
}

/**
 * 造一个假 harness：假 ctx 只收事件，假 client 记录请求。
 * @param {object} options 配置
 * @param {Record<string, unknown>} [options.settings] 设置
 * @param {(request: any) => any} [options.judge] 假判定
 */
function makeHarness({ settings = { filesEnabled: true, fileCandidates: 40 }, judge } = {}) {
  /** @type {Map<string, Function[]>} */
  const events = new Map()
  /** @type {any[]} */
  const calls = []
  const ctx = {
    on(name, fn) {
      const list = events.get(name) ?? []
      list.push(fn)
      events.set(name, list)
      return () => {}
    },
  }
  const client = {
    async judge(request) {
      calls.push(request)
      return judge === undefined ? answersFor([0.2, 0.9, 0.5]) : await judge(request)
    },
  }
  const ranker = createFileRanker({ ctx, client, getSettings: () => settings, logger: { warn() {} } })
  return { ranker, events, calls, settings }
}

/**
 * 走一遍两个钩子：执行前拿结果，执行后替换 content。
 * @param {any} harness harness
 * @param {any} exec 调用
 * @param {any} result 工具结果
 */
async function run(harness, exec, result) {
  const executed = await harness.ranker.onExecute(exec, async () => result)
  const final = await harness.ranker.onPostExecute(exec, result, async () => executed)
  return { executed, final }
}

await test('挂上 tools/execute 与 tools/post-execute 两个钩子', () => {
  const h = makeHarness()
  assert.ok(h.events.get('tools/execute')?.length === 1, 'tools/execute 要挂一个')
  assert.ok(h.events.get('tools/post-execute')?.length === 1, 'tools/post-execute 要挂一个')
})

await test('filesEnabled 关闭：不请求模型，结果原样返回', async () => {
  const h = makeHarness({ settings: { filesEnabled: false, fileCandidates: 40 } })
  const result = makeResult(['lib/a.js', 'lib/b.js', 'lib/c.js'])
  const { final } = await run(h, makeExec(), result)
  assert.equal(h.calls.length, 0, '关闭时不该问模型')
  assert.equal(final.content, originalContent, 'content 保持原引用')
  assert.deepEqual(final.value.paths, ['lib/a.js', 'lib/b.js', 'lib/c.js'])
})

await test('非 glob 工具：不请求模型，结果原样返回', async () => {
  const h = makeHarness()
  const result = makeResult(['lib/a.js'])
  const { final } = await run(h, makeExec({ name: 'read' }), result)
  assert.equal(h.calls.length, 0)
  assert.equal(final.content, originalContent)
})

await test('isError 的结果：不请求模型，错误原样返回', async () => {
  const h = makeHarness()
  const result = { ...makeResult(['lib/a.js']), isError: true }
  const { final } = await run(h, makeExec(), result)
  assert.equal(h.calls.length, 0)
  assert.equal(final.content, originalContent)
  assert.equal(final.isError, true)
})

await test('候选数超过 settings.fileCandidates：跳过排序', async () => {
  const h = makeHarness({ settings: { filesEnabled: true, fileCandidates: 2 } })
  const result = makeResult(['lib/a.js', 'lib/b.js', 'lib/c.js'])
  const { final } = await run(h, makeExec(), result)
  assert.equal(h.calls.length, 0, '超过候选上限就该跳过')
  assert.equal(final.content, originalContent)
})

await test('value 不是 { root, paths }：不请求模型', async () => {
  const h = makeHarness()
  const result = { content: originalContent, value: { paths: ['lib/a.js'] }, isError: false }
  const { final } = await run(h, makeExec(), result)
  assert.equal(h.calls.length, 0)
  assert.equal(final.content, originalContent)
})

await test('按概率降序：content 逐行给出概率与路径，value.paths 保持原样', async () => {
  const h = makeHarness()
  const result = makeResult(['lib/a.js', 'lib/b.js', 'lib/c.js'])
  const { final } = await run(h, makeExec(), result)

  assert.equal(h.calls.length, 1, '只发一次请求')
  const request = h.calls[0]
  assert.equal(request.state.pattern, '**/*.js', 'prompt 要带 pattern')
  assert.equal(request.state.path, 'lib')
  assert.equal(request.state.root, 'C:\\proj')
  for (const [index, path] of ['lib/a.js', 'lib/b.js', 'lib/c.js'].entries()) {
    const question = request.questions[`path-${index}`]
    assert.equal(question.type, 'noul')
    assert.ok(question.instructions.includes(path), `题目要带路径 ${path}`)
  }

  assert.ok(Array.isArray(final.content), 'content 换成文本块')
  assert.equal(final.content[0].type, 'text')
  const text = final.content[0].text
  const order = ['lib/b.js', 'lib/c.js', 'lib/a.js']
  assert.deepEqual(
    order.map((path) => text.indexOf(path)).every((index, position, all) => index >= 0 && (position === 0 || index > all[position - 1])),
    true,
    `文本顺序应为 b → c → a，实际：${text}`,
  )
  assert.ok(text.includes('90%'), '带概率百分比')
  assert.ok(text.includes('50%') && text.includes('20%'))
  assert.ok(text.includes('共 3 条，按相关性排序；完整结果仍在 value.paths'), '结尾说明完整结果还在 value.paths')

  // 结构化值不动：路径一条都不能丢，顺序也不动
  assert.equal(final.value.root, 'C:\\proj')
  assert.deepEqual(final.value.paths, ['lib/a.js', 'lib/b.js', 'lib/c.js'])
  assert.equal(final.isError, false)
})

await test('judge 不可用或抛错：返回原始结果，路径不丢', async () => {
  for (const judge of [
    async () => ({ unavailable: 'no-key' }),
    async () => {
      throw new Error('boom')
    },
  ]) {
    const h = makeHarness({ judge })
    const result = makeResult(['lib/a.js', 'lib/b.js', 'lib/c.js'])
    const { final } = await run(h, makeExec(), result)
    assert.equal(h.calls.length, 1)
    assert.equal(final.content, originalContent, 'content 保持原引用')
    assert.deepEqual(final.value.paths, ['lib/a.js', 'lib/b.js', 'lib/c.js'], '路径一条不丢')
  }
})

await test('答案不完整：视为失败，返回原始结果', async () => {
  const h = makeHarness({ judge: async () => answersFor([0.7]) })
  const result = makeResult(['lib/a.js', 'lib/b.js'])
  const { final } = await run(h, makeExec(), result)
  assert.equal(final.content, originalContent)
  assert.deepEqual(final.value.paths, ['lib/a.js', 'lib/b.js'])
})

console.log(process.exitCode === 1 ? `\n有失败用例（通过 ${passed}）` : `全部 ${passed} 个 glob 排序用例通过`)