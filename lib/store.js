/**
 * 配置与规则持久化。
 *
 * 刻意不落进插件目录的 `cordis.patch.yml`：那个文件和 `lib/` 一起住在
 * `node_modules` 下，任何一次 pnpm 操作都会把整包从 store 重新展开，配置随之蒸发。
 * 这里统一写到 `$DSH_HOME/plugins/<插件名>/`，与包生命周期解耦；升级、重装都不受影响。
 *
 * 读失败一律回落到内存默认值，绝不因为配置坏了就放行命令。
 *
 * @module dsh-decision-guard/store
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PRESET_SENSITIVE_COMMANDS, PRESET_DESCRIPTION_ZH } from './rules.js'

/** 插件名，同时是 `$DSH_HOME/plugins/` 下的目录名。 */
export const PLUGIN_NAME = 'dsh-decision-guard'

/** 改名前的目录名：首次启动时把它的配置复制过来。 */
export const LEGACY_PLUGIN_NAME = 'dsh-sensitive-guard'

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
 * @property {boolean} toolsEnabled 按需加载工具总开关
 * @property {readonly string[]} toolWhitelist 永远常驻、不被摘掉的工具名
 * @property {number} toolMinProbability 工具常驻所需的最低相关概率 0-1
 * @property {boolean} skillsEnabled 技能目录按需裁剪开关
 * @property {number} skillLimit 最多保留几个技能摘要
 * @property {number} skillMinProbability 技能入选所需的最低相关概率 0-1
 * @property {boolean} filesEnabled glob 结果排序开关
 * @property {number} fileCandidates 参与排序的候选路径上限
 */

/**
 * 默认常驻工具：少了它们，模型连「把工具找回来」这一步都做不了。
 * 用户可以在面板里追加，但这一组不允许被决策模型摘掉。
 */
export const DEFAULT_TOOL_WHITELIST = Object.freeze([
  // 通用命名
  'read',
  'write',
  'edit',
  'bash',
  'glob',
  'grep',
  'todo',
  // 本环境实际工具名：dsh-ops 用 ops_*，名字对不上白名单就等于没保护
  'ops_read_files',
  'ops_bash',
  'ops_glob',
  'ops_grep',
  'ops_inspect_local_file',
  'ops_result',
  'ops_discover_tools',
  'todo_write',
  'skill',
  'tool_search',
  'skill_catalog',
])

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
  toolsEnabled: false,
  toolWhitelist: DEFAULT_TOOL_WHITELIST,
  toolMinProbability: 0.5,
  skillsEnabled: false,
  skillLimit: 8,
  skillMinProbability: 0.5,
  filesEnabled: false,
  fileCandidates: 40,
})

/** 会话上下文条数的取值区间，与原版一致。 */
export const MIN_CONTEXT_MESSAGES = 1
export const MAX_CONTEXT_MESSAGES = 50

/**
 * `$DSH_HOME`，缺省 `~/.dsh`。
 */
export function dshHome() {
  const fromEnv = process.env['DSH_HOME']
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/**
 * 插件自己的数据目录。
 *
 * 改名后首次启动时，把旧目录的 config.json / rules.json 复制过来：
 * 新目录一旦存在就不再迁移，旧目录原样保留，用户回退旧版本也能拿到配置。
 * 复制失败时退回旧目录继续用——配置宁可住错地方，也不能凭空消失。
 */
export function dataDir() {
  const current = join(dshHome(), 'plugins', PLUGIN_NAME)
  if (existsSync(current)) return current
  const legacy = join(dshHome(), 'plugins', LEGACY_PLUGIN_NAME)
  if (!existsSync(legacy)) return current
  try {
    mkdirSync(current, { recursive: true })
    for (const name of ['config.json', 'rules.json']) {
      const from = join(legacy, name)
      if (existsSync(from)) copyFileSync(from, join(current, name))
    }
    return current
  } catch {
    // 半迁移：current 建好了但复制没成功。留着空壳会让下次启动直接读它，
    // 配置从此分叉（旧目录还有完整数据）。删掉空壳，下次还能重试。
    try {
      rmSync(current, { recursive: true, force: true })
    } catch {
      /* 删不掉就退回旧目录，至少旧配置还在 */
    }
    return legacy
  }
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
  const probability = (key, fallback) => {
    const value = Number(input[key])
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback
  }
  const bounded = (key, fallback, max) => {
    const value = Number(input[key])
    return Number.isFinite(value) ? Math.min(max, Math.max(1, Math.round(value))) : fallback
  }
  const whitelist = Array.isArray(input['toolWhitelist'])
    ? [...new Set(input['toolWhitelist'].filter((name) => typeof name === 'string' && name.trim() !== '').map((name) => name.trim()))]
    : [...DEFAULT_TOOL_WHITELIST]
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
    toolsEnabled: flag('toolsEnabled', DEFAULT_SETTINGS.toolsEnabled),
    toolWhitelist: whitelist,
    toolMinProbability: probability('toolMinProbability', DEFAULT_SETTINGS.toolMinProbability),
    skillsEnabled: flag('skillsEnabled', DEFAULT_SETTINGS.skillsEnabled),
    skillLimit: bounded('skillLimit', DEFAULT_SETTINGS.skillLimit, 20),
    skillMinProbability: probability('skillMinProbability', DEFAULT_SETTINGS.skillMinProbability),
    filesEnabled: flag('filesEnabled', DEFAULT_SETTINGS.filesEnabled),
    fileCandidates: bounded('fileCandidates', DEFAULT_SETTINGS.fileCandidates, 200),
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
 * 先落盘再更新内存：落盘失败会抛给调用方，内存仍是旧值，不会留下「界面显示已保存、
 * 磁盘没变」的假象。
 */
export class SettingsStore {
  /** @type {Settings} */
  #value

  constructor() {
    const raw = readJson(SETTINGS_FILE())
    if (raw === undefined) {
      this.#value = normalizeSettings(DEFAULT_SETTINGS)
      return
    }
    this.#value = normalizeSettings(raw)
  }

  /** @returns {Settings} 当前设置（内部对象，调用方只读，改动请走 {@link update}）。 */
  get() {
    return this.#value
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
