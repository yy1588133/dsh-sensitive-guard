/**
 * 工具按需加载自测：不连网，用注入的假上下文与假决策客户端验证
 * - 未开启时完全不动工具清单，也不问模型
 * - 每个会话只在第一条用户消息上评估一次
 * - 白名单与核心工具永不摘除，描述超长会截断
 * - 决策模型不可用、抛错、答案非法、restrict 抛错时都不摘
 * - tool_search 后端能单个 / 全部恢复，未知工具名被过滤
 *
 * 用法：node test/tool-select.mjs
 */

import assert from 'node:assert/strict'
import { createToolSelector } from '../lib/tool-select.js'

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

/** 默认工具清单：前三个在核心保护名单里，后三个按概率决定去留。 */
const DEFAULT_TOOLS = [
  { name: 'read', description: '读取文件内容' },
  { name: 'write', description: '写入文件内容' },
  { name: 'bash', description: '执行 shell 命令' },
  { name: 'ops_glob', description: '按模式列出文件路径，返回匹配的文件。' },
  { name: 'web_search', description: '联网搜索当前信息，返回摘要与来源链接。' },
  { name: 'cron_create', description: `操作定时任务：${'x'.repeat(400)}` },
]

/** 一条带用户文本的消息，形状按 DSH 的 messages 来。 */
const USER_MESSAGE = [
  { source: { kind: 'user' }, content: '帮我把构建产物清理一下，再查一下最新的发布说明。' },
]

/**
 * 造一套最小的运行时：假 ctx.tools.schemas / 假 restrict / 假 judge。
 *
 * restrict 按真实语义模拟：掩码是叠加的，disposer 撤销自己那一层；
 * 未知工具名直接抛错，逼实现先跟 schemas 求交。
 * @param {object} options 参数
 * @param {object} [options.settings] 覆盖设置
 * @param {number[]} [options.probabilities] 按候选顺序给的相关概率
 * @param {(request: object) => Promise<object>} [options.judge] 自定义决策客户端
 * @param {(request: { deny: string[] }) => (() => void)} [options.restrict] 自定义 restrict
 * @param {string[]} [options.scoped] 出现在 schemas 里、但 restrict 不认的作用域工具
 */
function makeHarness({ settings = {}, probabilities = [0.9, 0.9, 0.9], judge, restrict, scoped = [] } = {}) {
  const scopedNames = new Set(scoped)
  const tools = { list: DEFAULT_TOOLS.map((tool) => ({ ...tool })) }
  const judgeCalls = []
  const restrictCalls = []
  const records = []
  const loggerCalls = []
  let active = []

  const fakeCtx = {
    tools: {
      // 真实宿主里 schemas 返回的是「当前可见工具」：被掩码隐藏的不在列表里。
      // mock 必须照这个语义来，否则恢复逻辑的 bug 会被掩盖。
      schemas: async () => tools.list.filter((tool) => !active.includes(tool.name)).map((tool) => ({ ...tool })),
    },
  }

  const restrictImpl =
    restrict ??
    (({ deny }) => {
      const known = new Set(tools.list.map((tool) => tool.name))
      for (const name of deny) {
        if (!known.has(name)) throw new Error(`unknown tool: ${name}`)
        // 作用域工具（agent.ctx.tools.register 注册，如 ops_bash）在 schemas 里，
        // 但不在全局可限制名单里：整批调用会一起抛错，逼实现退回逐个。
        if (scopedNames.has(name)) throw new Error(`unknown global tool: ${name}`)
      }
      const previous = active
      active = [...new Set([...active, ...deny])]
      restrictCalls.push([...deny])
      return () => {
        active = previous
      }
    })

  const agent = {
    id: 'agent-1',
    ctx: { tools: { restrict: (request) => restrictImpl(request) } },
  }

  const judgeImpl =
    judge ??
    (async ({ state, questions, signal }) => {
      judgeCalls.push({ state, questions, signal })
      const answers = {}
      for (const id of Object.keys(questions)) {
        const noul = probabilities[Number(id)]
        answers[id] = { type: 'noul', noul: typeof noul === 'number' ? noul : 0.9 }
      }
      return { ok: true, answers, model: 'fake-model' }
    })

  const selector = createToolSelector({
    ctx: fakeCtx,
    client: { judge: (request) => judgeImpl(request) },
    getSettings: () => ({ toolsEnabled: false, toolWhitelist: [], toolMinProbability: 0.5, ...settings }),
    logger: { warn: (message) => loggerCalls.push(message) },
    record: (entry) => records.push(entry),
  })

  return {
    selector,
    agent,
    judgeCalls,
    restrictCalls,
    records,
    loggerCalls,
    state: () => [...active],
    setTools: (next) => {
      tools.list = next.map((tool) => ({ ...tool }))
    },
    toolNames: () => tools.list.map((tool) => tool.name),
  }
}

// ── 开关与触发条件 ───────────────────────────────────────────────────

await test('未开启：不动工具清单，也不问模型', async () => {
  const h = makeHarness({ settings: { toolsEnabled: false } })
  const decision = { kind: 'continue', messages: [] }
  const returned = await h.selector.onPreStep(decision, h.agent, USER_MESSAGE)
  assert.equal(returned, decision)
  assert.equal(h.judgeCalls.length, 0)
  assert.deepEqual(h.state(), [])
  assert.deepEqual(h.selector.snapshot(), { hidden: [], savedTokens: 0, last: null })

  // 开启了，但本轮没有用户文本（或用户文本是空的）：同样不触发
  const quiet = makeHarness({ settings: { toolsEnabled: true } })
  await quiet.selector.onPreStep(decision, quiet.agent, [{ source: { kind: 'assistant' }, content: '继续。' }])
  await quiet.selector.onPreStep(decision, quiet.agent, [{ source: { kind: 'user' }, content: '   ' }])
  assert.equal(quiet.judgeCalls.length, 0)
  assert.deepEqual(quiet.state(), [])
})

await test('每会话只评估一次：题按候选序号编号，超长描述截断', async () => {
  const h = makeHarness({ settings: { toolsEnabled: true } })
  const decision = { kind: 'continue', messages: [] }
  await h.selector.onPreStep(decision, h.agent, USER_MESSAGE)
  await h.selector.onPreStep(decision, h.agent, USER_MESSAGE)
  assert.equal(h.judgeCalls.length, 1)

  const request = h.judgeCalls[0]
  assert.deepEqual(Object.keys(request.questions).sort(), ['0', '1', '2'])
  assert.equal(request.questions['0'].type, 'noul')
  assert.match(request.questions['0'].instructions, /ops_glob/)
  assert.match(request.questions['2'].instructions, /cron_create/)
  assert.match(request.questions['2'].instructions, /操作定时任务/)
  assert.ok(!request.questions['2'].instructions.includes('x'.repeat(301)), '描述应截断到 300 字符')
  assert.equal(request.state.feature, 'tool-selection')
  assert.match(String(request.state.task), /构建产物/)

  // 另一个会话独立评估：已评估是按 agent.id 记的
  const other = { id: 'agent-2', ctx: h.agent.ctx }
  await h.selector.onPreStep(decision, other, USER_MESSAGE)
  assert.equal(h.judgeCalls.length, 2)
})

// ── 摘除策略 ─────────────────────────────────────────────────────────

await test('白名单与核心工具永不摘除', async () => {
  const h = makeHarness({
    settings: { toolsEnabled: true, toolWhitelist: ['web_search'] },
    probabilities: [0.9, 0.01, 0.01],
  })
  await h.selector.onPreStep({ kind: 'continue' }, h.agent, USER_MESSAGE)
  assert.deepEqual(h.state(), ['cron_create'])
  assert.deepEqual(h.selector.snapshot().hidden, ['cron_create'])
  for (const name of ['read', 'write', 'bash']) {
    assert.ok(!h.state().includes(name), `${name} 不该被摘`)
  }
  // 白名单与核心工具都不进候选：既不会被摘，也不浪费题目
  assert.deepEqual(Object.keys(h.judgeCalls[0].questions).sort(), ['0', '1'])
})

await test('失败一律不摘：不可用、抛错、答案非法、restrict 抛错', async () => {
  // 决策模型不可用（无 key / 冷却 / 超时都走这一条）
  const unavailable = makeHarness({
    settings: { toolsEnabled: true },
    judge: async () => ({ unavailable: 'cooldown' }),
  })
  await unavailable.selector.onPreStep({ kind: 'continue' }, unavailable.agent, USER_MESSAGE)
  assert.deepEqual(unavailable.state(), [])
  assert.deepEqual(unavailable.selector.snapshot().hidden, [])
  assert.equal(unavailable.records.at(-1)?.verdict, 'fail')
  assert.match(String(unavailable.records.at(-1)?.reason), /cooldown/)

  // 决策客户端直接抛
  const thrown = makeHarness({
    settings: { toolsEnabled: true },
    judge: async () => {
      throw new Error('socket hang up')
    },
  })
  await thrown.selector.onPreStep({ kind: 'continue' }, thrown.agent, USER_MESSAGE)
  assert.deepEqual(thrown.state(), [])
  assert.equal(thrown.records.at(-1)?.verdict, 'fail')

  // 答案不合法：noul 概率不是数字
  const invalid = makeHarness({
    settings: { toolsEnabled: true },
    judge: async () => ({ ok: true, answers: { '0': { type: 'noul', noul: 'high' } }, model: 'fake' }),
  })
  await invalid.selector.onPreStep({ kind: 'continue' }, invalid.agent, USER_MESSAGE)
  assert.deepEqual(invalid.state(), [])
  assert.equal(invalid.records.at(-1)?.verdict, 'fail')

  // restrict 自己抛错
  const broken = makeHarness({
    settings: { toolsEnabled: true },
    probabilities: [0.01, 0.01, 0.01],
    restrict: () => {
      throw new Error('restrict refused')
    },
  })
  await broken.selector.onPreStep({ kind: 'continue' }, broken.agent, USER_MESSAGE)
  assert.deepEqual(broken.state(), [])
  assert.deepEqual(broken.selector.snapshot().hidden, [])
  assert.match(String(broken.records.at(-1)?.reason), /restrict/)
})

await test('作用域工具整次失败后退回逐个：能摘的照摘，不记失败', async () => {
  // cron_create 模拟 ops_bash：出现在 schemas 里，但 restrict 不认它。
  const h = makeHarness({
    settings: { toolsEnabled: true },
    probabilities: [0.9, 0.02, 0.02],
    scoped: ['cron_create'],
  })
  await h.selector.onPreStep({ kind: 'continue' }, h.agent, USER_MESSAGE)

  assert.deepEqual(h.state(), ['web_search'], '只摘能摘的，作用域工具跳过')
  assert.deepEqual(h.selector.snapshot().hidden, ['web_search'])
  assert.ok(!h.selector.snapshot().hidden.includes('cron_create'), '作用域工具不能被记成已隐藏')
  assert.notEqual(h.records.at(-1)?.verdict, 'fail', '部分成功不是失败')
  assert.ok(h.selector.snapshot().savedTokens > 0, 'savedTokens 只按真正隐藏的算')
  assert.deepEqual(h.restrictCalls, [['web_search']], '整体失败后逐个重试，只有成功的入账')
})

// ── 召回 ────────────────────────────────────────────────────────────

await test('tool_search 能单个 / 全部恢复，掩码随之重建', async () => {
  const h = makeHarness({ settings: { toolsEnabled: true }, probabilities: [0.9, 0.02, 0.02] })
  await h.selector.onPreStep({ kind: 'continue' }, h.agent, USER_MESSAGE)
  assert.deepEqual(h.state(), ['web_search', 'cron_create'])

  const before = h.selector.snapshot()
  assert.deepEqual(before.hidden, ['web_search', 'cron_create'])
  assert.ok(before.savedTokens > 0, '隐藏工具应估算出省下的 token')
  assert.equal(before.last?.verdict, 'hide')

  const listed = await h.selector.search(h.agent, {})
  assert.match(listed.text, /web_search/)
  assert.match(listed.text, /cron_create/)
  assert.match(listed.text, /tool_search/)

  const one = await h.selector.search(h.agent, { enable: ['web_search'] })
  assert.deepEqual(h.state(), ['cron_create'], '撤销旧掩码后应以剩余集合重建')
  assert.deepEqual(h.selector.snapshot().hidden, ['cron_create'])
  assert.equal(h.restrictCalls.length, 2)
  assert.deepEqual(h.restrictCalls[1], ['cron_create'])
  assert.match(one.text, /已恢复/)
  assert.match(one.text, /web_search/)

  const all = await h.selector.search(h.agent, { all: true })
  assert.deepEqual(h.state(), [])
  assert.deepEqual(h.selector.snapshot().hidden, [])
  assert.match(all.text, /全部/)
  assert.match(all.text, /已恢复/)
})

await test('未知工具名被过滤：恢复不炸，已下线工具从隐藏集剔除', async () => {
  const h = makeHarness({ settings: { toolsEnabled: true }, probabilities: [0.9, 0.02, 0.02] })
  await h.selector.onPreStep({ kind: 'continue' }, h.agent, USER_MESSAGE)
  assert.deepEqual(h.state(), ['web_search', 'cron_create'])

  // 恢复一个不在隐藏集里的名字：忽略，不动掩码
  const unknown = await h.selector.search(h.agent, { enable: ['nonexistent_tool'] })
  assert.deepEqual(h.state(), ['web_search', 'cron_create'])
  assert.match(unknown.text, /不在隐藏列表/)

  // 工具下线后重建：deny 必须先跟 schemas 求交，否则 restrict 会因未知名字抛错
  h.setTools(DEFAULT_TOOLS.filter((tool) => tool.name !== 'web_search'))
  const after = await h.selector.search(h.agent, { enable: ['cron_create'] })
  assert.notEqual(h.records.at(-1)?.verdict, 'fail', '求交后不该走失败分支')
  assert.deepEqual(h.state(), [])
  assert.deepEqual(h.selector.snapshot().hidden, [])
  assert.match(after.text, /cron_create/)
  assert.ok(!after.text.includes('nonexistent_tool'))
})

console.log(process.exitCode === 1 ? `\n有失败用例（通过 ${passed}）` : `全部 ${passed} 个工具选择用例通过`)