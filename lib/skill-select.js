/**
 * 技能目录按需裁剪。
 *
 * 宿主每轮会把全部技能写成一条 skill-catalog 消息塞进上下文。技能一多，
 * 目录本身就吃掉一大块预算。这里用决策模型给每个技能算一个「与当前任务相关」
 * 的概率，只留靠前的几个，再补一句「按名字仍可加载任意技能」。
 *
 * 三条底线（与插件其它模块一致）：
 * 1. 任何一步失败都原样返回宿主 decision：目录没裁好只是多花点上下文，
 *    裁错或裁空会让模型以为技能不存在——代价不对称。
 * 2. 只替换那一条消息，其余消息和 decision 的其它字段一律不动。
 * 3. 快照不完整就不动手：看不全技能时无法判断漏掉了谁。
 *
 * @module dsh-decision-guard/skill-select
 */

import { randomUUID } from 'node:crypto'

/** 送进 state 的任务文本上限，别把整段对话塞给判定模型。 */
const MAX_TASK_CHARS = 4_000

/** 宿主目录消息的 source.kind。 */
const HOST_CATALOG_KIND = 'skill-catalog'

/** 本模块产出的目录消息的 source.kind。 */
const OWN_CATALOG_KIND = 'decision-guard-skill-catalog'

/**
 * 把消息里的文本块拼起来。
 * @param {any} message 消息
 * @returns {string} 文本
 */
function textOf(message) {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

/**
 * 超长就截断，末尾留个省略号说明没抄全。
 * @param {string} text 文本
 * @param {number} limit 上限
 * @returns {string} 结果
 */
function clip(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/**
 * 目录正文：保留宿主的标签形状，末尾补一句「还能看全部」。
 * @param {Array<{ name: string, description: string }>} entries 入选条目
 * @returns {string} 正文
 */
function renderCatalog(entries) {
  return [
    '<system-reminder>',
    '<available_skills>',
    ...entries.map((entry) => `- ${entry.name}: ${entry.description}`),
    '</available_skills>',
    '这是部分目录，按名字调用 skill 工具仍可加载任意技能，调用 skill_catalog 可看全部。',
    '</system-reminder>',
  ].join('\n')
}

/**
 * 统一成 `{ name, description }`；名字为空的条目直接丢掉。
 * @param {any} raw 快照里的技能
 * @returns {{ name: string, description: string } | undefined} 结果
 */
function normalizeSkill(raw) {
  if (typeof raw?.name !== 'string' || raw.name === '') return undefined
  return { name: raw.name, description: typeof raw.description === 'string' ? raw.description : '' }
}

/**
 * 造一个技能目录选择器。
 *
 * @param {object} options 依赖
 * @param {any} options.ctx 插件上下文（要读 workingDirectory 与 skills）
 * @param {{ judge: (request: { state: Record<string, unknown>, questions: Record<string, unknown>, signal?: AbortSignal }) => Promise<any> }} options.client 判定客户端
 * @param {() => any} options.getSettings 读当前设置
 * @param {{ warn?: (message: string) => void }} [options.logger] 日志
 * @returns {{ onPreStep: (decision: any, agent: any, messages: unknown[], signal?: AbortSignal) => Promise<any>, listSkills: (agent: any, signal?: AbortSignal) => Promise<Array<{ name: string, description: string }>> }} 选择器
 */
export function createSkillSelector({ ctx, client, getSettings, logger }) {
  const warn = (message) => logger?.warn?.(message)

  /**
   * 快照用的 cwd：优先 workingDirectory 解析出来的，其次会话 header。
   * @param {any} agent 会话 agent
   * @param {AbortSignal | undefined} signal 取消信号
   * @returns {Promise<string | undefined>} cwd
   */
  async function resolveCwd(agent, signal) {
    try {
      const directory = ctx.get('workingDirectory')
      const ensured = await directory?.ensure?.(agent, signal)
      if (typeof ensured === 'string' && ensured !== '') return ensured
    } catch {
      /* 解析失败就用会话自己的 cwd */
    }
    const fromHeader = agent?.session?.header?.cwd
    return typeof fromHeader === 'string' ? fromHeader : undefined
  }

  /**
   * 读技能快照；宿主没有快照服务时返回 undefined。
   * @param {any} agent 会话 agent
   * @param {AbortSignal | undefined} signal 取消信号
   * @returns {Promise<any>} 快照
   */
  async function readSnapshot(agent, signal) {
    const skills = ctx.get('skills')
    if (typeof skills?.snapshot !== 'function') return undefined
    const cwd = await resolveCwd(agent, signal)
    return skills.snapshot({ cwd, signal, scope: agent })
  }

  /**
   * 找当前任务：宿主目录之前最后一条用户消息。
   * @param {any[]} messages 消息列表
   * @param {number} catalogIndex 宿主目录的位置
   * @returns {string} 任务文本
   */
  function taskBefore(messages, catalogIndex) {
    for (let index = catalogIndex - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.role !== 'user') continue
      const text = textOf(message)
      if (text !== '') return clip(text, MAX_TASK_CHARS)
    }
    return ''
  }

  /**
   * 裁剪主流程。任何一步拿不到确定答案都返回原 decision。
   * @param {any} decision 宿主决策
   * @param {any} agent 会话 agent
   * @param {AbortSignal | undefined} signal 取消信号
   * @returns {Promise<any>} decision
   */
  async function select(decision, agent, signal) {
    const settings = getSettings()
    if (settings.skillsEnabled !== true) return decision
    if (decision?.kind === 'reject') return decision

    const messages = Array.isArray(decision?.messages) ? decision.messages : []
    // 历史里万一带了旧轮次的目录，取最后一条（本轮那条），别去改上一轮留下的。
    const catalogIndex = messages.findLastIndex((message) => message?.source?.kind === HOST_CATALOG_KIND)
    if (catalogIndex === -1) return decision

    const limit = settings.skillLimit
    const threshold = settings.skillMinProbability

    const snapshot = await readSnapshot(agent, signal)
    if (snapshot?.complete !== true) return decision

    const skills = snapshot.skills.map(normalizeSkill).filter(Boolean)
    if (skills.length <= limit) return decision

    const task = taskBefore(messages, catalogIndex)
    /** @type {Record<string, unknown>} */
    const questions = {}
    const state = {
      task,
      skillCatalog: skills.map((item, index) => ({
        candidate: `candidate-${index}`,
        name: item.name,
        description: item.description,
      })),
    }
    skills.forEach((item, index) => {
      questions[`candidate-${index}`] = {
        type: 'noul',
        instructions: `Would the skill "${item.name}" help with the task described in state.task?`,
        criteria: {
          related: 'The skill directly helps with the task at hand',
          unrelated: 'The skill has nothing to do with the task at hand',
        },
      }
    })

    const judged = await client.judge({ state, questions, signal })
    if (judged?.ok !== true) {
      warn(`技能目录裁剪跳过：判定不可用（${judged?.unavailable ?? 'unknown'}）`)
      return decision
    }

    const answers = judged.answers
    const scored = []
    skills.forEach((item, index) => {
      const answer = answers[`candidate-${index}`]
      if (typeof answer?.noul !== 'number' || !Number.isFinite(answer.noul)) return
      if (answer.noul < threshold) return
      scored.push({ item, probability: answer.noul })
    })
    if (scored.length === 0) {
      warn('技能目录裁剪跳过：没有技能达到相关性阈值')
      return decision
    }

    // 相关性高的排前面；同分保持快照里的原顺序（sort 是稳定的）。
    scored.sort((left, right) => right.probability - left.probability)
    const entries = scored.slice(0, limit).map(({ item }) => ({ name: item.name, description: item.description }))

    const replacement = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: renderCatalog(entries) }],
      source: { kind: OWN_CATALOG_KIND, form: 'catalog', entries },
    }
    const nextMessages = messages.slice()
    nextMessages[catalogIndex] = replacement
    return { ...decision, messages: nextMessages }
  }

  /**
   * pre-step 钩子：在 next() 之后调用，只裁了才换 decision。
   * @param {any} decision 宿主决策
   * @param {any} agent 会话 agent
   * @param {unknown[]} messages 本轮消息（以 decision.messages 为准）
   * @param {AbortSignal | undefined} signal 取消信号
   * @returns {Promise<any>} decision
   */
  async function onPreStep(decision, agent, messages, signal) {
    try {
      return await select(decision, agent, signal)
    } catch (error) {
      warn(`技能目录裁剪失败，保持宿主目录：${error instanceof Error ? error.message : String(error)}`)
      return decision
    }
  }

  /**
   * 全量技能清单，供 skill_catalog 工具用；失败给空数组，不挡工具。
   * @param {any} agent 会话 agent
   * @param {AbortSignal | undefined} signal 取消信号
   * @returns {Promise<Array<{ name: string, description: string }>>} 清单
   */
  async function listSkills(agent, signal) {
    try {
      const snapshot = await readSnapshot(agent, signal)
      if (snapshot?.complete !== true) return []
      return snapshot.skills.map(normalizeSkill).filter(Boolean)
    } catch (error) {
      warn(`读取技能清单失败：${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  return { onPreStep, listSkills }
}