/**
 * 技能目录按需加载。
 *
 * 宿主每轮会把全部技能写成一条 skill-catalog 消息塞进上下文。技能一多，
 * 目录本身就吃掉一大块预算。这里让决策模型逐个判断「这个技能对当前任务有没有用」，
 * 只把过线的、且不超过 skillLimit 的留在目录里；其余的进按需池，模型用
 * skill_catalog 查、用 skill 按名加载。
 *
 * 三条底线（与插件其它模块一致）：
 * 1. 任何一步失败都原样返回宿主 decision：目录没裁好只是多花点上下文，
 *    裁错或裁空会让模型以为技能不存在——代价不对称。
 * 2. 只替换那一条消息，其余消息和 decision 的其它字段一律不动。
 * 3. 快照不完整就不动手：看不全技能时无法判断漏掉了谁。
 *
 * 评估频率：每个会话一次。技能集合（名字 + 描述）的指纹变了才重新问模型，
 * 否则复用上次结果、只重写目录消息——目录内容稳定，prompt 前缀不会每轮抖动。
 *
 * @module dsh-decision-guard/skill-select
 */

import { createHash, randomUUID } from 'node:crypto'
import { isFirstUserTurn } from './session-state.js'

/** 送进 state 的任务文本上限，别把整段对话塞给判定模型。 */
const MAX_TASK_CHARS = 4_000

/** 宿主目录消息的 source.kind。 */
const HOST_CATALOG_KIND = 'skill-catalog'

/** 本模块产出的目录消息的 source.kind。 */
const OWN_CATALOG_KIND = 'decision-guard-skill-catalog'

/** 按需池非空时给模型的说明。 */
const DEFERRED_NOTE = '以下技能未进常驻目录，按名字调用 skill 工具即可加载。'

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
 * 统一成 `{ name, description }`；名字为空的条目直接丢掉。
 * @param {any} raw 快照里的技能
 * @returns {{ name: string, description: string } | undefined} 结果
 */
function normalizeSkill(raw) {
  if (typeof raw?.name !== 'string' || raw.name === '') return undefined
  return { name: raw.name, description: typeof raw.description === 'string' ? raw.description : '' }
}

/**
 * 技能集合的指纹：名字与描述都算，任何一个变了都重新评估。
 * @param {Array<{ name: string, description: string }>} skills 技能清单
 * @returns {string} 指纹
 */
function fingerprintOf(skills) {
  return createHash('sha256').update(JSON.stringify(skills)).digest('hex')
}

/**
 * 目录正文。全裁时不留空标签，直接给一句「去哪里找」。
 * @param {Array<{ name: string, description: string }>} entries 保留条目
 * @returns {string} 正文
 */
function renderCatalog(entries) {
  if (entries.length === 0) {
    return [
      '<system-reminder>',
      '本会话没有常驻技能摘要。调用 skill_catalog 可查看全部可加载技能，按名字调用 skill 工具即可加载任意技能。',
      '</system-reminder>',
    ].join('\n')
  }
  return [
    '<system-reminder>',
    '<available_skills>',
    ...entries.map((entry) => `- ${entry.name}: ${entry.description}`),
    '</available_skills>',
    '这是部分目录。其余技能按需加载：调用 skill_catalog 查看，按名字调用 skill 工具即可加载。',
    '</system-reminder>',
  ].join('\n')
}

/**
 * 造一个技能目录选择器。
 *
 * @param {object} options 依赖
 * @param {any} options.ctx 插件上下文（要读 workingDirectory 与 skills）
 * @param {{ judge: (request: { state: Record<string, unknown>, questions: Record<string, unknown>, signal?: AbortSignal }) => Promise<any> }} options.client 判定客户端
 * @param {() => any} options.getSettings 读当前设置
 * @param {{ warn?: (message: string) => void }} [options.logger] 日志
 * @returns {{ onPreStep: Function, catalog: Function }} 选择器
 */
export function createSkillSelector({ ctx, client, getSettings, logger, record, state }) {
  const warn = (message) => logger?.warn?.(message)
  /** @param {object} entry 记录内容 */
  const emit = (entry) => record?.({ feature: 'skill-selection', ...entry })
  /**
   * 每个会话的最近一次评估结果。
   * @type {Map<unknown, { fingerprint: string, retained: Array<{ name: string, description: string }>, deferred: Array<{ name: string, description: string }> }>}
   */
  const sessions = new Map()

  /** @param {any} agent agent @returns {string} 会话键 */
  const keyOf = (agent) => agent.id

  /**
   * 最后一条真正的用户消息文本；同一 turn 的后续 step 不会变。
   * @param {any[]} messages 消息列表
   * @returns {string} 文本
   */
  function lastUserTextOf(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.role !== 'user' || message?.source?.kind !== 'user') continue
      return clip(textOf(message), MAX_TASK_CHARS)
    }
    return ''
  }

  /**
   * 把宿主目录消息替换成裁剪后的版本，其余消息原样保留。
   * @param {any} decision 宿主决策
   * @param {any[]} messages 消息列表
   * @param {number} catalogIndex 目录位置
   * @param {Array<{ name: string, description: string }>} entries 保留条目
   * @returns {any} 新 decision
   */
  function withCatalog(decision, messages, catalogIndex, entries) {
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
   * 问一次模型：每个技能一道 noul 题，一次请求批量问完。
   *
   * 保留规则：概率 >= 阈值，按概率降序取前 skillLimit 个；不凑数，
   * 剩下的全部进按需池。任何一题答案不合法都整次放弃。
   * @param {Array<{ name: string, description: string }>} skills 技能清单
   * @param {string} task 当前任务文本
   * @param {AbortSignal | undefined} signal 取消信号
   * @returns {Promise<{ retained: Array<{ name: string, description: string }>, deferred: Array<{ name: string, description: string }> } | undefined>} 结果
   */
  async function judgeSkills(skills, task, signal) {
    const settings = getSettings()
    const limit = settings.skillLimit
    const threshold = settings.skillMinProbability

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
      return undefined
    }

    const answers = judged.answers
    /** @type {Array<{ item: { name: string, description: string }, probability: number }>} */
    const scored = []
    for (const [index, item] of skills.entries()) {
      const answer = answers[`candidate-${index}`]
      if (typeof answer?.noul !== 'number' || !Number.isFinite(answer.noul)) {
        warn(`技能目录裁剪跳过：技能 ${item.name} 的答案不合法`)
        return undefined
      }
      scored.push({ item, probability: answer.noul })
    }

    const passed = scored
      .filter((entry) => entry.probability >= threshold)
      .sort((left, right) => right.probability - left.probability)
    // 上限只裁掉「过线太多」的部分，不拿来凑数：过线 3 个就留 3 个。
    const retained = passed.slice(0, limit).map((entry) => entry.item)
    const retainedNames = new Set(retained.map((item) => item.name))
    const deferred = skills.filter((item) => !retainedNames.has(item.name))
    return { retained, deferred }
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

    const messages = decision.messages
    // 历史里万一带了旧轮次的目录，取最后一条（本轮那条），别去改上一轮留下的。
    const catalogIndex = messages.findLastIndex((message) => message?.source?.kind === HOST_CATALOG_KIND)
    if (catalogIndex === -1) return decision

    const lastUser = lastUserTextOf(messages)
    const cached = sessions.get(keyOf(agent))
    // 同一 turn 的后续 step：没有新用户消息、设置也没变，直接用上次结果重写目录，不读快照。
    if (
      cached !== undefined &&
      cached.lastUser === lastUser &&
      cached.limit === settings.skillLimit &&
      cached.minProbability === settings.skillMinProbability
    ) {
      if (cached.failed === true) return decision
      return withCatalog(decision, messages, catalogIndex, cached.retained)
    }

    // 重启后：磁盘上有这个会话的结果，指纹对得上就直接恢复，不再问模型。
    const saved = state?.getSkill(keyOf(agent))
    if (saved !== undefined && Array.isArray(saved.retained)) {
      const snapshot = await readSnapshot(agent, signal)
      if (snapshot?.complete === true) {
        const skills = snapshot.skills.map(normalizeSkill).filter(Boolean)
        const fingerprint = fingerprintOf([settings.skillLimit, settings.skillMinProbability, skills])
        if (fingerprint === saved.fingerprint) {
          sessions.set(keyOf(agent), { ...saved, lastUser })
          return withCatalog(decision, messages, catalogIndex, saved.retained)
        }
      }
      // 技能集合变了：不是首轮就不再重判，保持宿主目录。
      if (!isFirstUserTurn(agent)) return decision
    } else if (!isFirstUserTurn(agent)) {
      // 插件开启前就存在的会话：没有历史结果，也不是首轮——不评估。
      return decision
    }

    const snapshot = await readSnapshot(agent, signal)
    if (snapshot?.complete !== true) return decision

    const skills = snapshot.skills.map(normalizeSkill).filter(Boolean)
    if (skills.length === 0) return decision

    // 指纹带上影响结果的设置：改了上限或阈值，本会话也要重新判定。
    const fingerprint = fingerprintOf([settings.skillLimit, settings.skillMinProbability, skills])
    if (cached !== undefined && cached.failed !== true && cached.fingerprint === fingerprint) {
      // 新用户消息，但技能集合与设置都没变：复用结果，只更新“最后一条用户消息”。
      sessions.set(keyOf(agent), { ...cached, lastUser })
      return withCatalog(decision, messages, catalogIndex, cached.retained)
    }

    const judged = await judgeSkills(skills, taskBefore(messages, catalogIndex), signal)
    if (judged === undefined) {
      sessions.set(keyOf(agent), {
        fingerprint,
        retained: [],
        deferred: [],
        failed: true,
        lastUser,
        limit: settings.skillLimit,
        minProbability: settings.skillMinProbability,
      })
      emit({ verdict: 'fail', reason: 'judge-unavailable', total: skills.length })
      return decision
    }
    const retained = judged.retained
    const deferred = judged.deferred
    sessions.set(keyOf(agent), {
      fingerprint,
      retained,
      deferred,
      lastUser,
      limit: settings.skillLimit,
      minProbability: settings.skillMinProbability,
    })
    // 记住这次结果，重启后同一个会话直接恢复。
    state?.setSkill(keyOf(agent), { fingerprint, retained, deferred })
    emit({
      verdict: retained.length === 0 ? 'trim-all' : 'trim',
      retained: retained.map((item) => item.name),
      deferred: deferred.map((item) => item.name),
      total: skills.length,
    })
    return withCatalog(decision, messages, catalogIndex, retained)
  }

  /**
   * pre-step 钩子：在 next() 之后调用，只裁了才换 decision。
   * @param {any} decision 宿主决策
   * @param {any} agent 会话 agent
   * @param {unknown[]} messages 本轮消息（以 decision.messages 为准，这里不用）
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
   * 给 skill_catalog 工具用：默认只列按需池，scope='all' 列全部。
   * 没有评估记录（功能关闭 / 还没轮到）时退回列全部，别让模型以为没有技能。
   * @param {any} agent 会话 agent
   * @param {'deferred' | 'all'} scope 范围
   * @param {AbortSignal | undefined} signal 取消信号
   * @returns {Promise<{ skills: Array<{ name: string, description: string }>, note: string }>} 结果
   */
  async function catalog(agent, scope, signal) {
    let snapshot
    try {
      snapshot = await readSnapshot(agent, signal)
    } catch {
      return { skills: [], note: '技能清单暂时不可用，稍后再试。' }
    }
    if (snapshot?.complete !== true) return { skills: [], note: '技能清单暂时不可用，稍后再试。' }
    const all = snapshot.skills.map(normalizeSkill).filter(Boolean)
    if (scope === 'all') return { skills: all, note: '' }

    const names = new Set(all.map((item) => item.name))
    const session = sessions.get(keyOf(agent))
    if (session?.failed === true) {
      return { skills: all, note: '上次技能判定失败，以下先按全量列出。' }
    }
    const deferred = session === undefined ? [] : session.deferred.filter((item) => names.has(item.name))
    if (deferred.length === 0) {
      return { skills: all, note: all.length === 0 ? '' : '当前没有按需技能，以下是全部可加载技能。' }
    }
    return { skills: deferred, note: DEFERRED_NOTE }
  }

  return { onPreStep, catalog }
}