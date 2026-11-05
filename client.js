window.__ModuleLoader__.load({
  id: 'dsh-decision-guard',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 面板 HTTP 前缀，与 Host 侧 index.js 的 API_BASE 一致。 */
    const API_BASE = '/sensitive-guard/api'
    /** Host 条目 id，也是设置页的 section id。 */
    const SECTION_ID = 'dsh-decision-guard'

    /** 中英文案。说明文字一律放进 `?` 提示里，界面上只留标题。 */
    const STR = {
      zh: {
        sectionTitle: '决策模型守门',
        sectionDesc: '敏感命令审批、工具与技能按需加载、glob 排序，共用一套决策模型。',
        tabRules: '命令规则',
        tabAssist: '决策模型辅助',
        enabled: '启用决策模型辅助',
        enabledHelp: '默认关闭。关闭时命中规则的命令仍走原有的确认流程。',
        delegate: '由决策模型托管',
        delegateHelp:
          '开启后判定「允许」直接执行，不再打扰你；关闭时允许的判定只作为建议展示。拒绝不受它影响：判定说命令有风险，就一定会被拦下。',
        noPromptHint:
          '当前会话是「完全权限」模式（审批策略 never），弹不出确认框：允许的判定在未托管时会直接放行，拒绝一律拦下。想要「拦下但先问我」，请把会话切到需要审批的权限预设。',
        askOnDeny: '拒绝时仍让我确认',
        askOnDenyHelp: '判定拒绝时不直接拦下，而是弹出确认，由你决定是否执行。开启会降低自动拦截强度。',
        context: '参考最近会话',
        contextHelp:
          '默认关闭。开启后每次判定都会把最近几条会话发给决策模型（用户与助手的文本，以及已结束工具调用的名称、参数摘要和输出摘要），用来区分你明确要求的操作与 AI 自行发起的操作。',
        contextCount: '发送的会话条数',
        contextCountHelp: '默认 8，范围 1-50。条数越多判定依据越完整，发送的内容也越多。',
        connection: '连接',
        apiKey: 'API Key',
        apiKeyHelp: 'TypeSafe Jev 的 API Key，留空则功能静默不生效。',
        apiKeyPlaceholder: '粘贴新的 Key（已保存时显示掩码）',
        endpoint: '请求地址',
        endpointHelp: '默认官方端点。中国大陆直连会被 Cloudflare 按地域拒绝（HTTP 451），需要配合代理。',
        model: '模型',
        modelHelp: '默认 jev-latest。',
        proxy: '出站代理',
        proxyHelp: '留空则自动探测：面板配置 → 环境变量 → Windows 系统代理 → 直连。',
        proxyCurrent: '当前出口',
        proxyDirect: '直连',
        timeout: '判定超时',
        timeoutHelp: '单次判定的墙钟预算（毫秒）。超时即按下面的「不可用时」处理，不阻塞命令。',
        onUnavailable: '决策模型不可用时',
        onUnavailableHelp:
          '判定不出来时怎么办。默认交给当前权限模式：只读与工作区模式有沙箱兜底，放行；完全权限模式没有任何边界，拒绝。',
        onUnavailableAllow: '直接放行',
        onUnavailableFollow: '跟随当前权限模式',
        onUnavailableDeny: '直接拒绝',
        commandTools: '参与检查的工具',
        commandToolsHelp:
          '留空表示检查所有命令类工具（按参数里是否带命令字段判断）。填了则只检查列出的工具，逗号分隔。',
        commandToolsPlaceholder: '留空 = 检查所有命令类工具',
        test: '测试连接',
        testing: '测试中…',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        saveFailed: '保存失败',
        rulePreset: '内置',
        ruleCustom: '自定义',
        rulePattern: '正则',
        ruleDescription: '说明',
        ruleEnabled: '启用',
        ruleAdd: '新增规则',
        ruleAddTitle: '新增 / 编辑规则',
        ruleId: '规则 ID',
        ruleIdHelp: '唯一标识；内置规则的 ID 不能改。',
        rulePatternHelp: '大小写不敏感的正则。写坏了会被当成检查失败处理，不会静默放行。',
        ruleDelete: '删除',
        ruleDeleteConfirm: '删除这条规则？',
        ruleReset: '恢复内置规则',
        ruleResetConfirm: '恢复出厂规则？自定义规则会被清空，内置规则回到默认开关。',
        ruleEmpty: '还没有规则。点「新增规则」或「恢复内置规则」。',
        ruleCount: '{n} 条，启用 {on} 条',
        cancel: '取消',
        confirm: '确定',
        recent: '最近判定',
        recentEmpty: '还没有判定记录。',
        recentClear: '清空',
        recentClearConfirm: '清空最近判定记录？（只清面板上的观测记录，不影响规则和设置）',
        loading: '加载中…',
        loadFailed: '读取配置失败：{msg}',
        fromEnv: '环境变量',
        fromSystem: '系统代理',
        fromConfig: '面板配置',
        keySet: '已设置',
        keyUnset: '未设置',
        verdictAllow: '允许',
        verdictDeny: '拒绝',
        verdictUnavailable: '不可用',
        verdictCheckFailed: '检查失败',
        verdictSandbox: '交给沙箱',
        tabTools: '工具按需加载',
        tabSelection: '技能与文件',
        selectToolsEnabled: '按需加载工具',
        selectToolsEnabledHelp:
          '默认关闭。开启后每次对话先判定哪些工具与当前任务相关，其余暂时隐藏，省下工具清单占用的 token。隐藏的工具可以用 tool_search 找回来。',
        selectWhitelist: '常驻白名单',
        selectWhitelistHelp:
          '逗号分隔的工具名，这些工具永远不隐藏。默认已内置一组保底工具（查找、读写、搜索等），在这里填的会追加。',
        selectWhitelistPlaceholder: 'read, write, edit, bash',
        selectMinProbability: '相关性阈值',
        selectMinProbabilityHelp: '0-1 之间。判定概率高于该值的工具才保留，数值越高隐藏得越多。默认 0.5。',
        selectStats: '隐藏状态',
        selectStatsNone: '当前没有隐藏的工具，工具清单是完整的。',
        selectStatsHidden: '已隐藏 {n} 个工具',
        selectStatsSaved: '估算少发 {tokens} tokens',
        selectRestoreAll: '恢复全部工具',
        selectRestoreConfirm: '把所有会话里隐藏的工具全部恢复？只撤销隐藏状态，不动上面的设置。',
        selectSkillsEnabled: '按任务挑选技能',
        selectSkillsEnabledHelp:
          '默认关闭。开启后每个会话按当前任务判断哪些技能值得保留：过线的、且不超过上限的留在目录里，其余进按需池；技能集合变了才重新判定，避免目录每轮抖动。模型用 skill_catalog 查按需池，用 skill 按名加载。',
        selectSkillLimit: '最多保留技能数',
        selectSkillLimitHelp: '1-20，默认 8。只是最大保留数：过线的技能按相关性降序取前 N，不凑数；超出的进按需池。',
        selectSkillMinProbability: '技能相关阈值',
        selectSkillMinProbabilityHelp: '0-1 之间，默认 0.5。低于该概率的技能不进目录，进按需池。全部低于阈值时目录为空，并提示用 skill_catalog 查看。',
        selectFilesEnabled: '文件结果排序',
        selectFilesEnabledHelp:
          '默认关闭。开启后 glob 返回的路径按与当前任务的相关性排序，相关的排前面。路径一条都不会丢。',
        selectFileCandidates: '最多排序候选数',
        selectFileCandidatesHelp: '1-200，默认 40。候选超过这个数就原样返回，不给一次排序多花一轮模型请求。',
        selectUnavailable: '读不到按需加载设置：{msg}',
        selectUnavailableHelp:
          '这个页签要用后端的 /sensitive-guard/api/select 接口。接口没就绪时会一直显示这条提示，更新插件后重启 DSH 即可。',
        selectReload: '重新读取',
      },
      en: {
        sectionTitle: 'Decision Guard',
        sectionDesc: 'A decision model judges matched commands before they run.',
        tabRules: 'Command rules',
        tabAssist: 'Decision model assist',
        enabled: 'Enable decision model assist',
        enabledHelp: 'Off by default. When off, matched commands keep the original confirmation flow.',
        delegate: 'Let the decision model decide',
        delegateHelp:
          'When on, an allow verdict runs without asking you; when off, it is only shown as advice. Denials are not affected: a risky verdict is always blocked.',
        noPromptHint:
          'This session runs the full-access preset (approval policy never), so no prompt can appear: an allow verdict passes through when delegation is off, and a denial is always blocked. Switch to a preset that asks for approvals if you want "block, then ask me".',
        askOnDeny: 'Still ask me when denied',
        askOnDenyHelp:
          'On a deny verdict, ask instead of blocking, so you decide whether to run it. Turning it on weakens automatic blocking.',
        context: 'Include recent conversation',
        contextHelp:
          'Off by default. When on, the last few messages go to the decision model (user and assistant text plus finished tool-call names, argument digests and output digests).',
        contextCount: 'Conversation messages to send',
        contextCountHelp: 'Default 8, range 1-50. More messages give a fuller picture and send more content.',
        connection: 'Connection',
        apiKey: 'API key',
        apiKeyHelp: 'TypeSafe Jev API key. Empty means the assist stays inert.',
        apiKeyPlaceholder: 'Paste a new key (a saved key shows as a mask)',
        endpoint: 'Endpoint',
        endpointHelp:
          'Official endpoint by default. Direct access from mainland China is refused by region (HTTP 451), so pair it with a proxy.',
        model: 'Model',
        modelHelp: 'Defaults to jev-latest.',
        proxy: 'Outbound proxy',
        proxyHelp: 'Empty auto-detects: panel config → environment → Windows system proxy → direct.',
        proxyCurrent: 'Current egress',
        proxyDirect: 'direct',
        timeout: 'Decision timeout',
        timeoutHelp: 'Wall-clock budget per decision in milliseconds. A timeout falls back, never blocks the command.',
        onUnavailable: 'When the decision model is unavailable',
        onUnavailableHelp:
          'What happens without a verdict. The default follows the current permission mode: read-only and workspace-write are bounded by the sandbox, so the call proceeds; full access has no boundary, so it is denied.',
        onUnavailableAllow: 'Allow',
        onUnavailableFollow: 'Follow permission mode',
        onUnavailableDeny: 'Deny',
        commandTools: 'Inspected tools',
        commandToolsHelp:
          'Empty means every command-like tool (judged by whether its arguments carry a command field). Otherwise only the listed tools, comma separated.',
        commandToolsPlaceholder: 'Empty = every command-like tool',
        test: 'Test connection',
        testing: 'Testing…',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        saveFailed: 'Save failed',
        rulePreset: 'Built-in',
        ruleCustom: 'Custom',
        rulePattern: 'Pattern',
        ruleDescription: 'Description',
        ruleEnabled: 'Enabled',
        ruleAdd: 'Add rule',
        ruleAddTitle: 'Add / edit rule',
        ruleId: 'Rule id',
        ruleIdHelp: 'Unique identifier; built-in rule ids cannot change.',
        rulePatternHelp:
          'Case-insensitive regular expression. A broken pattern counts as a failed check rather than a silent pass.',
        ruleDelete: 'Delete',
        ruleDeleteConfirm: 'Delete this rule?',
        ruleReset: 'Restore built-in rules',
        ruleResetConfirm: 'Restore factory rules? Custom rules are cleared and built-ins return to their defaults.',
        ruleEmpty: 'No rules yet. Add one or restore the built-in set.',
        ruleCount: '{n} rules, {on} enabled',
        cancel: 'Cancel',
        confirm: 'Confirm',
        recent: 'Recent decisions',
        recentEmpty: 'No decisions recorded yet.',
        recentClear: 'Clear',
        recentClearConfirm: 'Clear the recent decision log? (Panel observations only; rules and settings stay.)',
        loading: 'Loading…',
        loadFailed: 'Could not load the configuration: {msg}',
        fromEnv: 'environment',
        fromSystem: 'system',
        fromConfig: 'panel',
        keySet: 'set',
        keyUnset: 'not set',
        verdictAllow: 'allow',
        verdictDeny: 'deny',
        verdictUnavailable: 'unavailable',
        verdictCheckFailed: 'check failed',
        verdictSandbox: 'sandbox decided',
        tabTools: 'On-demand tools',
        tabSelection: 'Skills & files',
        selectToolsEnabled: 'Load tools on demand',
        selectToolsEnabledHelp:
          'Off by default. When on, each conversation first judges which tools fit the task and hides the rest for now, saving the tokens the tool list would cost. Hidden tools can be found again with tool_search.',
        selectWhitelist: 'Always-on whitelist',
        selectWhitelistHelp:
          'Comma-separated tool names that are never hidden. A baseline set (lookup, read/write, search) is built in; entries here are added to it.',
        selectWhitelistPlaceholder: 'read, write, edit, bash',
        selectMinProbability: 'Relevance threshold',
        selectMinProbabilityHelp:
          'Between 0 and 1. Tools judged above it are kept; a higher value hides more. Defaults to 0.5.',
        selectStats: 'Hiding status',
        selectStatsNone: 'Nothing is hidden; the tool list is complete.',
        selectStatsHidden: '{n} tools hidden',
        selectStatsSaved: 'about {tokens} tokens saved',
        selectRestoreAll: 'Restore all tools',
        selectRestoreConfirm:
          'Restore every tool hidden in any session? Only the hiding is undone; the settings above stay.',
        selectSkillsEnabled: 'Pick skills per task',
        selectSkillsEnabledHelp:
          'Off by default. Each session judges which skills are worth keeping: those above the threshold and within the limit stay in the catalog; the rest go to an on-demand pool. Re-judged only when the skill set changes, so the catalog stays stable across turns. The model can list the pool with skill_catalog and load any skill by name.',
        selectSkillLimit: 'Skills to keep',
        selectSkillLimitHelp: '1-20, default 8. A maximum only: qualifying skills are kept by relevance, never padded; the overflow goes to the on-demand pool.',
        selectSkillMinProbability: 'Skill relevance threshold',
        selectSkillMinProbabilityHelp: '0-1, default 0.5. Skills below this probability leave the catalog and join the on-demand pool. If none qualify, the catalog is empty and points to skill_catalog.',
        selectFilesEnabled: 'Rank file results',
        selectFilesEnabledHelp:
          'Off by default. When on, paths returned by glob are ranked by relevance to the task, relevant ones first. No path is ever dropped.',
        selectFileCandidates: 'Paths to rank',
        selectFileCandidatesHelp:
          '1-200, default 40. More candidates than this and the results come back unchanged, sparing a model round trip.',
        selectUnavailable: 'Could not read the on-demand settings: {msg}',
        selectUnavailableHelp:
          'This tab needs the backend /sensitive-guard/api/select endpoint. While it is missing you keep seeing this note; restart DSH after updating the plugin.',
        selectReload: 'Reload',
      },
    }

    /** 当前语言：优先页面 <html lang>，没有就当英文。 */
    function pickLang() {
      const raw = typeof document !== 'undefined' ? String(document.documentElement?.lang ?? '') : ''
      return raw.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    /** 取一段文案并填充占位符。 */
    function makeT() {
      const lang = pickLang()
      const dict = STR[lang]
      return (key, values) => {
        const template = dict[key] ?? key
        if (values === undefined) return template
        return Object.entries(values).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          template,
        )
      }
    }

    /* select-panel-helpers:start */
    /** 逗号（含中文逗号）或换行分隔的文本 → 去空白、去重后的数组。 */
    function splitList(raw) {
      if (typeof raw !== 'string') return []
      return [...new Set(raw.split(/[,，\n]/).map((item) => item.trim()).filter((item) => item !== ''))]
    }

    /** 概率文本 → 0-1 之间的数；非法值回落到 `fallback`。 */
    function clamp01(raw, fallback) {
      if (raw === '' || raw === null || raw === undefined) return fallback
      const value = Number(raw)
      if (!Number.isFinite(value)) return fallback
      return Math.min(1, Math.max(0, value))
    }

    /** 整数文本 → 夹在 [min, max] 的整数；非法值回落到 `fallback`。 */
    function intOr(raw, fallback, min, max) {
      if (raw === '' || raw === null || raw === undefined) return fallback
      const value = Math.trunc(Number(raw))
      if (!Number.isSafeInteger(value)) return fallback
      return Math.min(max, Math.max(min, value))
    }

    /** 后端 select 快照 → 面板草稿：白名单数组摊成逗号文本，数字摊成输入框字符串。 */
    function selectDraftFrom(data) {
      return {
        toolsEnabled: data?.tools?.enabled === true,
        whitelistText: Array.isArray(data?.tools?.whitelist) ? data.tools.whitelist.join(', ') : '',
        toolMinProbability: String(data?.tools?.minProbability ?? 0.5),
        skillsEnabled: data?.selection?.skillsEnabled === true,
        skillLimit: String(data?.selection?.skillLimit ?? 8),
        skillMinProbability: String(data?.selection?.skillMinProbability ?? 0.5),
        filesEnabled: data?.selection?.filesEnabled === true,
        fileCandidates: String(data?.selection?.fileCandidates ?? 40),
      }
    }
    /* select-panel-helpers:end */

    /** 统一的小请求封装：返回 JSON，非 2xx 抛错。 */
    async function api(path, init) {
      const response = await fetch(`${API_BASE}/${path}`, {
        headers: { 'content-type': 'application/json' },
        ...init,
      })
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok) throw new Error(body?.message ?? body?.error ?? `HTTP ${response.status}`)
      return body
    }

    /**
     * 说明气泡：默认只显示一个 `?`，鼠标移上去才展开。
     *
     * 用 `title` 之外的自绘气泡，因为 title 有系统延迟且不能换行排版；
     * 但为了键盘与触屏也能看到，同时保留 `aria-label`。
     */
    function Help({ text }) {
      const [open, setOpen] = React.useState(false)
      if (text === undefined || text === '') return null
      return h(
        'span',
        {
          style: { position: 'relative', display: 'inline-flex', flex: '0 0 auto' },
          onMouseEnter: () => setOpen(true),
          onMouseLeave: () => setOpen(false),
          onFocus: () => setOpen(true),
          onBlur: () => setOpen(false),
        },
        h(
          'span',
          {
            role: 'button',
            tabIndex: 0,
            'aria-label': text,
            style: {
              width: 15,
              height: 15,
              borderRadius: '50%',
              border: '1px solid var(--dsw-alias-border-l2)',
              color: 'var(--dsw-alias-label-secondary)',
              fontSize: 10,
              lineHeight: '13px',
              textAlign: 'center',
              cursor: 'help',
              userSelect: 'none',
              flex: '0 0 auto',
            },
          },
          '?',
        ),
        open
          ? h(
              'div',
              {
                role: 'tooltip',
                style: {
                  position: 'absolute',
                  left: 0,
                  top: 20,
                  zIndex: 40,
                  // 绝对定位不参与布局，但太宽会在窄面板里溢出可视区，
                  // 所以宽度取「300px 与视口能容纳的更小者」。
                  width: 'min(300px, calc(100vw - 96px))',
                  maxWidth: 'calc(100vw - 96px)',
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-overlay)',
                  color: 'var(--dsw-alias-label-secondary)',
                  fontSize: 12,
                  lineHeight: 1.65,
                  whiteSpace: 'normal',
                  overflowWrap: 'anywhere',
                  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.28)',
                  pointerEvents: 'none',
                },
              },
              text,
            )
          : null,
      )
    }

    /**
     * 卡片一行：标题 + `?`，右侧是控件。
     *
     * 布局刻意做成「能换行」：窄面板时控件掉到下一行，而不是把整页撑出横向滚动条。
     * 所有子项都带 `minWidth: 0`，让 flex 真正允许收缩（flex 默认不收缩内容）。
     */
    function Row({ title, help, children }) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px 16px',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-2)',
            minWidth: 0,
            flexWrap: 'wrap',
            boxSizing: 'border-box',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '1 1 180px' } },
          h(
            'span',
            {
              style: {
                fontWeight: 600,
                fontSize: 13,
                color: 'var(--dsw-alias-label-primary)',
                minWidth: 0,
                overflowWrap: 'anywhere',
              },
            },
            title,
          ),
          h(Help, { text: help }),
        ),
        children === undefined
          ? null
          : h(
              'div',
              {
                style: {
                  flex: '0 1 auto',
                  minWidth: 0,
                  display: 'flex',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                },
              },
              children,
            ),
      )
    }

    /** 开关。 */
    function Toggle({ checked, disabled, onChange }) {
      return h(
        'label',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          },
        },
        h('input', {
          type: 'checkbox',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          checked,
          disabled,
          onChange: (event) => onChange(event.target.checked),
          style: { width: 16, height: 16, accentColor: 'var(--dsw-alias-brand-primary)', margin: 0 },
        }),
      )
    }

    /**
     * 文本输入。
     *
     * 用「弹性宽度 + 上限」而不是固定像素：面板窄的时候它跟着变窄，
     * 面板宽的时候最多长到 `width`，两头都不会把容器撑出去。
     */
    function TextInput({ value, onChange, placeholder, width = 240, type = 'text', disabled }) {
      return h('input', {
        type,
        value,
        placeholder,
        disabled,
        onChange: (event) => onChange(event.target.value),
        style: {
          flex: '1 1 120px',
          width: `min(${width}px, 100%)`,
          maxWidth: '100%',
          minWidth: 0,
          padding: '5px 9px',
          fontSize: 13,
          color: 'var(--dsw-alias-label-primary)',
          background: 'var(--dsw-alias-bg-base)',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: 6,
          outline: 'none',
          boxSizing: 'border-box',
        },
      })
    }

    /** 下拉。 */
    function Select({ value, onChange, options, width = 180 }) {
      return h(
        'select',
        {
          value,
          onChange: (event) => onChange(event.target.value),
          style: {
            flex: '1 1 120px',
            width: `min(${width}px, 100%)`,
            maxWidth: '100%',
            minWidth: 0,
            padding: '5px 9px',
            fontSize: 13,
            color: 'var(--dsw-alias-label-primary)',
            background: 'var(--dsw-alias-bg-base)',
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 6,
            boxSizing: 'border-box',
          },
        },
        options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
      )
    }

    /** 按钮。 */
    function Button({ children, onClick, primary, disabled, tone = 'normal' }) {
      const color =
        tone === 'danger'
          ? 'var(--dsw-alias-state-error-primary)'
          : primary
            ? 'var(--dsw-alias-brand-primary)'
            : 'var(--dsw-alias-label-secondary)'
      return h(
        'button',
        {
          type: 'button',
          onClick,
          disabled,
          style: {
            padding: '5px 12px',
            fontSize: 12.5,
            fontWeight: primary ? 600 : 500,
            color: primary ? 'var(--dsw-alias-bg-base)' : color,
            background: primary ? color : 'transparent',
            border: `1px solid ${primary ? color : 'var(--dsw-alias-border-l1)'}`,
            borderRadius: 6,
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            whiteSpace: 'nowrap',
          },
        },
        children,
      )
    }

    /** 卡片容器。 */
    function Card({ children }) {
      return h(
        'div',
        {
          style: {
            display: 'grid',
            gap: 8,
            padding: 14,
            borderRadius: 10,
            border: '1px solid var(--dsw-alias-border-l1)',
            background: 'var(--dsw-alias-bg-layer-1)',
            minWidth: 0,
          },
        },
        children,
      )
    }

    /** 「最近判定」一行。 */
    function DecisionRow({ entry, t }) {
      const label =
        entry.verdict === 'allow'
          ? t('verdictAllow')
          : entry.verdict === 'deny'
            ? t('verdictDeny')
            : entry.verdict === 'check-failed'
              ? t('verdictCheckFailed')
              : entry.verdict === 'delegate-sandbox'
                ? t('verdictSandbox')
                : t('verdictUnavailable')
      const color =
        entry.verdict === 'allow' || entry.verdict === 'delegate-sandbox'
          ? 'var(--dsw-alias-state-success-primary)'
          : entry.verdict === 'deny' || entry.verdict === 'check-failed'
            ? 'var(--dsw-alias-state-error-primary)'
            : 'var(--dsw-alias-state-warn-primary)'
      return h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: '72px minmax(0, 1fr) auto',
            gap: 10,
            alignItems: 'baseline',
            padding: '5px 0',
            borderTop: '1px solid var(--dsw-alias-border-l1)',
            fontSize: 12,
            minWidth: 0,
          },
        },
        h('span', { style: { color, fontWeight: 600, whiteSpace: 'nowrap' } }, label),
        h(
          'span',
          {
            style: {
              color: 'var(--dsw-alias-label-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            },
            title: entry.command ?? '',
          },
          `${entry.tool}${entry.rules === undefined ? '' : ` · ${entry.rules}`}${
            entry.reason === undefined ? '' : ` · ${entry.reason}`
          }${entry.detail === undefined ? '' : ` · ${entry.detail}`}`,
        ),
        h(
          'span',
          { style: { color: 'var(--dsw-alias-label-secondary)', opacity: 0.7, whiteSpace: 'nowrap' } },
          entry.at.slice(11, 19),
        ),
      )
    }

    /** 主组件：两个 Tab。 */
    function SensitiveGuardSection() {
      const t = makeT()
      const [tab, setTab] = React.useState('assist')
      const [config, setConfig] = React.useState(undefined)
      const [error, setError] = React.useState('')
      const [rules, setRules] = React.useState([])
      const [logEntries, setLogEntries] = React.useState([])
      const [draft, setDraft] = React.useState(null)
      const [status, setStatus] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
      const [selectState, setSelectState] = React.useState(null)
      const [selectDraft, setSelectDraft] = React.useState(null)
      const [selectError, setSelectError] = React.useState('')
      const [selectBusy, setSelectBusy] = React.useState(false)
      const [selectStatus, setSelectStatus] = React.useState('')

      /** 首次加载：配置、规则、判定记录。 */
      const load = React.useCallback(async () => {
        try {
          const [configResult, rulesResult, logResult] = await Promise.all([
            api('config'),
            api('rules'),
            api('log'),
          ])
          setConfig(configResult.config)
          setRules(rulesResult.rules)
          setLogEntries(logResult.entries)
          setError('')
        } catch (loadError) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      /**
       * 读取按需加载设置。
       *
       * 接口是后加的：旧版本插件上它还是 404，这里只记下错误，
       * 不让整个设置面板退化成「读取配置失败」。
       */
      const loadSelect = React.useCallback(async () => {
        try {
          const result = await api('select')
          setSelectState(result)
          setSelectDraft(selectDraftFrom(result))
          setSelectError('')
        } catch (selectLoadError) {
          setSelectError(selectLoadError instanceof Error ? selectLoadError.message : String(selectLoadError))
        }
      }, [])

      React.useEffect(() => {
        void loadSelect()
      }, [loadSelect])

      /** 本地改一个字段，延迟到「保存」才落盘。 */
      const patch = (values) => setConfig((current) => ({ ...current, ...values }))

      /** 把「参与检查的工具」输入框解析成数组：空就是空数组（= 全查）。 */
      const parseTools = () => {
        const raw = config.commandToolsText
        if (typeof raw === 'string') {
          return raw
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item !== '')
        }
        return config.commandTools
      }

      /** 保存配置。 */
      const save = async () => {
        setBusy(true)
        setStatus('')
        try {
          const body = {
            enabled: config.enabled,
            delegate: config.delegate,
            askOnDeny: config.askOnDeny,
            useConversationContext: config.useConversationContext,
            contextMessageCount: Number(config.contextMessageCount),
            endpoint: config.endpoint,
            model: config.model,
            proxy: config.proxy,
            timeoutMs: Number(config.timeoutMs),
            onUnavailable: config.onUnavailable,
            commandTools: parseTools(),
          }
          if (!config.apiKey.startsWith('••••')) body.apiKey = config.apiKey
          const result = await api('config', { method: 'POST', body: JSON.stringify(body) })
          setConfig({ ...result.config, commandToolsText: result.config.commandTools.join(', ') })
          setStatus(t('saved'))
        } catch (saveError) {
          setStatus(`${t('saveFailed')}: ${saveError instanceof Error ? saveError.message : String(saveError)}`)
        } finally {
          setBusy(false)
        }
      }

      /** 测试连接。 */
      const test = async () => {
        setTesting(true)
        setStatus('')
        try {
          const result = await api('test', { method: 'POST', body: JSON.stringify({ apiKey: config.apiKey }) })
          const outcome = result.result
          setStatus(
            outcome.ok
              ? `${t('test')} OK · ${outcome.latencyMs}ms${outcome.model === undefined ? '' : ` · ${outcome.model}`}${
                  outcome.error === undefined ? '' : ` · ${outcome.error}`
                }`
              : `${t('test')} ${outcome.error} · ${outcome.latencyMs}ms`,
          )
        } catch (testError) {
          setStatus(`${t('test')}: ${testError instanceof Error ? testError.message : String(testError)}`)
        } finally {
          setTesting(false)
        }
      }

      /** 规则操作。 */
      const ruleAction = async (body) => {
        try {
          const result = await api('rules', { method: 'POST', body: JSON.stringify(body) })
          setRules(result.rules)
        } catch (ruleError) {
          setStatus(`${t('saveFailed')}: ${ruleError instanceof Error ? ruleError.message : String(ruleError)}`)
        }
      }

      /** 清空最近判定。 */
      const clearLog = async () => {
        if (!window.confirm(t('recentClearConfirm'))) return
        try {
          const result = await api('log', { method: 'DELETE' })
          setLogEntries(result.entries)
        } catch (clearError) {
          setStatus(`${t('saveFailed')}: ${clearError instanceof Error ? clearError.message : String(clearError)}`)
        }
      }

      /** 改动按需加载草稿里的字段，等「保存」才落盘。 */
      const patchSelect = (values) => setSelectDraft((current) => ({ ...current, ...values }))

      /**
       * 提交 select 的一部分；只发本页签拥有的那一半，另一半留在后端。
       *
       * 落盘后重新读一次：状态区（隐藏数量、省下的 token）只认服务端的说法。
       */
      const saveSelect = async (payload) => {
        setSelectBusy(true)
        setSelectStatus('')
        try {
          await api('select', { method: 'POST', body: JSON.stringify(payload) })
          await loadSelect()
          setSelectStatus(t('saved'))
        } catch (selectSaveError) {
          setSelectStatus(
            `${t('saveFailed')}: ${selectSaveError instanceof Error ? selectSaveError.message : String(selectSaveError)}`,
          )
        } finally {
          setSelectBusy(false)
        }
      }

      /** 保存工具按需加载这一半。 */
      const saveTools = () =>
        saveSelect({
          tools: {
            enabled: selectDraft.toolsEnabled,
            whitelist: splitList(selectDraft.whitelistText),
            minProbability: clamp01(selectDraft.toolMinProbability, 0.5),
          },
        })

      /** 保存技能与文件这一半。 */
      const saveSelection = () =>
        saveSelect({
          selection: {
            skillsEnabled: selectDraft.skillsEnabled,
            skillLimit: intOr(selectDraft.skillLimit, 8, 1, 20),
            skillMinProbability: clamp01(selectDraft.skillMinProbability, 0.5),
            filesEnabled: selectDraft.filesEnabled,
            fileCandidates: intOr(selectDraft.fileCandidates, 40, 1, 200),
          },
        })

      /** 恢复本会话隐藏的全部工具。 */
      const restoreAll = async () => {
        if (!window.confirm(t('selectRestoreConfirm'))) return
        await saveSelect({ action: 'restore-all' })
      }

      if (error !== '') {
        return h(
          'section',
          { style: { padding: '16px 0' } },
          h(
            'div',
            { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } },
            t('loadFailed', { msg: error }),
          ),
        )
      }
      if (config === undefined) {
        return h(
          'section',
          { style: { padding: '16px 0', fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } },
          t('loading'),
        )
      }

      const tabButton = (key, label) =>
        h(
          'button',
          {
            type: 'button',
            key,
            onClick: () => setTab(key),
            style: {
              padding: '7px 2px',
              marginRight: 20,
              fontSize: 13,
              fontWeight: tab === key ? 600 : 400,
              color: tab === key ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${tab === key ? 'var(--dsw-alias-brand-primary)' : 'transparent'}`,
              cursor: 'pointer',
            },
          },
          label,
        )

      const assistPanel = h(
        'div',
        { style: { display: 'grid', gap: 6, paddingTop: 10, minWidth: 0 } },
        h(Row, {
          title: t('enabled'),
          help: t('enabledHelp'),
          children: h(Toggle, { checked: config.enabled, onChange: (value) => patch({ enabled: value }) }),
        }),
        h(Row, {
          title: t('delegate'),
          help: t('delegateHelp'),
          children: h(Toggle, { checked: config.delegate, onChange: (value) => patch({ delegate: value }) }),
        }),
        h(
          'div',
          {
            style: {
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--dsw-alias-state-warn-primary)',
              background: 'var(--dsw-alias-bg-layer-2)',
              fontSize: 12,
              lineHeight: 1.65,
              color: 'var(--dsw-alias-label-secondary)',
            },
          },
          t('noPromptHint'),
        ),
        h(Row, {
          title: t('askOnDeny'),
          help: t('askOnDenyHelp'),
          children: h(Toggle, { checked: config.askOnDeny, onChange: (value) => patch({ askOnDeny: value }) }),
        }),
        h(Row, {
          title: t('context'),
          help: t('contextHelp'),
          children: h(Toggle, {
            checked: config.useConversationContext,
            onChange: (value) => patch({ useConversationContext: value }),
          }),
        }),
        h(Row, {
          title: t('contextCount'),
          help: t('contextCountHelp'),
          children: h(TextInput, {
            value: String(config.contextMessageCount),
            type: 'number',
            width: 90,
            disabled: !config.useConversationContext,
            onChange: (value) => patch({ contextMessageCount: value }),
          }),
        }),
        h(
          'h3',
          { style: { margin: '10px 0 0', fontSize: 13, color: 'var(--dsw-alias-label-primary)' } },
          t('connection'),
        ),
        h(Row, {
          title: t('apiKey'),
          help: `${t('apiKeyHelp')} ${config.apiKeySet ? `(${t('keySet')})` : `(${t('keyUnset')})`}`,
          children: h(TextInput, {
            value: config.apiKey,
            type: 'password',
            placeholder: t('apiKeyPlaceholder'),
            width: 300,
            onChange: (value) => patch({ apiKey: value }),
          }),
        }),
        h(Row, {
          title: t('endpoint'),
          help: t('endpointHelp'),
          children: h(TextInput, {
            value: config.endpoint,
            width: 320,
            onChange: (value) => patch({ endpoint: value }),
          }),
        }),
        h(Row, {
          title: t('model'),
          help: t('modelHelp'),
          children: h(TextInput, {
            value: config.model,
            width: 180,
            onChange: (value) => patch({ model: value }),
          }),
        }),
        h(Row, {
          title: t('proxy'),
          help: `${t('proxyHelp')}\n${t('proxyCurrent')}: ${
            config.proxyInfo.source === 'direct'
              ? t('proxyDirect')
              : `${config.proxyInfo.endpoint} (${config.proxyInfo.source})`
          }`,
          children: h(TextInput, {
            value: config.proxy,
            placeholder: 'http://127.0.0.1:7890',
            width: 240,
            onChange: (value) => patch({ proxy: value }),
          }),
        }),
        h(Row, {
          title: t('timeout'),
          help: t('timeoutHelp'),
          children: h(TextInput, {
            value: String(config.timeoutMs),
            type: 'number',
            width: 90,
            onChange: (value) => patch({ timeoutMs: value }),
          }),
        }),
        h(Row, {
          title: t('onUnavailable'),
          help: t('onUnavailableHelp'),
          children: h(Select, {
            value: config.onUnavailable,
            width: 180,
            onChange: (value) => patch({ onUnavailable: value }),
            options: [
              { value: 'allow', label: t('onUnavailableAllow') },
              { value: 'follow-sandbox', label: t('onUnavailableFollow') },
              { value: 'deny', label: t('onUnavailableDeny') },
            ],
          }),
        }),
        h(Row, {
          title: t('commandTools'),
          help: t('commandToolsHelp'),
          children: h(TextInput, {
            value: config.commandToolsText ?? config.commandTools.join(', '),
            width: 320,
            placeholder: t('commandToolsPlaceholder'),
            onChange: (value) => patch({ commandToolsText: value }),
          }),
        }),
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', paddingTop: 4, flexWrap: 'wrap' } },
          h(Button, { primary: true, disabled: busy, onClick: () => void save() }, busy ? t('saving') : t('save')),
          h(Button, { disabled: testing, onClick: () => void test() }, testing ? t('testing') : t('test')),
          status === ''
            ? null
            : h(
                'span',
                { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', minWidth: 0 } },
                status,
              ),
        ),
      )

      const rulesPanel = h(
        'div',
        { style: { display: 'grid', gap: 6, paddingTop: 10, minWidth: 0 } },
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h(
            'span',
            { style: { flex: '1 1 auto', fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' } },
            t('ruleCount', { n: rules.length, on: rules.filter((rule) => rule.enabled).length }),
          ),
          h(
            Button,
            {
              primary: true,
              onClick: () => setDraft({ commandId: '', pattern: '', description: '', enabled: true, isPreset: false }),
            },
            t('ruleAdd'),
          ),
          h(
            Button,
            {
              tone: 'danger',
              onClick: () => {
                if (window.confirm(t('ruleResetConfirm'))) void ruleAction({ action: 'reset' })
              },
            },
            t('ruleReset'),
          ),
        ),
        draft === null
          ? null
          : h(
              Card,
              null,
              h('div', { style: { fontSize: 13, fontWeight: 600 } }, t('ruleAddTitle')),
              h(
                'label',
                { style: { display: 'grid', gap: 4, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                h(
                  'span',
                  { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                  t('ruleId'),
                  h(Help, { text: t('ruleIdHelp') }),
                ),
                h(TextInput, {
                  value: draft.commandId,
                  width: 260,
                  disabled: draft.isPreset,
                  onChange: (value) => setDraft({ ...draft, commandId: value }),
                }),
              ),
              h(
                'label',
                { style: { display: 'grid', gap: 4, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                h(
                  'span',
                  { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                  t('rulePattern'),
                  h(Help, { text: t('rulePatternHelp') }),
                ),
                h(TextInput, {
                  value: draft.pattern,
                  width: 420,
                  onChange: (value) => setDraft({ ...draft, pattern: value }),
                }),
              ),
              h(
                'label',
                { style: { display: 'grid', gap: 4, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                t('ruleDescription'),
                h(TextInput, {
                  value: draft.description,
                  width: 420,
                  onChange: (value) => setDraft({ ...draft, description: value }),
                }),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                h(Toggle, {
                  checked: draft.enabled,
                  onChange: (value) => setDraft({ ...draft, enabled: value }),
                }),
                h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('ruleEnabled')),
                h('span', { style: { flex: '1 1 auto' } }),
                h(Button, { onClick: () => setDraft(null) }, t('cancel')),
                h(
                  Button,
                  {
                    primary: true,
                    onClick: () => {
                      void ruleAction({
                        action: 'upsert',
                        commandId: draft.commandId,
                        pattern: draft.pattern,
                        description: draft.description,
                        enabled: draft.enabled,
                      }).then(() => setDraft(null))
                    },
                  },
                  t('confirm'),
                ),
              ),
            ),
        rules.length === 0
          ? h('div', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' } }, t('ruleEmpty'))
          : h(
              'div',
              { style: { display: 'grid', gap: 5, minWidth: 0 } },
              rules.map((rule) =>
                h(
                  'div',
                  {
                    key: rule.commandId,
                    style: {
                      display: 'grid',
                      // 自适应多列：面板窄时后面的列自动掉到下一行，不会撑出横向滚动。
                      gridTemplateColumns: 'repeat(auto-fit, minmax(min(160px, 100%), 1fr))',
                      gap: '6px 12px',
                      alignItems: 'center',
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--dsw-alias-border-l1)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      fontSize: 12.5,
                      minWidth: 0,
                      boxSizing: 'border-box',
                    },
                  },
                  h(
                    'div',
                    { style: { display: 'grid', gap: 1, minWidth: 0 } },
                    h(
                      'span',
                      {
                        style: {
                          fontWeight: 600,
                          color: 'var(--dsw-alias-label-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        },
                        title: rule.commandId,
                      },
                      rule.commandId,
                    ),
                    h(
                      'span',
                      { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                      rule.isPreset ? t('rulePreset') : t('ruleCustom'),
                    ),
                  ),
                  h(
                    'code',
                    {
                      style: {
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontSize: 11.5,
                        color: 'var(--dsw-alias-label-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      },
                      title: rule.pattern,
                    },
                    rule.pattern,
                  ),
                  h(
                    'span',
                    {
                      style: {
                        color: 'var(--dsw-alias-label-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      },
                      title: rule.description,
                    },
                    rule.description,
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 } },
                    h(Toggle, {
                      checked: rule.enabled,
                      onChange: (value) =>
                        void ruleAction({ action: 'toggle', commandId: rule.commandId, enabled: value }),
                    }),
                    h(Button, { onClick: () => setDraft({ ...rule }) }, '✎'),
                    rule.isPreset
                      ? null
                      : h(
                          Button,
                          {
                            tone: 'danger',
                            onClick: () => {
                              if (window.confirm(t('ruleDeleteConfirm'))) {
                                void ruleAction({ action: 'delete', commandId: rule.commandId })
                              }
                            },
                          },
                          t('ruleDelete'),
                        ),
                  ),
                ),
              ),
            ),
      )

      const hidden = selectState?.stats?.hidden ?? []
      const savedTokens = selectState?.stats?.savedTokens ?? 0

      /** select 接口没就绪时的提示盒：说明原因，给一个重读按钮。 */
      const selectUnavailablePanel = h(
        'div',
        { style: { display: 'grid', gap: 10, paddingTop: 10, minWidth: 0 } },
        h(
          'div',
          {
            style: {
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--dsw-alias-state-warn-primary)',
              background: 'var(--dsw-alias-bg-layer-2)',
              fontSize: 12.5,
              lineHeight: 1.65,
              color: 'var(--dsw-alias-label-secondary)',
              minWidth: 0,
            },
          },
          h(
            'span',
            { style: { minWidth: 0, overflowWrap: 'anywhere' } },
            t('selectUnavailable', { msg: selectError }),
          ),
          h(Help, { text: t('selectUnavailableHelp') }),
        ),
        h('div', null, h(Button, { onClick: () => void loadSelect() }, t('selectReload'))),
      )

      /** 首次读取还没回来时的占位。 */
      const selectLoadingPanel = h(
        'div',
        { style: { paddingTop: 10, fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } },
        t('loading'),
      )

      /** 两个新页签共用的保存行：保存按钮 + 可选附加按钮 + 状态文字。 */
      const selectSaveRow = (onSave, extra) =>
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', paddingTop: 4, flexWrap: 'wrap' } },
          h(
            Button,
            { primary: true, disabled: selectBusy, onClick: () => void onSave() },
            selectBusy ? t('saving') : t('save'),
          ),
          extra,
          selectStatus === ''
            ? null
            : h(
                'span',
                { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', minWidth: 0 } },
                selectStatus,
              ),
        )

      const toolsPanel =
        selectDraft === null
          ? selectError === ''
            ? selectLoadingPanel
            : selectUnavailablePanel
          : h(
              'div',
              { style: { display: 'grid', gap: 6, paddingTop: 10, minWidth: 0 } },
              h(Row, {
                title: t('selectToolsEnabled'),
                help: t('selectToolsEnabledHelp'),
                children: h(Toggle, {
                  checked: selectDraft.toolsEnabled,
                  disabled: selectBusy,
                  onChange: (value) => patchSelect({ toolsEnabled: value }),
                }),
              }),
              h(Row, {
                title: t('selectWhitelist'),
                help: t('selectWhitelistHelp'),
                children: h(TextInput, {
                  value: selectDraft.whitelistText,
                  width: 320,
                  placeholder: t('selectWhitelistPlaceholder'),
                  disabled: selectBusy,
                  onChange: (value) => patchSelect({ whitelistText: value }),
                }),
              }),
              h(Row, {
                title: t('selectMinProbability'),
                help: t('selectMinProbabilityHelp'),
                children: h(TextInput, {
                  value: selectDraft.toolMinProbability,
                  type: 'number',
                  width: 90,
                  disabled: selectBusy,
                  onChange: (value) => patchSelect({ toolMinProbability: value }),
                }),
              }),
              h(
                'div',
                {
                  style: {
                    display: 'grid',
                    gap: 4,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--dsw-alias-border-l1)',
                    background: 'var(--dsw-alias-bg-layer-2)',
                    fontSize: 12,
                    lineHeight: 1.7,
                    color: 'var(--dsw-alias-label-secondary)',
                    minWidth: 0,
                  },
                },
                h(
                  'div',
                  { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } },
                  t('selectStats'),
                ),
                h(
                  'div',
                  { title: hidden.join(', '), style: { minWidth: 0, overflowWrap: 'anywhere' } },
                  hidden.length === 0
                    ? t('selectStatsNone')
                    : `${t('selectStatsHidden', { n: hidden.length })} · ${t('selectStatsSaved', {
                        tokens: savedTokens,
                      })}`,
                ),
              ),
              selectSaveRow(
                saveTools,
                h(
                  Button,
                  { tone: 'danger', disabled: selectBusy || hidden.length === 0, onClick: () => void restoreAll() },
                  t('selectRestoreAll'),
                ),
              ),
            )

      const selectionPanel =
        selectDraft === null
          ? selectError === ''
            ? selectLoadingPanel
            : selectUnavailablePanel
          : h(
              'div',
              { style: { display: 'grid', gap: 6, paddingTop: 10, minWidth: 0 } },
              h(Row, {
                title: t('selectSkillsEnabled'),
                help: t('selectSkillsEnabledHelp'),
                children: h(Toggle, {
                  checked: selectDraft.skillsEnabled,
                  disabled: selectBusy,
                  onChange: (value) => patchSelect({ skillsEnabled: value }),
                }),
              }),
              h(Row, {
                title: t('selectSkillLimit'),
                help: t('selectSkillLimitHelp'),
                children: h(TextInput, {
                  value: selectDraft.skillLimit,
                  type: 'number',
                  width: 90,
                  disabled: selectBusy || !selectDraft.skillsEnabled,
                  onChange: (value) => patchSelect({ skillLimit: value }),
                }),
              }),
              h(Row, {
                title: t('selectSkillMinProbability'),
                help: t('selectSkillMinProbabilityHelp'),
                children: h(TextInput, {
                  value: selectDraft.skillMinProbability,
                  type: 'number',
                  width: 90,
                  disabled: selectBusy || !selectDraft.skillsEnabled,
                  onChange: (value) => patchSelect({ skillMinProbability: value }),
                }),
              }),
              h(Row, {
                title: t('selectFilesEnabled'),
                help: t('selectFilesEnabledHelp'),
                children: h(Toggle, {
                  checked: selectDraft.filesEnabled,
                  disabled: selectBusy,
                  onChange: (value) => patchSelect({ filesEnabled: value }),
                }),
              }),
              h(Row, {
                title: t('selectFileCandidates'),
                help: t('selectFileCandidatesHelp'),
                children: h(TextInput, {
                  value: selectDraft.fileCandidates,
                  type: 'number',
                  width: 90,
                  disabled: selectBusy || !selectDraft.filesEnabled,
                  onChange: (value) => patchSelect({ fileCandidates: value }),
                }),
              }),
              selectSaveRow(saveSelection),
            )

      return h(
        'section',
        { style: { display: 'grid', gap: 8, padding: '14px 0', minWidth: 0, width: '100%', boxSizing: 'border-box' } },
        h(
          'div',
          { style: { display: 'grid', gap: 2 } },
          h(
            'h2',
            { style: { margin: 0, fontSize: 17, color: 'var(--dsw-alias-label-primary)' } },
            t('sectionTitle'),
          ),
          h(
            'p',
            { style: { margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' } },
            t('sectionDesc'),
          ),
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexWrap: 'wrap',
              borderBottom: '1px solid var(--dsw-alias-border-l1)',
            },
          },
          [
            tabButton('rules', t('tabRules')),
            tabButton('assist', t('tabAssist')),
            tabButton('tools', t('tabTools')),
            tabButton('skills', t('tabSelection')),
          ],
        ),
        tab === 'rules'
          ? rulesPanel
          : tab === 'tools'
            ? toolsPanel
            : tab === 'skills'
              ? selectionPanel
              : assistPanel,
        h(
          'div',
          { style: { display: 'grid', gap: 4, marginTop: 8, minWidth: 0 } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(
              'h3',
              { style: { margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-primary)', flex: '1 1 auto' } },
              t('recent'),
            ),
            logEntries.length === 0 ? null : h(Button, { tone: 'danger', onClick: () => void clearLog() }, t('recentClear')),
          ),
          logEntries.length === 0
            ? h(
                'div',
                { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
                t('recentEmpty'),
              )
            : h(
                'div',
                { style: { minWidth: 0 } },
                logEntries.slice(0, 20).map((entry, index) =>
                  h(DecisionRow, { key: `${entry.at}-${index}`, entry, t }),
                ),
              ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: SECTION_ID,
              order: 470,
              label: () => {
                const lang = pickLang()
                return lang === 'zh' ? '决策模型守门' : 'Decision Guard'
              },
            },
            SensitiveGuardSection,
          ),
        )
      },
    }
  },
})
