/**
 * 工具按需加载：让决策模型在会话开局判断哪些工具跟当前任务无关，
 * 用 `ctx.tools.restrict({ deny })` 暂时摘掉，模型需要时再用 tool_search 取回。
 *
 * 所有失败路径都朝「不摘」走：判定不了就维持原生工具清单。
 * 摘工具只是省 token 的优化，绝不能变成阻断——工具少一个，模型就会绕路或卡住。
 *
 * @module dsh-decision-guard/tool-select
 */

/**
 * 少了它们，模型连「把工具找回来」这一步都做不到，任何设置都不能摘。
 * 与 store.js 的 DEFAULT_TOOL_WHITELIST 保持一致（这里只放不可让渡的核心项）。
 */
export const CORE_TOOLS = Object.freeze([
  'read',
  'write',
  'edit',
  'bash',
  'glob',
  'grep',
  'todo',
  'skill',
  'tool_search',
])

/** 题目里工具描述的截断长度：描述只是给模型的提示，不必全文外发。 */
const DESCRIPTION_LIMIT = 300

/** 列表展示时的描述截断长度。 */
const LIST_DESCRIPTION_LIMIT = 80

/** 用户任务文本的截断长度。 */
const TASK_LIMIT = 1200

/**
 * 截断长文本并留下明确标记，避免把「省略」误当成原文结尾。
 * @param {unknown} value 原值
 * @param {number} max 上限字符数
 * @returns {string} 截断结果
 */
function clip(value, max) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text
}

/**
 * 粗估一段文本的 token 数。
 *
 * ponytail: 按字符数估算（中文每字约 1 token、英文 4 字符约 1 token，这里折中除以 2）。
 * 只用于面板展示「大约省了多少」，需要精确数字时换成真正的分词器。
 * @param {unknown} value 文本
 * @returns {number} 估算 token 数
 */
function estimateTokens(value) {
  return Math.ceil(String(value ?? '').length / 2)
}

/** @param {unknown} error 异常 @returns {string} 可读文本 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 从一条会话消息里取纯文本。
 * @param {any} message 消息
 * @returns {string} 文本
 */
function textOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * 只取用户说的话：判定的是「用户这轮要干什么」，不含助手的自述。
 * @param {any} messages 消息数组
 * @returns {string} 用户文本
 */
function userTextOf(messages) {
  if (!Array.isArray(messages)) return ''
  return messages
    .filter((message) => message?.source?.kind === 'user')
    .map(textOf)
    .filter((text) => text !== '')
    .join('\n')
}

/**
 * 是否出现了「有文本的用户消息」——这是评估的唯一触发条件。
 * @param {any} messages 消息数组
 * @returns {boolean} 是否触发
 */
function hasUserText(messages) {
  if (!Array.isArray(messages)) return false
  return messages.some((message) => message?.source?.kind === 'user' && textOf(message).trim() !== '')
}

/**
 * 把 `ctx.tools.schemas(agent)` 的返回值规整成 `{ name, description }` 列表。
 * 形状随宿主版本可能略有差异（数组或 `{ tools: [...] }`），这里都认。
 * @param {unknown} raw 原始返回值
 * @returns {Array<{ name: string; description: string }>} 工具清单
 */
function normalizeSchemas(raw) {
  if (!Array.isArray(raw)) return []
  const schemas = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const name = /** @type {any} */ (item).name
    if (typeof name !== 'string' || name === '') continue
    const description = /** @type {any} */ (item).description
    schemas.push({ name, description: typeof description === 'string' ? description : '' })
  }
  return schemas
}

/**
 * 白名单 = 核心保护名单 ∪ 用户追加的名单。
 * @param {any} settings 设置
 * @returns {Set<string>} 永不摘除的工具名
 */
function whitelistOf(settings) {
  const extra = Array.isArray(settings?.toolWhitelist)
    ? settings.toolWhitelist.filter((name) => typeof name === 'string' && name !== '')
    : []
  return new Set([...CORE_TOOLS, ...extra])
}

/**
 * 撤销一组 restrict disposer（可能来自整批一次，也可能来自逐个重试）。
 * 某个撤销失败不能让其余掩码留在树上：掩码最多维持到这个会话结束。
 * @param {any[]} disposers disposer 列表
 */
function releaseDisposers(disposers) {
  for (const disposer of disposers) {
    try {
      disposer()
    } catch {
      /* 撤销失败只影响工具可见性，不影响主流程 */
    }
  }
}

/** 工具选择器：一个会话一个状态，评估一次，随时可恢复。 */
class ToolSelector {
  #ctx
  #client
  #getSettings
  #logger
  #record
  #sessions = new Map()
  #last = null

  /**
   * @param {object} options 依赖
   * @param {any} options.ctx 插件上下文（只用 ctx.tools.schemas）
   * @param {{ judge: (request: { state: object; questions: object; signal?: AbortSignal }) => Promise<any> }} options.client 决策客户端
   * @param {() => any} options.getSettings 读当前设置
   * @param {{ warn?: (message: string) => void }} options.logger 日志
   * @param {(entry: object) => void} [options.record] 判定记录
   */
  constructor({ ctx, client, getSettings, logger, record }) {
    this.#ctx = ctx
    this.#client = client
    this.#getSettings = getSettings
    this.#logger = logger
    this.#record = record
  }

  /**
   * @param {any} agent agent
   * @returns {{ evaluated: boolean; hidden: Set<string>; descriptions: Map<string, string>; disposers: any[]; savedTokens: number }} 会话状态
   */
  #sessionOf(agent) {
    let session = this.#sessions.get(agent.id)
    if (session === undefined) {
      session = { evaluated: false, hidden: new Set(), descriptions: new Map(), disposers: [], savedTokens: 0 }
      this.#sessions.set(agent.id, session)
    }
    return session
  }

  /** @param {any} agent agent @returns {any} 已存在的会话状态，不创建 */
  #sessionFor(agent) {
    return this.#sessions.get(agent?.id)
  }

  /** @param {object} entry 记录内容 */
  #emit(entry) {
    if (typeof this.#record !== 'function') return
    this.#record({ feature: 'tool-select', ...entry })
  }

  /** @param {string} text 日志内容 */
  #warn(text) {
    this.#logger?.warn?.(`dsh-decision-guard: ${text}`)
  }

  /** @param {any} agent agent @returns {Promise<Array<{ name: string; description: string }>>} 当前工具清单 */
  async #schemas(agent) {
    return normalizeSchemas(await this.#ctx.tools.schemas(agent))
  }

  /**
   * 记一条失败：一律不摘工具，只留记录。
   * @param {string} reason 失败类别
   * @param {string} detail 细节
   */
  #fail(reason, detail) {
    const entry = {
      verdict: 'fail',
      reason: detail === '' ? reason : `${reason}: ${detail}`,
      hidden: [],
      kept: [],
      savedTokens: 0,
    }
    this.#emit(entry)
    this.#last = { at: new Date().toISOString(), ...entry }
  }

  /**
   * 每个会话的第一条用户消息触发一次评估，然后按结果摘工具。
   *
   * 由 `agent/pre-step` 在 `next()` 之后调用；无论发生什么，
   * 都返回传进来的同一个 decision，不改动主流程。
   * @param {any} decision 下游给出的 decision
   * @param {any} agent 活着的 agent
   * @param {any} messages 本轮消息
   * @param {AbortSignal | undefined} signal 取消信号
   * @returns {Promise<any>} 原样的 decision
   */
  async onPreStep(decision, agent, messages, signal) {
    try {
      const settings = this.#getSettings()
      if (settings.toolsEnabled !== true) return decision
      const session = this.#sessionOf(agent)
      if (session.evaluated) return decision
      if (!hasUserText(messages)) return decision
      // 先置位：评估只做一次，失败也不重试，免得每轮都打一次决策模型。
      session.evaluated = true
      await this.#evaluate(agent, session, messages, signal)
    } catch (error) {
      this.#warn(`工具选择评估异常：${errorText(error)}`)
    }
    return decision
  }

  /**
   * 跑一次评估：拿清单、出题、问模型、按概率摘工具。
   * @param {any} agent agent
   * @param {any} session 会话状态
   * @param {any} messages 消息
   * @param {AbortSignal | undefined} signal 取消信号
   */
  async #evaluate(agent, session, messages, signal) {
    const settings = this.#getSettings()
    let schemas
    try {
      schemas = await this.#schemas(agent)
    } catch (error) {
      this.#fail('schemas', errorText(error))
      return
    }

    const whitelist = whitelistOf(settings)
    const candidates = schemas.filter((schema) => !whitelist.has(schema.name))
    session.descriptions = new Map(schemas.map((schema) => [schema.name, schema.description]))

    if (candidates.length === 0) {
      const entry = { verdict: 'keep', reason: 'no-candidates', hidden: [], kept: [], savedTokens: 0 }
      this.#emit(entry)
      this.#last = { at: new Date().toISOString(), ...entry }
      return
    }

    /** @type {Record<string, object>} */
    const questions = {}
    for (const [index, schema] of candidates.entries()) {
      const description = clip(schema.description, DESCRIPTION_LIMIT)
      questions[String(index)] = {
        type: 'noul',
        instructions: `当前任务需要用工具「${schema.name}」吗？工具名：${schema.name}；工具说明：${description === '' ? '（没有说明）' : description}`,
        criteria: { true: '与当前任务相关，应当保留', false: '与当前任务无关，可以暂时隐藏' },
      }
    }
    const state = {
      feature: 'tool-selection',
      task: clip(userTextOf(messages), TASK_LIMIT),
      toolCount: candidates.length,
    }

    let result
    try {
      result = await this.#client.judge({ state, questions, signal })
    } catch (error) {
      this.#fail('exception', errorText(error))
      return
    }
    if (result.ok !== true) {
      this.#fail('unavailable', String(result.unavailable))
      return
    }
    const answers = result.answers

    const threshold = settings.toolMinProbability
    const hide = []
    const kept = []
    for (const [index, schema] of candidates.entries()) {
      const answer = answers[String(index)]
      const probability =
        answer?.type === 'noul' && typeof answer.noul === 'number' && Number.isFinite(answer.noul)
          ? answer.noul
          : undefined
      if (probability === undefined) {
        // 少一题就整次放弃：不做半截裁剪，免得模型以为工具真的不存在。
        this.#fail('invalid-answer', `工具 ${schema.name} 的答案不合法`)
        return
      }
      if (probability >= threshold) kept.push(schema.name)
      else hide.push(schema.name)
    }

    await this.#applyMask(agent, session, hide, kept, 'judge')
  }

  /**
   * 应用掩码：先整批 restrict，失败再逐个重试。
   *
   * 有些工具是 agent 作用域注册的（如 dsh-ops 的 ops_bash），出现在 schemas 里，
   * 但不在全局可限制名单内——宿主会把整批调用一起拒掉。退回逐个后只有那一个失败，
   * 其余工具照常隐藏。
   * @param {any} agent agent
   * @param {string[]} deny 想隐藏的工具名（已与 schemas 求交）
   * @returns {Promise<{ applied: string[]; disposers: any[]; error: string }>} 真正生效的工具与 disposer
   */
  async #restrictTools(agent, deny) {
    try {
      return { applied: [...deny], disposers: [await agent.ctx.tools.restrict({ deny })], error: '' }
    } catch (error) {
      // 整批被拒：逐个重试，失败的（作用域工具/已下线）跳过。
      const firstError = errorText(error)
      const applied = []
      const disposers = []
      for (const name of deny) {
        try {
          disposers.push(await agent.ctx.tools.restrict({ deny: [name] }))
          applied.push(name)
        } catch {
          /* 这一个摘不掉，不影响其它工具 */
        }
      }
      return { applied, disposers, error: firstError }
    }
  }

  /**
   * 重建工具掩码：先撤销旧掩码，再以「剩余隐藏集 ∩ 当前清单」重新 restrict。
   * 未知名、已下线、白名单里的工具一律不传进 restrict（否则宿主会抛错）。
   * @param {any} agent agent
   * @param {any} session 会话状态
   * @param {string[]} hide 想隐藏的工具名
   * @param {string[]} kept 明确保留的工具名（仅用于记录）
   * @param {string} reason 本次重建的原因
   */
  async #applyMask(agent, session, hide, kept, reason) {
    const whitelist = whitelistOf(this.#getSettings())

    // 先撤掉旧掩码再取清单：schemas() 返回的是「当前可见工具」，带着旧掩码
    // 查会看不到刚隐藏的那些，于是恢复一个就误放其余。
    releaseDisposers(session.disposers)
    session.disposers = []
    session.hidden = new Set()
    session.savedTokens = 0

    let schemas
    try {
      schemas = await this.#schemas(agent)
    } catch (error) {
      this.#fail('schemas', errorText(error))
      return
    }
    session.descriptions = new Map(schemas.map((schema) => [schema.name, schema.description]))
    const available = new Set(schemas.map((schema) => schema.name))
    const deny = hide.filter((name) => available.has(name) && !whitelist.has(name))

    if (deny.length > 0) {
      const { applied, disposers, error: restrictError } = await this.#restrictTools(agent, deny)
      // 全部失败才记失败：那时也的确一个都没摘，保持工具清单完整。
      if (applied.length === 0) {
        this.#fail('restrict', restrictError)
        return
      }
      const skipped = deny.filter((name) => !applied.includes(name))
      if (skipped.length > 0) {
        this.#warn(`这些工具无法隐藏（作用域注册或已下线），已跳过：${skipped.join('、')}`)
      }
      session.disposers = disposers
      session.hidden = new Set(applied)
      session.savedTokens = applied.reduce(
        (total, name) => total + estimateTokens(`${name}\n${session.descriptions.get(name) ?? ''}`),
        0,
      )
    }

    const entry = {
      verdict: deny.length > 0 ? 'hide' : 'keep',
      reason,
      hidden: [...session.hidden],
      kept,
      savedTokens: session.savedTokens,
    }
    this.#emit(entry)
    this.#last = { at: new Date().toISOString(), ...entry }
  }

  /**
   * `tool_search` 工具的后端：列隐藏工具、恢复指定工具、恢复全部。
   * @param {any} agent agent
   * @param {{ query?: string; enable?: string[]; all?: boolean }} [args] 参数
   * @param {AbortSignal} [signal] 取消信号（当前只透传，恢复本身不联网）
   * @returns {Promise<{ text: string }>} 回给模型的中文说明
   */
  async search(agent, args = {}, signal) {
    try {
      const session = this.#sessionFor(agent)
      if (session === undefined || session.hidden.size === 0) {
        return { text: '当前没有隐藏的工具，工具清单是完整的。' }
      }

      if (args?.all === true) {
        const restored = [...session.hidden]
        await this.#applyMask(agent, session, [], [], 'restore-all')
        return { text: `已恢复全部 ${restored.length} 个隐藏工具：${restored.join('、')}。工具清单已回到完整状态。` }
      }

      const enable = Array.isArray(args?.enable)
        ? args.enable.filter((name) => typeof name === 'string' && name !== '')
        : []
      if (enable.length > 0) {
        const hidden = [...session.hidden]
        const restored = hidden.filter((name) => enable.includes(name))
        const unknown = enable.filter((name) => !hidden.includes(name))
        if (restored.length > 0) {
          const remaining = hidden.filter((name) => !restored.includes(name))
          await this.#applyMask(agent, session, remaining, [], 'restore')
        }
        const lines = []
        if (restored.length > 0) lines.push(`已恢复 ${restored.length} 个工具：${restored.join('、')}。`)
        if (unknown.length > 0) lines.push(`${unknown.join('、')} 不在隐藏列表里，已忽略。`)
        const left = [...session.hidden]
        lines.push(
          left.length === 0
            ? '工具清单已完整。'
            : `仍有 ${left.length} 个工具隐藏：${left.join('、')}。用 tool_search({ all: true }) 可全部恢复。`,
        )
        return { text: lines.join('\n') }
      }

      const hidden = [...session.hidden]
      const query = typeof args?.query === 'string' ? args.query.trim() : ''
      const matched =
        query === ''
          ? hidden
          : hidden.filter((name) =>
              `${name} ${session.descriptions.get(name) ?? ''}`.toLowerCase().includes(query.toLowerCase()),
            )
      if (matched.length === 0) {
        return { text: `隐藏工具里没有匹配「${query}」的。当前隐藏 ${hidden.length} 个：${hidden.join('、')}。` }
      }

      const lines = [
        query === ''
          ? `隐藏工具 ${matched.length} 个，估算省下约 ${session.savedTokens} token：`
          : `隐藏工具里匹配「${query}」的 ${matched.length} 个：`,
      ]
      for (const name of matched) {
        const description = clip(session.descriptions.get(name), LIST_DESCRIPTION_LIMIT)
        lines.push(`- ${name}：${description === '' ? '（没有说明）' : description}`)
      }
      lines.push(`用 tool_search({ enable: ["${matched.join('", "')}"] }) 取回，或 tool_search({ all: true }) 全部取回。`)
      return { text: lines.join('\n') }
    } catch (error) {
      this.#warn(`工具恢复失败：${errorText(error)}`)
      return { text: `工具恢复失败（${errorText(error)}），工具清单保持原样。` }
    }
  }

  /**
   * 给面板看的当前状态：最近一次评估的隐藏集、估算省下的 token、最近一条记录。
   * @returns {{ hidden: string[]; savedTokens: number; last: object | null }} 快照
   */
  snapshot() {
    const last = this.#last
    if (last === null) return { hidden: [], savedTokens: 0, last: null }
    return { hidden: [...last.hidden], savedTokens: last.savedTokens, last: { ...last, hidden: [...last.hidden] } }
  }

  /**
   * 面板上的「全部恢复」：撤销当前所有会话的掩码。
   * @returns {number} 恢复的工具数
   */
  restoreAll() {
    let restored = 0
    for (const session of this.#sessions.values()) {
      restored += session.hidden.size
      releaseDisposers(session.disposers)
      session.disposers = []
      session.hidden = new Set()
    }
    if (this.#last !== null) {
      this.#last = { ...this.#last, hidden: [], savedTokens: 0 }
    }
    return restored
  }

  /** 卸载：撤销所有掩码，清空状态。 */
  dispose() {
    this.restoreAll()
    this.#sessions.clear()
    this.#last = null
  }
}

/**
 * 造一个工具选择器。插件入口把它挂到 `agent/pre-step` 与 `tool_search` 上。
 * @param {object} options 见 {@link ToolSelector} 构造函数
 * @returns {ToolSelector} 选择器
 */
export function createToolSelector(options) {
  return new ToolSelector(options)
}