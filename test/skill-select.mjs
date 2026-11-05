/**
 * 技能目录按需加载自测：不连网、不依赖宿主，用假 ctx + 假 client 验证
 * - 关闭 / 拒绝 / 无宿主目录 / 快照不完整 / 失败：原样返回
 * - 有技能就评估（不再以 skillLimit 为触发门槛）
 * - skillLimit 只是最大保留数：过线超过上限时按概率取前 N，其余进按需池
 * - 全低于阈值：输出空目录加兜底提示
 * - 技能集合指纹不变：第二次不调模型，但仍重写目录
 * - catalog：默认列按需池，scope='all' 列全部，无记录时回退全部
 *
 * 用法：node test/skill-select.mjs
 */

import assert from 'node:assert/strict'
import { createSkillSelector } from '../lib/skill-select.js'

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

/** 默认设置：技能选择打开，最多留 2 个，相关性概率过半才要。 */
const settingsWith = (overrides = {}) => ({
  skillsEnabled: true,
  skillLimit: 2,
  skillMinProbability: 0.5,
  ...overrides,
})

const skill = (name, description) => ({ name, description })

/** 宿主塞进来的那条技能目录消息。 */
const hostCatalog = () => ({
  id: 'host-catalog',
  role: 'user',
  content: [
    {
      type: 'text',
      text: '<system-reminder>\n<available_skills>\n- alpha: 审计代码\n- beta: 写周报\n- gamma: 边界扫描\n</available_skills>\n</system-reminder>',
    },
  ],
  source: { kind: 'skill-catalog', form: 'catalog' },
})

/** 一条普通用户消息 + 宿主目录 + 一条助手消息，目录在中间，方便验证「只换这一条」。 */
const makeDecision = ({ kind = 'accept', messages } = {}) => ({
  kind,
  messages: messages ?? [
    { id: 'u1', role: 'user', content: [{ type: 'text', text: '帮我审计这个仓库的安全性' }], source: { kind: 'user' } },
    hostCatalog(),
    { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '我先看看目录里有哪些技能' }], source: { kind: 'assistant' } },
  ],
})

/** 按候选序号造 noul 答案。 */
const answersOf = (probabilities) =>
  Object.fromEntries(probabilities.map((probability, index) => [`candidate-${index}`, { type: 'noul', noul: probability }]))

/**
 * 假宿主 + 假客户端：快照与判定都记账，方便断言「有没有真的去问」。
 * @param {object} options 场景
 */
function makeHarness({
  complete = true,
  skills = [],
  settings = settingsWith(),
  workingDirectoryCwd,
  headerCwd = 'C:/session',
  snapshotThrows = false,
  answers = {},
  unavailable,
  judgeThrows = false,
} = {}) {
  /** @type {any[]} */
  const snapshotCalls = []
  /** @type {any[]} */
  const judgeCalls = []
  const agent = { id: 'agent-1', session: { header: { cwd: headerCwd } } }
  const workingDirectory =
    workingDirectoryCwd === undefined
      ? undefined
      : {
          ensure: async (scope, signal) => {
            snapshotCalls.push({ ensureScope: scope, ensureSignal: signal })
            return workingDirectoryCwd
          },
        }
  const ctx = {
    get(name) {
      if (name === 'skills') return ctx.skills
      return name === 'workingDirectory' ? workingDirectory : undefined
    },
    skills: {
      async snapshot(options) {
        snapshotCalls.push(options)
        if (snapshotThrows) throw new Error('snapshot boom')
        return { complete, skills }
      },
    },
  }
  const client = {
    async judge(request) {
      judgeCalls.push(request)
      if (judgeThrows) throw new Error('judge boom')
      if (unavailable !== undefined) return { unavailable }
      return { ok: true, answers, model: 'jev-test' }
    },
  }
  const selector = createSkillSelector({
    ctx,
    client,
    getSettings: () => settings,
    logger: { warn: () => {} },
  })
  return { selector, agent, snapshotCalls, judgeCalls }
}

const decision = makeDecision()

// ── 触发条件与降级 ───────────────────────────────────────────────────

await test('技能选择关闭时原样返回，且不取快照', async () => {
  const { selector, agent, snapshotCalls, judgeCalls } = makeHarness({
    settings: settingsWith({ skillsEnabled: false }),
  })
  const result = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.equal(result, decision)
  assert.equal(snapshotCalls.length, 0)
  assert.equal(judgeCalls.length, 0)
})

await test('decision 被拒绝时原样返回，不碰目录', async () => {
  const { selector, agent, snapshotCalls } = makeHarness()
  const rejected = makeDecision({ kind: 'reject' })
  const result = await selector.onPreStep(rejected, agent, undefined, undefined)
  assert.equal(result, rejected)
  assert.equal(snapshotCalls.length, 0)
})

await test('没有宿主技能目录消息时原样返回', async () => {
  const { selector, agent, snapshotCalls } = makeHarness()
  const bare = makeDecision({
    messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }],
  })
  const result = await selector.onPreStep(bare, agent, undefined, undefined)
  assert.equal(result, bare)
  assert.equal(snapshotCalls.length, 0)
})

await test('快照不完整时原样返回，不去判定', async () => {
  const { selector, agent, snapshotCalls, judgeCalls } = makeHarness({
    complete: false,
    skills: [skill('alpha', '审计代码'), skill('beta', '写周报')],
  })
  const result = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.equal(result, decision)
  assert.equal(snapshotCalls.length, 1)
  assert.equal(judgeCalls.length, 0)
})

await test('失败降级：判定不可用、判定抛错、快照抛错都原样返回', async () => {
  const skills = [skill('alpha', '审计代码'), skill('beta', '写周报'), skill('gamma', '边界扫描')]
  const unavailableRun = makeHarness({ skills, unavailable: 'network' })
  assert.equal(await unavailableRun.selector.onPreStep(decision, unavailableRun.agent, undefined, undefined), decision)

  const throwingRun = makeHarness({ skills, judgeThrows: true })
  assert.equal(await throwingRun.selector.onPreStep(decision, throwingRun.agent, undefined, undefined), decision)

  const brokenSnapshot = makeHarness({ snapshotThrows: true })
  assert.equal(await brokenSnapshot.selector.onPreStep(decision, brokenSnapshot.agent, undefined, undefined), decision)
})

// ── 评估与保留语义 ───────────────────────────────────────────────────

await test('技能数小于上限也评估：全部过线就全保留', async () => {
  const skills = [skill('alpha', '审计代码'), skill('beta', '写周报')]
  const { selector, agent, judgeCalls } = makeHarness({ skills, answers: answersOf([0.9, 0.8]) })
  const result = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.notEqual(result, decision)
  assert.equal(judgeCalls.length, 1)
  assert.deepEqual(
    result.messages[1].source.entries.map((entry) => entry.name),
    ['alpha', 'beta'],
  )
})

await test('上限只是最大保留数：过线超过上限时按概率取前 N，其余进按需池', async () => {
  const skills = [
    skill('alpha', '审计代码'),
    skill('beta', '写周报'),
    skill('gamma', '边界扫描'),
    skill('delta', '画图'),
    skill('epsilon', '供应链检查'),
  ]
  const { selector, agent, snapshotCalls, judgeCalls } = makeHarness({
    skills,
    workingDirectoryCwd: '/remote/work',
    answers: answersOf([0.9, 0.2, 0.8, 0.1, 0.95]),
  })
  const result = await selector.onPreStep(decision, agent, undefined, undefined)

  // decision 本身不被就地改写；只换中间那条
  assert.notEqual(result, decision)
  assert.equal(decision.messages[1].source.kind, 'skill-catalog')
  assert.equal(result.messages.length, decision.messages.length)
  assert.equal(result.messages[0], decision.messages[0])
  assert.equal(result.messages[2], decision.messages[2])

  const replaced = result.messages[1]
  assert.equal(replaced.role, 'user')
  assert.equal(replaced.source.kind, 'decision-guard-skill-catalog')
  // 0.95 与 0.9 过线且不超过 2 个上限，按相关性从高到低
  assert.deepEqual(
    replaced.source.entries.map((entry) => entry.name),
    ['epsilon', 'alpha'],
  )
  assert.ok(typeof replaced.id === 'string' && replaced.id.length > 0)

  const text = replaced.content[0].text
  assert.match(text, /^<system-reminder>\n<available_skills>\n/)
  assert.match(text, /- epsilon: 供应链检查/)
  assert.match(text, /- alpha: 审计代码/)
  assert.doesNotMatch(text, /- beta: 写周报/)
  assert.doesNotMatch(text, /- gamma: 边界扫描/)
  assert.match(text, /其余技能按需加载/)
  assert.match(text, /<\/system-reminder>$/)

  // cwd 优先取 workingDirectory.ensure 的结果，scope 是 agent
  const snapshotCall = snapshotCalls.find((call) => call.cwd !== undefined)
  assert.equal(snapshotCall.cwd, '/remote/work')
  assert.equal(snapshotCall.scope, agent)

  // 一道 noul 题对一个候选
  assert.deepEqual(Object.keys(judgeCalls[0].questions), ['candidate-0', 'candidate-1', 'candidate-2', 'candidate-3', 'candidate-4'])
  assert.equal(judgeCalls[0].questions['candidate-0'].type, 'noul')
  assert.equal(judgeCalls[0].state.skillCatalog.length, 5)
  assert.equal(judgeCalls[0].state.task, '帮我审计这个仓库的安全性')

  // 按需池只包含被裁掉的三个
  const deferred = await selector.catalog(agent, 'deferred', undefined)
  assert.deepEqual(
    deferred.skills.map((entry) => entry.name).sort(),
    ['beta', 'delta', 'gamma'],
  )
  assert.match(deferred.note, /按名字调用 skill 工具/)
})

await test('全低于阈值：输出空目录与兜底提示，而不是保留全量', async () => {
  const { selector, agent, judgeCalls } = makeHarness({
    skills: [skill('alpha', '审计代码'), skill('beta', '写周报'), skill('gamma', '边界扫描')],
    answers: answersOf([0.2, 0.3, 0.49]),
  })
  const result = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.notEqual(result, decision)
  assert.equal(judgeCalls.length, 1)
  assert.deepEqual(result.messages[1].source.entries, [])
  const text = result.messages[1].content[0].text
  assert.match(text, /本会话没有常驻技能摘要/)
  assert.match(text, /skill_catalog/)
  assert.doesNotMatch(text, /<available_skills>/)
})

await test('技能集合指纹不变：第二次不调模型，但仍重写目录', async () => {
  const skills = [skill('alpha', '审计代码'), skill('beta', '写周报')]
  const { selector, agent, judgeCalls } = makeHarness({ skills, answers: answersOf([0.9, 0.1]) })
  const first = await selector.onPreStep(decision, agent, undefined, undefined)
  const second = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.equal(judgeCalls.length, 1)
  assert.notEqual(first, second)
  assert.deepEqual(
    second.messages[1].source.entries.map((entry) => entry.name),
    ['alpha'],
  )
})

// ── 召回工具 ────────────────────────────────────────────────────────

await test('catalog：默认只列按需池，all 列全部，无记录时回退全部', async () => {
  const skills = [skill('alpha', '审计代码'), skill('beta', '写周报'), skill('gamma', '边界扫描')]
  const { selector, agent } = makeHarness({ skills, answers: answersOf([0.9, 0.2, 0.2]) })
  await selector.onPreStep(decision, agent, undefined, undefined)

  const deferred = await selector.catalog(agent, 'deferred', undefined)
  assert.deepEqual(deferred.skills.map((entry) => entry.name).sort(), ['beta', 'gamma'])

  const all = await selector.catalog(agent, 'all', undefined)
  assert.deepEqual(all.skills.map((entry) => entry.name), ['alpha', 'beta', 'gamma'])
  assert.equal(all.note, '')

  // 没评估过的会话：回退列全部，并说明没有按需技能
  const fresh = makeHarness({ skills })
  const fallback = await fresh.selector.catalog(fresh.agent, 'deferred', undefined)
  assert.deepEqual(fallback.skills.map((entry) => entry.name), ['alpha', 'beta', 'gamma'])
  assert.match(fallback.note, /全部可加载技能/)

  const broken = makeHarness({ complete: false, skills })
  const unavailable = await broken.selector.catalog(broken.agent, 'deferred', undefined)
  assert.deepEqual(unavailable.skills, [])
  assert.match(unavailable.note, /暂时不可用/)
})

await test('技能设置变了：同一技能集合也要重新判定', async () => {
  const settings = settingsWith({ skillLimit: 2 })
  const skills = [skill('alpha', '审计代码'), skill('beta', '写周报'), skill('gamma', '边界扫描')]
  const { selector, agent, judgeCalls } = makeHarness({
    skills,
    settings,
    answers: answersOf([0.9, 0.8, 0.7]),
  })

  const first = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.equal(judgeCalls.length, 1)
  assert.equal(first.messages[1].source.entries.length, 2)

  settings.skillLimit = 1
  const second = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.equal(judgeCalls.length, 2, '设置变了应重新判定')
  assert.deepEqual(second.messages[1].source.entries.map((entry) => entry.name), ['alpha'])
})

console.log(`skill-select: ${passed} passed`)