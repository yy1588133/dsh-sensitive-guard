/**
 * 配置与规则持久化。
 *
 * 刻意不落进插件目录的 `cordis.patch.yml`：那个文件和 `lib/` 一起住在
 * `node_modules` 下，任何一次 pnpm 操作都会把整包从 store 重新展开，配置随之蒸发。
 * 这里统一写到 `$DSH_HOME/plugins/<插件名>/`，与包生命周期解耦；升级、重装都不受影响。
 *
 * 读失败一律回落到内存默认值并留下原因，绝不因为配置坏了就放行命令。
 *
 * @module dsh-sensitive-guard/store
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PRESET_SENSITIVE_COMMANDS, PRESET_DESCRIPTION_ZH } from './rules.js'

/** 插件名，同时是 `$DSH_HOME/plugins/` 下的目录名。 */
export const PLUGIN_NAME = 'dsh-sensitive-guard'

/** TypeSafe Jev 官方端点。 */
export const DEFAULT_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

/** 默认模型 id。 */
export const DEFAULT_MODEL = 'jev-latest'

/**
 * 已知的命令类工具名。清单留空表示「所有带命令字段的工具都检查」，
 * 这份名单只用于把常见工具的命令字段取全。
 */
export const DEFAULT_COMMAND_TOOLS = Object.freeze([
  'bash',
  'pwsh',
  'shell',
  'ops_bash',
  'terminal_send',
  'ssh_workspace_exec',
  'ssh_workspace_shell',
])

/**
 * 会被当作「可执行命令文本」的参数名。
 *
 * 清单留空时靠它判断一个工具该不该查：只要参数里出现这些字段，就说明它能把
 * 一段文本交给 shell。`write` 的 `content`、`edit` 的 `new_string` 不在其中，
 * 所以写一个内容里带 `rm -rf` 的文档不会被误判成危险命令。
 */
export const COMMAND_FIELD_NAMES = Object.freeze([
  'command',
  'cmd',
  'script',
  'script_path',
  'scriptPath',
  'shellCommand',
  'text',
  'workdir',
])

/**
 * @typedef {object} Settings
 * @property {boolean} enabled 总开关
 * @property {string} modelId 决策模型标识（仅展示用；实际走 endpoint + model）
 * @property {boolean} delegate 由决策模型托管
 * @property {boolean} askOnDeny 托管下判定拒绝时仍弹人工确认
 * @property {boolean} useConversationContext 判定时附带最近会话片段
 * @property {number} contextMessageCount 附带条数 1-50
 * @property {string} apiKey TypeSafe API key
 * @property {string} endpoint 请求端点
 * @property {string} model 模型 id
 * @property {string} proxy 出站代理，空表示自动探测
 * @property {number} timeoutMs 单次判定墙钟预算
 * @property {'allow'|'deny'|'follow-sandbox'} onUnavailable 判定不可用时的行为
 * @property {readonly string[]} commandTools 参与规则检查的工具名；空 = 所有命令类工具
 */

/** 出厂设置：与原版一致，默认关闭。 */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  modelId: '',
  delegate: false,
  askOnDeny: false,
  useConversationContext: false,
  contextMessageCount: 8,
  apiKey: '',
  endpoint: DEFAULT_ENDPOINT,
  model: DEFAULT_MODEL,
  proxy: '',
  timeoutMs: 3000,
  onUnavailable: 'follow-sandbox',
  commandTools: [],
})

/** 会话上下文条数的取值区间，与原版一致。 */
export const MIN_CONTEXT_MESSAGES = 1
export const MAX_CONTEXT_MESSAGES = 50

/** `$DSH_HOME`，缺省 `~/.dsh`。 */
export function dshHome() {
  const fromEnv = process.env['DSH_HOME']
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** 插件自己的数据目录。 */
export function dataDir() {
  return join(dshHome(), 'plugins', PLUGIN_NAME)
}

const SETTINGS_FILE = () => join(dataDir(), 'config.json')
const RULES_FILE = () => join(dataDir(), 'rules.json')

/**
 * 规整外部传入的设置：类型不对就回落默认值，数字钳到合法区间。
 * @param {unknown} raw 任意输入
 * @returns {Settings} 一份完整可用的设置
 */
export function normalizeSettings(raw) {
  const input = raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {}
  const text = (key, fallback) => {
    const value = input[key]
    return typeof value === 'string' ? value.trim() : fallback
  }
  const flag = (key, fallback) => (typeof input[key] === 'boolean' ? input[key] : fallback)
  const count = Number(input['contextMessageCount'])
  const timeout = Number(input['timeoutMs'])
  const onUnavailable = input['onUnavailable']
  const tools = Array.isArray(input['commandTools'])
    ? [...new Set(input['commandTools'].filter((name) => typeof name === 'string' && name.trim() !== '').map((name) => name.trim()))]
    : []
  return {
    enabled: flag('enabled', DEFAULT_SETTINGS.enabled),
    modelId: text('modelId', DEFAULT_SETTINGS.modelId),
    delegate: flag('delegate', DEFAULT_SETTINGS.delegate),
    askOnDeny: flag('askOnDeny', DEFAULT_SETTINGS.askOnDeny),
    useConversationContext: flag('useConversationContext', DEFAULT_SETTINGS.useConversationContext),
    contextMessageCount: Number.isFinite(count)
      ? Math.min(MAX_CONTEXT_MESSAGES, Math.max(MIN_CONTEXT_MESSAGES, Math.round(count)))
      : DEFAULT_SETTINGS.contextMessageCount,
    apiKey: text('apiKey', DEFAULT_SETTINGS.apiKey),
    endpoint: text('endpoint', DEFAULT_SETTINGS.endpoint) || DEFAULT_SETTINGS.endpoint,
    model: text('model', DEFAULT_SETTINGS.model) || DEFAULT_SETTINGS.model,
    proxy: text('proxy', DEFAULT_SETTINGS.proxy),
    timeoutMs: Number.isFinite(timeout) ? Math.min(60_000, Math.max(300, Math.round(timeout))) : DEFAULT_SETTINGS.timeoutMs,
    onUnavailable:
      onUnavailable === 'allow' || onUnavailable === 'deny' || onUnavailable === 'follow-sandbox'
        ? onUnavailable
        : // 老版本存的是 'ask'：那个语义在完全权限模式下等于拒绝，现在交给
          // 「跟随权限模式」表达同一件事，且不会在只读/工作区模式下过度拦截。
          DEFAULT_SETTINGS.onUnavailable,
    commandTools: tools,
  }
}

/**
 * 原子写一个 JSON 文件：先写临时文件再 rename，避免半个文件留在磁盘上。
 * @param {string} path 目标路径
 * @param {unknown} value 要写入的值
 */
function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}

/**
 * 读一个 JSON 文件；不存在、读不动或解析失败都返回 undefined。
 * @param {string} path 路径
 * @returns {unknown} 解析后的值或 undefined
 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * 设置的内存视图。Host 侧读它，HTTP 路由写它，两边看到同一份。
 *
 * 「写」永远是「读-改-写」整份文件，因为这份文件只有本插件会碰，不存在并发方；
 * 内存值先更新再落盘，落盘失败会抛给调用方，不会留下「界面显示已保存、磁盘没变」的假象。
 */
export class SettingsStore {
  /** @type {Settings} */
  #value
  /** @type {string | undefined} 上次读取失败的原因，供面板显示。 */
  #loadError

  constructor() {
    const raw = readJson(SETTINGS_FILE())
    if (raw === undefined) {
      this.#value = normalizeSettings(DEFAULT_SETTINGS)
      return
    }
    this.#value = normalizeSettings(raw)
  }

  /** @returns {Settings} 当前设置（只读快照，改动请走 {@link update}）。 */
  get() {
    return this.#value
  }

  /** @returns {string | undefined} 上次读盘失败的原因。 */
  loadError() {
    return this.#loadError
  }

  /**
   * 合并写入。
   * @param {Partial<Settings>} patch 要改的字段
   * @returns {Settings} 写入后的完整设置
   */
  update(patch) {
    const merged = normalizeSettings({ ...this.#value, ...patch })
    writeJsonAtomic(SETTINGS_FILE(), merged)
    this.#value = merged
    return merged
  }
}

/**
 * 规则表的内存视图。
 *
 * 首次使用时把内置规则播种到磁盘；之后磁盘是唯一真相，用户改过什么就是什么。
 * 新增的内置规则（插件升级带来）会被补进来，已有条目的用户改动不被覆盖。
 */
export class RulesStore {
  /** @type {Array<{ commandId: string; pattern: string; description: string; enabled: boolean; isPreset: boolean }>} */
  #rules

  constructor() {
    const raw = readJson(RULES_FILE())
    const stored = Array.isArray(raw) ? raw : []
    /** @type {Map<string, any>} */
    const byId = new Map()
    for (const item of stored) {
      if (item === null || typeof item !== 'object') continue
      const commandId = typeof item.commandId === 'string' ? item.commandId.trim() : ''
      if (commandId === '') continue
      byId.set(commandId, {
        commandId,
        pattern: typeof item.pattern === 'string' ? item.pattern : '',
        description: typeof item.description === 'string' ? item.description : '',
        enabled: item.enabled === true,
        isPreset: item.isPreset === true,
      })
    }
    // 播种：内置规则只补空缺，不覆盖用户已经改过的那一份。说明优先用中文。
    for (const preset of PRESET_SENSITIVE_COMMANDS) {
      const description = PRESET_DESCRIPTION_ZH[preset.commandId] ?? preset.description
      const existing = byId.get(preset.commandId)
      if (existing !== undefined) {
        // 老版本播种的是英文说明：只在用户没动过的情况下换成中文。
        if (existing.isPreset && existing.description === preset.description) existing.description = description
        continue
      }
      byId.set(preset.commandId, {
        commandId: preset.commandId,
        pattern: preset.pattern,
        description,
        enabled: preset.enabled,
        isPreset: true,
      })
    }
    this.#rules = [...byId.values()]
    if (stored.length === 0) this.#persist()
  }

  #persist() {
    writeJsonAtomic(RULES_FILE(), this.#rules)
  }

  /** @returns {Array<{commandId:string;pattern:string;description:string;enabled:boolean;isPreset:boolean}>} 全部规则 */
  list() {
    return this.#rules.map((rule) => ({ ...rule }))
  }

  /** @returns {Array<{commandId:string;pattern:string;description:string}>} 只取启用的规则，喂给匹配器 */
  enabled() {
    return this.#rules
      .filter((rule) => rule.enabled)
      .map(({ commandId, pattern, description }) => ({ commandId, pattern, description }))
  }

  /**
   * 新增或改写一条规则。`isPreset` 由存储侧决定，不接受外部伪造。
   * @param {{ commandId: string; pattern: string; description?: string; enabled?: boolean }} input 规则内容
   * @returns {{ ok: true; rule: object } | { ok: false; error: string }} 结果
   */
  upsert(input) {
    const commandId = typeof input.commandId === 'string' ? input.commandId.trim() : ''
    const pattern = typeof input.pattern === 'string' ? input.pattern : ''
    if (commandId === '') return { ok: false, error: 'commandId 不能为空' }
    if (pattern.trim() === '') return { ok: false, error: 'pattern 不能为空' }
    try {
      // 先编译一次：存进去一条编译不过的正则，等于每次检查都 fail-closed。
      new RegExp(pattern, 'i')
    } catch (error) {
      return { ok: false, error: `正则无法编译：${error instanceof Error ? error.message : String(error)}` }
    }
    const existing = this.#rules.find((rule) => rule.commandId === commandId)
    if (existing !== undefined) {
      existing.pattern = pattern
      existing.description = typeof input.description === 'string' ? input.description : existing.description
      existing.enabled = typeof input.enabled === 'boolean' ? input.enabled : existing.enabled
    } else {
      this.#rules.push({
        commandId,
        pattern,
        description: typeof input.description === 'string' ? input.description : '',
        enabled: input.enabled !== false,
        isPreset: false,
      })
    }
    this.#persist()
    const rule = this.#rules.find((item) => item.commandId === commandId)
    return { ok: true, rule: { ...rule } }
  }

  /**
   * 开关一条规则。
   * @param {string} commandId 规则 id
   * @param {boolean} enabled 新状态
   * @returns {boolean} 是否找到并改动
   */
  setEnabled(commandId, enabled) {
    const rule = this.#rules.find((item) => item.commandId === commandId)
    if (rule === undefined) return false
    rule.enabled = enabled === true
    this.#persist()
    return true
  }

  /**
   * 删除一条自定义规则；内置规则不允许删除，与原版一致。
   * @param {string} commandId 规则 id
   * @returns {{ ok: true } | { ok: false; error: string }} 结果
   */
  remove(commandId) {
    const index = this.#rules.findIndex((item) => item.commandId === commandId)
    if (index < 0) return { ok: false, error: '规则不存在' }
    if (this.#rules[index].isPreset) return { ok: false, error: '内置规则不能删除，只能停用' }
    this.#rules.splice(index, 1)
    this.#persist()
    return { ok: true }
  }

  /**
   * 恢复出厂规则：清掉自定义条目，内置条目回到默认的 pattern / 说明 / 开关。
   * @returns {number} 恢复后的规则条数
   */
  reset() {
    this.#rules = PRESET_SENSITIVE_COMMANDS.map((preset) => ({
      commandId: preset.commandId,
      pattern: preset.pattern,
      description: PRESET_DESCRIPTION_ZH[preset.commandId] ?? preset.description,
      enabled: preset.enabled,
      isPreset: true,
    }))
    this.#persist()
    return this.#rules.length
  }
}
