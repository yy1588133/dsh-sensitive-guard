/**
 * 技能目录裁剪自测：不连网、不依赖宿主，用假 ctx + 假 client 验证
 * - 关闭 / 拒绝 / 无宿主目录 / 快照不完整 / 技能数不超限：原样返回
 * - 裁剪结果：换掉宿主那条目录消息，按相关性概率取前 N 个
 * - 概率阈值：没人过线就保持宿主目录，绝不产出空目录
 * - 失败降级：judge 不可用、judge 抛错、快照抛错都原样返回
 * - listSkills：给 skill_catalog 工具的全量清单
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
      text: '<system-reminder>\n<available_skills>\n- alpha: 审计代码\n- beta: 写周报\n- gamma: 边界扫描\n- delta: 画图\n- epsilon: 供应链检查\n</available_skills>\n</system-reminder>',
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
  const agent = { session: { header: { cwd: headerCwd } } }
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

await test('技能选择关闭时原样返回，且不取快照', async () => {
  const { selector, agent, snapshotCalls, judgeCalls } = makeHarness({
    settings: settingsWith({ skillsEnabled: false }),
  })
  const decision = makeDecision()
  const result = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.equal(result, decision)
  assert.equal(snapshotCalls.length, 0)
  assert.equal(judgeCalls.length, 0)
})

await test('decision 被拒绝时原样返回，不碰目录', async () => {
  const { selector, agent, snapshotCalls } = makeHarness()
  const decision = makeDecision({ kind: 'reject' })
  const result = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.equal(result, decision)
  assert.equal(snapshotCalls.length, 0)
})

await test('没有宿主技能目录消息时原样返回', async () => {
  const { selector, agent, snapshotCalls } = makeHarness()
  const decision = makeDecision({
    messages: [{ id: 'u1', role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } }],
  })
  const result = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.equal(result, decision)
  assert.equal(snapshotCalls.length, 0)
})

await test('快照不完整时原样返回，不去判定', async () => {
  const { selector, agent, snapshotCalls, judgeCalls } = makeHarness({
    complete: false,
    skills: [skill('alpha', '审计代码'), skill('beta', '写周报'), skill('gamma', '边界扫描')],
  })
  const decision = makeDecision()
  const result = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.equal(result, decision)
  assert.equal(snapshotCalls.length, 1)
  assert.equal(judgeCalls.length, 0)
})

await test('技能数没超过上限时原样返回，省一次判定', async () => {
  const { selector, agent, judgeCalls } = makeHarness({
    skills: [skill('alpha', '审计代码'), skill('beta', '写周报')],
  })
  const decision = makeDecision()
  const result = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.equal(result, decision)
  assert.equal(judgeCalls.length, 0)
})

await test('按概率裁剪：只留过线的前 N 个，其余消息与 decision 字段不动', async () => {
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
  const decision = makeDecision()
  const result = await selector.onPreStep(decision, agent, undefined, undefined)

  // decision 本身不被就地改写
  assert.notEqual(result, decision)
  assert.equal(decision.messages[1].source.kind, 'skill-catalog')

  // 只换中间那条，其余消息原样引用
  assert.equal(result.messages.length, decision.messages.length)
  assert.equal(result.messages[0], decision.messages[0])
  assert.equal(result.messages[2], decision.messages[2])

  const replaced = result.messages[1]
  assert.equal(replaced.role, 'user')
  assert.equal(replaced.source.kind, 'decision-guard-skill-catalog')
  assert.equal(replaced.source.form, 'catalog')
  // 0.95 与 0.9 过线，按相关性从高到低取前 2
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
  assert.match(text, /这是部分目录，按名字调用 skill 工具仍可加载任意技能，调用 skill_catalog 可看全部/)
  assert.match(text, /<\/system-reminder>$/)

  // cwd 优先取 workingDirectory.ensure 的结果，scope 是 agent
  const snapshotCall = snapshotCalls.find((call) => call.cwd !== undefined)
  assert.equal(snapshotCall.cwd, '/remote/work')
  assert.equal(snapshotCall.scope, agent)
  assert.equal(snapshotCall.signal, undefined)

  // 一道 noul 题对一个候选，题号 candidate-<序号>
  assert.deepEqual(Object.keys(judgeCalls[0].questions), [
    'candidate-0',
    'candidate-1',
    'candidate-2',
    'candidate-3',
    'candidate-4',
  ])
  assert.equal(judgeCalls[0].questions['candidate-0'].type, 'noul')
  assert.equal(judgeCalls[0].state.skillCatalog.length, 5)
  assert.equal(judgeCalls[0].state.skillCatalog[0].name, 'alpha')
  assert.equal(judgeCalls[0].state.task, '帮我审计这个仓库的安全性')
})

await test('概率阈值：全部低于阈值时保持宿主目录，不产出空目录', async () => {
  const { selector, agent, judgeCalls } = makeHarness({
    skills: [skill('alpha', '审计代码'), skill('beta', '写周报'), skill('gamma', '边界扫描')],
    answers: answersOf([0.2, 0.3, 0.49]),
  })
  const decision = makeDecision()
  const result = await selector.onPreStep(decision, agent, undefined, undefined)
  assert.equal(result, decision)
  assert.equal(judgeCalls.length, 1)
})

await test('失败降级：判定不可用、判定抛错、快照抛错都原样返回', async () => {
  const skills = [skill('alpha', '审计代码'), skill('beta', '写周报'), skill('gamma', '边界扫描')]
  const decision = makeDecision()

  const unavailableRun = makeHarness({ skills, unavailable: 'network' })
  assert.equal(await unavailableRun.selector.onPreStep(decision, unavailableRun.agent, undefined, undefined), decision)

  const throwingRun = makeHarness({ skills, judgeThrows: true })
  assert.equal(await throwingRun.selector.onPreStep(decision, throwingRun.agent, undefined, undefined), decision)

  const brokenSnapshot = makeHarness({ snapshotThrows: true })
  assert.equal(await brokenSnapshot.selector.onPreStep(decision, brokenSnapshot.agent, undefined, undefined), decision)
})

await test('listSkills 返回全量清单，不按上限裁剪；cwd 回落到会话 header', async () => {
  const skills = [
    skill('alpha', '审计代码'),
    skill('beta', '写周报'),
    skill('gamma', '边界扫描'),
    skill('delta', '画图'),
    skill('epsilon', '供应链检查'),
  ]
  const { selector, agent, snapshotCalls } = makeHarness({
    skills,
    headerCwd: 'C:/session',
    settings: settingsWith({ skillLimit: 2 }),
  })
  const listed = await selector.listSkills(agent, undefined)
  assert.deepEqual(listed, skills.map(({ name, description }) => ({ name, description })))
  assert.equal(snapshotCalls[0].cwd, 'C:/session')

  const incomplete = makeHarness({ complete: false, skills })
  assert.deepEqual(await incomplete.selector.listSkills(incomplete.agent, undefined), [])
})

console.log(`skill-select: ${passed} passed`)