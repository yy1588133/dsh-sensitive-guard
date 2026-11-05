/**
 * dsh-decision-guard：命令执行前的决策模型守门。
 *
 * 解决的问题：`danger-full-access` 预设把沙箱和审批一起关掉（sandbox 不限制 +
 * approval 策略 `never`），于是任何一条 `rm -rf` 都会直接执行。这个插件在
 * `tools/pre-execute` 之前插一道闸：先用规则表识别「可能有害的命令」，再让一个
 * 非生成式决策模型判断这条具体命令在当前目录下到底能不能跑。
 *
 * 三种结果：
 * - 放行：`next()` 透传给下游，不吞掉别人的否决权；
 * - 拒绝：带理由返回给模型，AI 流程继续，可以换个做法；
 * - 转人工：返回 `ask`，由审批服务弹确认。
 *
 * 关键取舍：
 * - **只审命中规则的调用**。没命中就零成本直通，不给每次工具调用都加一次网络往返。
 * - **判不清就回退，不硬拍**。无 key、超时、解析失败、模型说「不清楚」——全部回到
 *   原生行为，绝不因为模型答不上来就放宽权限。
 * - **拒绝可以，放行不行**。本插件只会让流程更严，不会让任何一条本该被拒绝的调用
 *   溜过去：它永远不返回「强制 allow」，最多是 `next()`。
 *
 * @module dsh-decision-guard
 */

import { matchRules, CHECK_FAILED_RULE_ID } from './lib/rules.js'
import { DecisionClient } from './lib/jev.js'
import { createSkillSelector } from './lib/skill-select.js'
import { createFileRanker } from './lib/file-rank.js'
import { createToolSelector } from './lib/tool-select.js'
import { COMMAND_FIELD_NAMES, RulesStore, SettingsStore, dshHome } from './lib/store.js'

export const name = 'dsh-decision-guard'

/** 硬依赖只有工具注册表；webServer 是可选依赖，没有 Web 面板时守卫照常工作。 */
export const inject = ['tools']

/** 面板 HTTP 前缀。 */
const API_BASE = '/sensitive-guard/api'

/** 内存里保留的最近判定条数。 */
const LOG_CAPACITY = 50

/**
 * 这次调用是不是「能把一段文本交给 shell 执行」的工具。
 *
 * 清单非空时按名字精确匹配；清单留空表示检查全部命令类工具，此时靠参数名判断：
 * 只要参数里出现 command / script / text 这类字段就算。`write` 写的是 `content`、
 * `edit` 写的是 `new_string`，都不在字段表里，所以写文档不会被当成危险命令。
 * @param {string} toolName 工具名
 * @param {unknown} args 调用参数
 * @param {readonly string[]} allowlist 配置的工具清单
 * @returns {boolean} 是否应该检查
 */
function shouldInspect(toolName, args, allowlist) {
  if (allowlist.length > 0) return allowlist.includes(toolName)
  if (args === null || typeof args !== 'object') return false
  return COMMAND_FIELD_NAMES.some((field) => typeof (/** @type {any} */ (args)[field]) === 'string')
}

/**
 * 从一次工具调用里取出「会被执行的那段文本」。
 *
 * 只取真实会进 shell 的字段，不把任意字符串参数都拿来匹配——否则 `write` 一个
 * 内容里带 `rm -rf` 的文档也会被当成危险命令。
 * @param {string} toolName 工具名
 * @param {unknown} args 调用参数
 * @returns {string} 待检查文本
 */
function commandTextOf(toolName, args) {
  if (args === null || typeof args !== 'object') return ''
  const record = /** @type {Record<string, unknown>} */ (args)
  /** @param {string} key 字段名 */
  const text = (key) => (typeof record[key] === 'string' ? record[key] : '')

  // 已知形状：按工具取它自己的命令字段，避免混进无关文本。
  if (toolName === 'terminal_send') return text('text')
  if (
    toolName === 'ssh_workspace_shell' ||
    toolName === 'ssh_workspace_exec' ||
    toolName === 'bash' ||
    toolName === 'pwsh' ||
    toolName === 'shell' ||
    toolName === 'ops_bash'
  ) {
    // `command` 是命令本体；`script_path` 指向的脚本文件内容不在这里展开，
    // 只把路径本身纳入匹配，宁可多问一次也不静默跳过。
    return [text('command'), text('script_path'), text('workdir')].filter((part) => part !== '').join(' ')
  }

  // 其余工具（清单留空时才会走到）：只拼命令行字段，不碰正文类字段。
  /** @type {string[]} */
  const parts = []
  for (const field of COMMAND_FIELD_NAMES) {
    const value = record[field]
    if (typeof value === 'string' && value !== '') parts.push(value)
  }
  return parts.join(' ')
}

/** 会话片段裁剪上限，与 snow-app 的 sensitiveCommandContext.ts 一致。 */
const MAX_TEXT_CHARS = 2000
const MAX_ARGUMENT_CHARS = 600
const MAX_OUTPUT_CHARS = 1200
/** 单条助手消息最多带的工具调用数（保留最近的）。 */
const MAX_TOOL_CALLS_PER_MESSAGE = 8

/** 内联图片/二进制占位，避免把 base64 发给决策模型。 */
const INLINE_IMAGE_TAG_RE = /@@image:[^@]*@@/g
const DATA_URL_RE = /data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g

/**
 * 裁剪一段文本：先抹掉内联图片与 data URL，再按上限截断。
 * @param {string} value 原始文本
 * @param {number} max 上限
 * @returns {string} 处理后的文本
 */
function clip(value, max) {
  const cleaned = String(value ?? '')
    .replace(INLINE_IMAGE_TAG_RE, '[image]')
    .replace(DATA_URL_RE, '[binary data]')
    .trim()
  return cleaned.length > max ? `${cleaned.slice(0, max)}...[truncated]` : cleaned
}

/**
 * 取最近若干条会话消息，裁剪成可安全外发的片段。
 *
 * 只保留用户与助手的正文，以及「已结束」工具调用的名字 / 参数摘要 / 输出摘要。
 * 正在执行的那一次调用本身不进片段——它就是待判定的命令，已经在 state.command 里。
 * @param {any} agent 活着的 agent
 * @param {number} limit 最多取几条
 * @returns {Array<{ role: string; text: string; toolCalls: Array<{ name: string; arguments: string; output?: string }> }>} 时间正序
 */
function recentConversation(agent, limit) {
  if (limit <= 0) return []
  const session = agent?.session
  if (session === undefined) return []
  let events
  try {
    events = session.snapshotEvents()
  } catch {
    return []
  }
  if (!Array.isArray(events)) return []

  /**
   * 事件日志里 user/assistant 消息的 data 形状不同：用户消息直接挂 content，
   * 助手消息包在 message 里；工具调用和工具结果又是独立事件，得用 callId 配对。
   * 这里按时间顺序重建成「消息 + 挂在其上的已结束工具调用」。
   * @type {Array<{ role: string; text: string; toolCalls: Array<{ name: string; arguments: string; output?: string }> }>}
   */
  const messages = []
  /** @type {Map<string, { name: string; arguments: string }>} */
  const pendingCalls = new Map()
  /** 当前正在累积工具调用的那条助手消息。 */
  let currentAssistant

  for (const event of events) {
    const type = event?.type
    const data = event?.data
    if (type === 'user/message') {
      const blocks = Array.isArray(data?.content) ? data.content : []
      const text = clip(
        blocks
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n'),
        MAX_TEXT_CHARS,
      )
      if (text !== '') messages.push({ role: 'user', text, toolCalls: [] })
      currentAssistant = undefined
      continue
    }
    if (type === 'assistant/message') {
      const blocks = Array.isArray(data?.message?.content) ? data.message.content : []
      const text = clip(
        blocks
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n'),
        MAX_TEXT_CHARS,
      )
      /** @type {{ role: string; text: string; toolCalls: Array<{ name: string; arguments: string; output?: string }> }} */
      const entry = { role: 'assistant', text, toolCalls: [] }
      messages.push(entry)
      currentAssistant = entry
      continue
    }
    if (type === 'tool/call') {
      if (typeof data?.callId === 'string' && typeof data?.name === 'string') {
        pendingCalls.set(data.callId, {
          name: data.name,
          arguments: clip(data.arguments, MAX_ARGUMENT_CHARS),
        })
      }
      continue
    }
    if (type === 'tool/result') {
      const callId = data?.toolCallId ?? data?.message?.toolCallId
      const call = typeof callId === 'string' ? pendingCalls.get(callId) : undefined
      if (call === undefined || typeof callId !== 'string') continue
      pendingCalls.delete(callId)
      const blocks = Array.isArray(data?.message?.content) ? data.message.content : []
      const output = clip(
        blocks
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n'),
        MAX_OUTPUT_CHARS,
      )
      if (currentAssistant === undefined) {
        currentAssistant = { role: 'assistant', text: '', toolCalls: [] }
        messages.push(currentAssistant)
      }
      currentAssistant.toolCalls.push({ ...call, ...(output === '' ? {} : { output }) })
    }
  }

  // 单条助手消息最多留最近 8 个工具调用，再整体只取最近 limit 条消息。
  for (const message of messages) {
    if (message.toolCalls.length > MAX_TOOL_CALLS_PER_MESSAGE) {
      message.toolCalls = message.toolCalls.slice(-MAX_TOOL_CALLS_PER_MESSAGE)
    }
  }
  return messages.filter((message) => message.text !== '' || message.toolCalls.length > 0).slice(-limit)
}

/** 把判定结果翻成人话，写进审批卡的显示理由。 */
function describeDecision(decision) {
  const severity = decision.severity === undefined ? '' : `，风险 ${decision.severity}`
  const reason = decision.reason
  const percent = Math.round((decision.confidence ?? 0) * 100)
  return `决策模型${decision.allow ? '判定可以直接执行' : '判定需要确认'}（${reason}${severity}，置信 ${percent}%）`
}

/**
 * 装插件。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 */
export function apply(ctx) {
  const settingsStore = new SettingsStore()
  const rulesStore = new RulesStore()
  const logger = {
    warn: (message) => {
      try {
        ctx.logger?.warn?.(message)
      } catch {
        /* 日志失败不影响判定 */
      }
    },
  }
  const client = new DecisionClient({ getSettings: () => settingsStore.get(), logger })

  /**
   * 三个新功能共用同一个连接与冷却：判断失败只影响那一次功能，不影响命令守门。
   * 各模块内部都把「失败」翻译成「退回原生行为」，不向外抛。
   */
  const skillSelector = createSkillSelector({
    ctx,
    client,
    getSettings: () => settingsStore.get(),
    logger,
  })
  // 排序模块自己在 tools/execute 与 tools/post-execute 上挂链，这里只创建一次。
  createFileRanker({ ctx, client, getSettings: () => settingsStore.get(), logger })

  /** @type {Array<object>} */
  const log = []
  /** @param {object} entry 一条判定记录 */
  const record = (entry) => {
    log.unshift({ at: new Date().toISOString(), ...entry })
    if (log.length > LOG_CAPACITY) log.length = LOG_CAPACITY
  }
  const toolSelector = createToolSelector({
    ctx,
    client,
    getSettings: () => settingsStore.get(),
    logger,
    record,
  })

  /**
   * 解析这次调用的有效审批策略：`never` 意味着弹不出确认框，只能允许或拒绝。
   *
   * 会话自己的 `approval/policy` 优先；没有覆盖时读服务上的部署默认值。两者都读不到
   * 才按 `never` 处理——「以为能弹窗但其实弹不出来」会导致确认请求被静默拒绝，
   * 宁可显式按拒绝处理，也不假装问过用户。
   * @param {any} agent agent
   * @returns {'ask' | 'never'} 有效策略
   */
  const approvalPolicyOf = (agent) => {
    try {
      const approval = ctx.get('approval')
      if (approval === undefined) return 'never'
      const session = agent?.session
      if (session === undefined) return 'never'
      const override = typeof approval.overrideOf === 'function' ? approval.overrideOf(session) : undefined
      if (override === 'ask' || override === 'never') return override
      const configured = approval.config?.policy
      return configured === 'ask' ? 'ask' : 'never'
    } catch {
      return 'never'
    }
  }

  /**
   * 读这个会话当前的沙箱模式。
   *
   * 这是「决策模型不可用」时的兜底依据：只读与工作区模式自带边界，放行也不会
   * 真的把磁盘毁掉；完全权限模式没有任何边界，那就必须拒绝。
   * @param {any} agent agent
   * @returns {'read-only' | 'workspace-write' | 'danger-full-access'} 模式
   */
  const sandboxModeOf = (agent) => {
    try {
      const session = agent?.session
      if (session === undefined) return 'danger-full-access'
      // 沙箱模式是会话日志里的一条事件，往前翻最近一条即可。
      const events = session.snapshotEvents()
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event?.type !== 'sandbox/mode') continue
        const mode = event.data?.mode
        if (mode === 'read-only' || mode === 'workspace-write' || mode === 'danger-full-access') return mode
      }
      // 没有记录说明是部署默认值：读权限预设服务的当前选择。
      const presets = ctx.get('permissionPresets')
      const name = presets?.current?.(session)
      if (name === 'read-only') return 'read-only'
      if (name === 'workspace-write') return 'workspace-write'
      return 'danger-full-access'
    } catch {
      return 'danger-full-access'
    }
  }

  // ── 工具与技能：每个会话首条用户消息评估一次 ───────────────────────────────
  ctx.effect(() => {
    const off = ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
      let decision = await next()
      // 顺序固定：先裁技能目录，再摘工具；两边失败都各自退回原样。
      decision = await skillSelector.onPreStep(decision, agent, messages, signal)
      decision = await toolSelector.onPreStep(decision, agent, messages, signal)
      return decision
    })
    return off
  }, 'dsh-decision-guard: agent/pre-step')

  // ── 两个常驻工具：tool_search 召回工具，skill_catalog 列出全部技能 ───────────
  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'tool_search',
        description:
          'List tools that were hidden for this session and bring them back. Call with no arguments to see what is hidden; pass enable:[names] to restore specific tools, or all:true to restore every hidden tool.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Filter hidden tools by name or description.' },
            enable: { type: 'array', items: { type: 'string' }, description: 'Exact tool names to restore.' },
            all: { type: 'boolean', description: 'Restore every hidden tool.' },
          },
        },
        output: {
          schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          render: (_args, value) => [{ type: 'text', text: String(value.text) }],
        },
        async execute(args, exec) {
          const result = await toolSelector.search(exec.agent, args ?? {}, exec.signal)
          return { text: result.text }
        },
      }),
    'dsh-decision-guard: tool_search',
  )

  ctx.effect(
    () =>
      ctx.tools.register({
        name: 'skill_catalog',
        description:
          'List skills. By default lists only the skills held back from this session catalog; pass scope:"all" to list every loadable skill. Load one with the skill tool using its exact name.',
        parameters: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['deferred', 'all'],
              description: 'deferred (default) lists the on-demand pool; all lists every loadable skill.',
            },
          },
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              skills: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { name: { type: 'string' }, description: { type: 'string' } },
                  required: ['name', 'description'],
                },
              },
              note: { type: 'string' },
            },
            required: ['skills'],
          },
          render: (_args, value) => [
            {
              type: 'text',
              text:
                [value.note, value.skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n')]
                  .filter((part) => part !== '')
                  .join('\n\n') || '当前没有可加载的技能。',
            },
          ],
        },
        async execute(args, exec) {
          const scope = args?.scope === 'all' ? 'all' : 'deferred'
          return skillSelector.catalog(exec.agent, scope, exec.signal)
        },
      }),
    'dsh-decision-guard: skill_catalog',
  )

  ctx.effect(() => () => toolSelector.dispose(), 'dsh-decision-guard: dispose selectors')

  ctx.effect(() => {
    const off = ctx.on('tools/pre-execute', async (exec, next) => {
      const settings = settingsStore.get()
      if (!settings.enabled) return next()
      const agent = exec.agent
      if (agent === undefined) return next()
      if (!shouldInspect(exec.name, exec.arguments, settings.commandTools)) return next()

      const text = commandTextOf(exec.name, exec.arguments)
      if (text.trim() === '') return next()

      const { matches, failed } = matchRules(text, rulesStore.enabled())
      if (failed !== undefined && matches.length === 0) {
        // 规则本身坏了：不能静默放行，按「检查失败」处理，交给人工。
        record({ tool: exec.name, verdict: 'check-failed', detail: failed })
        return {
          kind: 'deny',
          reason: `dsh-decision-guard: 敏感命令规则无法编译（${failed}），已拒绝执行。请到设置里修正规则。`,
        }
      }
      if (matches.length === 0) return next()

      const workingDirectory = (() => {
        try {
          // `ctx.workingDirectory.get(session)` 直接返回字符串；服务不在时留空，
          // 决策模型仍能依据命令本身判断，不会被一个缺失字段卡住。
          const directory = ctx.get('workingDirectory')?.get?.(agent.session)
          return typeof directory === 'string' ? directory : ''
        } catch {
          return ''
        }
      })()
      const claim = typeof exec.arguments === 'object' && exec.arguments !== null
        ? /** @type {Record<string, unknown>} */ (exec.arguments)['description']
        : undefined
      const conversation = settings.useConversationContext
        ? recentConversation(agent, settings.contextMessageCount)
        : undefined

      const decision = await client.evaluateCommand(
        {
          command: text,
          description: typeof claim === 'string' ? claim : '',
          workingDirectory,
          matchedRules: matches,
          conversation,
        },
        exec.signal,
      )

      const ruleLabel = matches.map((rule) => rule.commandId).join(', ')
      if ('unavailable' in decision) {
        record({ tool: exec.name, verdict: 'unavailable', detail: decision.unavailable, rules: ruleLabel })
        // 判定不可用：按配置回退。
        // - allow：直接放行，最宽松，只在你自己确认过「宁可放过」时选。
        // - follow-sandbox（默认）：交给当前权限模式决定。只读 / 工作区模式自带边界，
        //   就算命令很凶也伤不到工作区外；完全权限模式没有任何边界，必须拒绝。
        // - deny：一律拒绝。
        if (settings.onUnavailable === 'allow') return next()
        if (settings.onUnavailable === 'follow-sandbox') {
          const mode = sandboxModeOf(agent)
          if (mode === 'read-only' || mode === 'workspace-write') {
            record({ tool: exec.name, verdict: 'delegate-sandbox', detail: mode, rules: ruleLabel })
            return next()
          }
          return {
            kind: 'deny',
            reason: `dsh-decision-guard: 命中敏感命令规则（${ruleLabel}），决策模型不可用（${decision.unavailable}），当前又是完全权限模式（没有任何沙箱边界），已拒绝执行。可在设置里改用「直接放行」，或先修好 API Key / 代理。`,
          }
        }
        return {
          kind: 'deny',
          reason: `dsh-decision-guard: 命中敏感命令规则（${ruleLabel}），但决策模型不可用（${decision.unavailable}），已拒绝执行。请在设置里检查 API Key、代理与网络。`,
        }
      }

      record({
        tool: exec.name,
        verdict: decision.allow ? 'allow' : 'deny',
        rules: ruleLabel,
        reason: decision.reason,
        confidence: decision.confidence,
        severity: decision.severity,
        delegate: settings.delegate,
        cached: decision.cached,
        command: text.slice(0, 200),
      })

      const canAsk = approvalPolicyOf(agent) === 'ask'
      if (decision.allow) {
        // 允许这一侧才是「托管」真正控制的东西：
        // 托管 → 直接执行；未托管且能弹窗 → 把判定当建议展示，仍让人看；
        // 未托管又弹不出窗（完全权限）→ 没有可展示的地方，只能放行。
        if (settings.delegate || !canAsk) return next()
        return {
          kind: 'ask',
          reason: `Sensitive command matched (${ruleLabel}); the decision model suggests it is safe.`,
          displayReason: {
            en: `Matched a sensitive command rule (${ruleLabel}). ${describeDecision(decision)}`,
            zh: `命中敏感命令规则（${ruleLabel}）。${describeDecision(decision)}`,
          },
        }
      }

      // 拒绝这一侧不交给「托管」开关决定：判定说这条命令有风险，就没有正当理由
      // 让它溜过去。能弹窗时按「拒绝时仍让我确认」/ 未托管 转人工，其余一律拒绝。
      if (canAsk && (settings.askOnDeny || !settings.delegate)) {
        return {
          kind: 'ask',
          reason: `Sensitive command matched (${ruleLabel}); the decision model suggests confirming.`,
          displayReason: {
            en: `Matched a sensitive command rule (${ruleLabel}). ${describeDecision(decision)}`,
            zh: `命中敏感命令规则（${ruleLabel}）。${describeDecision(decision)}`,
          },
        }
      }
      return {
        kind: 'deny',
        reason: `dsh-decision-guard: 决策模型判定这条命令有风险，已拒绝执行（命中规则 ${ruleLabel}，理由 ${decision.reason}${
          decision.severity === undefined ? '' : `，风险 ${decision.severity}`
        }，置信 ${Math.round((decision.confidence ?? 0) * 100)}%）。如果确实要执行，请由用户手动操作，或调整敏感命令规则。`,
      }
    })
    return () => {
      off()
    }
  }, 'dsh-decision-guard: tools/pre-execute')

  // ── 面板 HTTP 路由 ───────────────────────────────────────────────────────
  /**
   * 用 `ctx.inject` 而不是一次性的 `ctx.get`：启动时各插件 fiber 并行初始化，
   * `webServer` 可能比本插件晚就绪，取早了路由就永远补不上（面板读到 HTTP 404）。
   * webServer 仍是可选依赖——headless 部署没有它时只丢面板，守卫本身照常生效。
   */
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.get('webServer')
    if (server === undefined || typeof server.register !== 'function') return

    /** @type {Array<() => void>} */
    const disposers = []
    /**
     * 只服务本机页面：Host 头必须是回环地址，且不接受跨站 Origin。
     * @param {import('node:http').IncomingMessage} req 请求
     * @returns {boolean} 是否放行
     */
    const allowed = (req) => {
      const host = typeof req.headers.host === 'string' ? req.headers.host.trim().toLowerCase() : ''
      if (host !== '' && !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : ''
      if (origin === '') return true
      try {
        return new URL(origin).host.toLowerCase() === host
      } catch {
        return false
      }
    }
    /**
     * @param {import('node:http').ServerResponse} res 响应
     * @param {number} status 状态码
     * @param {unknown} payload 负载
     */
    const sendJson = (res, status, payload) => {
      if (res.writableEnded === true || res.destroyed === true) return
      const body = JSON.stringify(payload)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
      })
      res.end(body)
    }
    /**
     * @param {import('node:http').IncomingMessage} req 请求
     * @returns {Promise< Record<string, unknown> | undefined>} 解析后的 JSON
     */
    const readJson = (req) =>
      new Promise((resolve) => {
        /** @type {Buffer[]} */
        const chunks = []
        let size = 0
        let done = false
        const finish = (value) => {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve(value)
        }
        const timer = setTimeout(() => finish(undefined), 10_000)
        timer.unref?.()
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > 1_000_000) {
            finish(undefined)
            req.destroy?.()
            return
          }
          chunks.push(chunk)
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            finish(parsed !== null && typeof parsed === 'object' ? parsed : undefined)
          } catch {
            finish(undefined)
          }
        })
        req.on('error', () => finish(undefined))
      })

    /** 面板看到的设置：key 只回后四位，避免整份密钥在页面里裸奔。 */
    const publicSettings = () => {
      const settings = settingsStore.get()
      const key = settings.apiKey
      return {
        ...settings,
        apiKey: key === '' ? '' : `••••${key.slice(-4)}`,
        apiKeySet: key !== '',
        proxyInfo: client.proxyInfo(),
        dataDir: dshHome(),
      }
    }

    /** @param {string} suffix 后缀 */
    const route = (suffix) => `${API_BASE}/${suffix}`
    /** @type {Array<[string, (req: any, res: any) => Promise<void> | void]>} */
    const handlers = [
      [
        route('select'),
        async (req, res) => {
          if (!allowed(req)) return sendJson(res, 403, { status: 'forbidden' })
          const method = String(req.method ?? 'GET').toUpperCase()
          /** @returns {object} 面板要的三块数据 */
          const payload = () => {
            const settings = settingsStore.get()
            return {
              tools: {
                enabled: settings.toolsEnabled,
                whitelist: settings.toolWhitelist,
                minProbability: settings.toolMinProbability,
              },
              selection: {
                skillsEnabled: settings.skillsEnabled,
                skillLimit: settings.skillLimit,
                skillMinProbability: settings.skillMinProbability,
                filesEnabled: settings.filesEnabled,
                fileCandidates: settings.fileCandidates,
              },
              stats: toolSelector.snapshot(),
            }
          }
          if (method === 'GET' || method === 'HEAD') return sendJson(res, 200, { status: 'ok', ...payload() })
          if (method !== 'POST') return sendJson(res, 405, { status: 'method' })
          const body = await readJson(req)
          if (body === undefined) return sendJson(res, 400, { status: 'bad-json' })
          if (body['action'] === 'restore-all') {
            return sendJson(res, 200, {
              status: 'ok',
              restored: toolSelector.restoreAll(),
              ...payload(),
            })
          }
          /** @type {Record<string, unknown>} */
          const patch = {}
          const tools = body['tools']
          if (tools !== null && typeof tools === 'object') {
            if (typeof tools['enabled'] === 'boolean') patch['toolsEnabled'] = tools['enabled']
            if (typeof tools['minProbability'] === 'number') patch['toolMinProbability'] = tools['minProbability']
            const whitelist = tools['whitelist']
            if (Array.isArray(whitelist)) {
              patch['toolWhitelist'] = whitelist.filter((name) => typeof name === 'string')
            } else if (typeof whitelist === 'string') {
              patch['toolWhitelist'] = whitelist.split(/[,，\s]+/).filter((name) => name !== '')
            }
          }
          const selection = body['selection']
          if (selection !== null && typeof selection === 'object') {
            for (const key of ['skillsEnabled', 'filesEnabled']) {
              if (typeof selection[key] === 'boolean') patch[key] = selection[key]
            }
            for (const key of ['skillLimit', 'skillMinProbability', 'fileCandidates']) {
              if (typeof selection[key] === 'number') patch[key] = selection[key]
            }
          }
          try {
            settingsStore.update(patch)
            return sendJson(res, 200, { status: 'ok', ...payload() })
          } catch (error) {
            return sendJson(res, 500, {
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
            })
          }
        },
      ],
      [
        route('config'),
        async (req, res) => {
          if (!allowed(req)) return sendJson(res, 403, { status: 'forbidden' })
          const method = String(req.method ?? 'GET').toUpperCase()
          if (method === 'GET' || method === 'HEAD') return sendJson(res, 200, { status: 'ok', config: publicSettings() })
          if (method !== 'POST') return sendJson(res, 405, { status: 'method' })
          const body = await readJson(req)
          if (body === undefined) return sendJson(res, 400, { status: 'bad-json' })
          const patch = { ...body }
          const incomingKey = patch['apiKey']
          if (typeof incomingKey !== 'string' || incomingKey.startsWith('••••')) delete patch['apiKey']
          if (Array.isArray(patch['commandTools'])) {
            patch['commandTools'] = patch['commandTools'].filter((item) => typeof item === 'string')
          }
          try {
            settingsStore.update(patch)
            return sendJson(res, 200, { status: 'ok', config: publicSettings() })
          } catch (error) {
            return sendJson(res, 500, {
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
            })
          }
        },
      ],
      [
        route('rules'),
        async (req, res) => {
          if (!allowed(req)) return sendJson(res, 403, { status: 'forbidden' })
          const method = String(req.method ?? 'GET').toUpperCase()
          if (method === 'GET' || method === 'HEAD') return sendJson(res, 200, { status: 'ok', rules: rulesStore.list() })
          if (method !== 'POST') return sendJson(res, 405, { status: 'method' })
          const body = await readJson(req)
          if (body === undefined) return sendJson(res, 400, { status: 'bad-json' })
          const action = body['action']
          if (action === 'upsert') {
            const result = rulesStore.upsert({
              commandId: String(body['commandId'] ?? ''),
              pattern: String(body['pattern'] ?? ''),
              description: typeof body['description'] === 'string' ? body['description'] : '',
              ...(typeof body['enabled'] === 'boolean' ? { enabled: body['enabled'] } : {}),
            })
            return sendJson(res, result.ok ? 200 : 400, { status: result.ok ? 'ok' : 'error', ...result, rules: rulesStore.list() })
          }
          if (action === 'toggle') {
            const ok = rulesStore.setEnabled(String(body['commandId'] ?? ''), body['enabled'] === true)
            return sendJson(res, ok ? 200 : 404, { status: ok ? 'ok' : 'not-found', rules: rulesStore.list() })
          }
          if (action === 'delete') {
            const result = rulesStore.remove(String(body['commandId'] ?? ''))
            return sendJson(res, result.ok ? 200 : 400, { status: result.ok ? 'ok' : 'error', ...result, rules: rulesStore.list() })
          }
          if (action === 'reset') {
            rulesStore.reset()
            return sendJson(res, 200, { status: 'ok', rules: rulesStore.list() })
          }
          return sendJson(res, 400, { status: 'unknown-action' })
        },
      ],
      [
        route('test'),
        async (req, res) => {
          if (!allowed(req)) return sendJson(res, 403, { status: 'forbidden' })
          if (String(req.method ?? '').toUpperCase() !== 'POST') return sendJson(res, 405, { status: 'method' })
          const body = await readJson(req)
          const override = body !== undefined && typeof body['apiKey'] === 'string' ? body['apiKey'] : undefined
          const result = await client.ping({
            ...(override === undefined || override.startsWith('••••') ? {} : { apiKeyOverride: override }),
          })
          return sendJson(res, 200, { status: 'ok', result, proxyInfo: client.proxyInfo() })
        },
      ],
      [
        route('log'),
        async (req, res) => {
          if (!allowed(req)) return sendJson(res, 403, { status: 'forbidden' })
          const method = String(req.method ?? 'GET').toUpperCase()
          if (method === 'GET' || method === 'HEAD') return sendJson(res, 200, { status: 'ok', entries: log })
          if (method !== 'DELETE' && method !== 'POST') return sendJson(res, 405, { status: 'method' })
          // 清空只影响内存里的观测记录，不动规则、设置和会话日志。
          log.length = 0
          return sendJson(res, 200, { status: 'ok', entries: log })
        },
      ],
    ]
    for (const [path, handler] of handlers) {
      disposers.push(server.register({ kind: 'exact', path, handler }))
    }
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* 路由已经没了 */
        }
      }
    }
  })
}

export { CHECK_FAILED_RULE_ID }
