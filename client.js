window.__ModuleLoader__.load({
  id: 'dsh-sensitive-guard',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 面板 HTTP 前缀，与 Host 侧 index.js 的 API_BASE 一致。 */
    const API_BASE = '/sensitive-guard/api'
    /** Host 条目 id，也是设置页的 section id。 */
    const SECTION_ID = 'dsh-sensitive-guard'

    /** 中英文案。说明文字一律放进 `?` 提示里，界面上只留标题。 */
    const STR = {
      zh: {
        sectionTitle: '敏感命令守门',
        sectionDesc: '命中敏感命令规则时，先让决策模型判定能不能直接执行。',
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
      },
      en: {
        sectionTitle: 'Sensitive Command Guard',
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
      const dict = STR[lang] ?? STR.en
      return (key, values) => {
        const template = dict[key] ?? STR.en[key] ?? key
        if (values === undefined) return template
        return Object.entries(values).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          template,
        )
      }
    }

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
          `${entry.tool ?? ''}${entry.rules === undefined ? '' : ` · ${entry.rules}`}${
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

      /** 首次加载：配置、规则、判定记录。 */
      const load = React.useCallback(async () => {
        try {
          const [configResult, rulesResult, logResult] = await Promise.all([
            api('config'),
            api('rules'),
            api('log'),
          ])
          setConfig(configResult.config)
          setRules(rulesResult.rules ?? [])
          setLogEntries(logResult.entries ?? [])
          setError('')
        } catch (loadError) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      /** 本地改一个字段，延迟到「保存」才落盘。 */
      const patch = (values) => setConfig((current) => ({ ...(current ?? {}), ...values }))

      /** 把「参与检查的工具」输入框解析成数组：空就是空数组（= 全查）。 */
      const parseTools = () => {
        const raw = config.commandToolsText
        if (typeof raw === 'string') {
          return raw
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item !== '')
        }
        return Array.isArray(config.commandTools) ? config.commandTools : []
      }

      /** 保存配置。 */
      const save = async () => {
        if (config === undefined) return
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
          if (typeof config.apiKey === 'string' && !config.apiKey.startsWith('••••')) body.apiKey = config.apiKey
          const result = await api('config', { method: 'POST', body: JSON.stringify(body) })
          setConfig({ ...result.config, commandToolsText: (result.config.commandTools ?? []).join(', ') })
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
          const result = await api('test', { method: 'POST', body: JSON.stringify({ apiKey: config?.apiKey }) })
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
          setRules(result.rules ?? [])
        } catch (ruleError) {
          setStatus(`${t('saveFailed')}: ${ruleError instanceof Error ? ruleError.message : String(ruleError)}`)
        }
      }

      /** 清空最近判定。 */
      const clearLog = async () => {
        if (!window.confirm(t('recentClearConfirm'))) return
        try {
          const result = await api('log', { method: 'DELETE' })
          setLogEntries(result.entries ?? [])
        } catch (clearError) {
          setStatus(`${t('saveFailed')}: ${clearError instanceof Error ? clearError.message : String(clearError)}`)
        }
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
            value: String(config.contextMessageCount ?? 8),
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
            value: config.apiKey ?? '',
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
            value: config.endpoint ?? '',
            width: 320,
            onChange: (value) => patch({ endpoint: value }),
          }),
        }),
        h(Row, {
          title: t('model'),
          help: t('modelHelp'),
          children: h(TextInput, {
            value: config.model ?? '',
            width: 180,
            onChange: (value) => patch({ model: value }),
          }),
        }),
        h(Row, {
          title: t('proxy'),
          help: `${t('proxyHelp')}\n${t('proxyCurrent')}: ${
            config.proxyInfo?.source === 'direct'
              ? t('proxyDirect')
              : `${config.proxyInfo?.endpoint ?? ''} (${config.proxyInfo?.source ?? ''})`
          }`,
          children: h(TextInput, {
            value: config.proxy ?? '',
            placeholder: 'http://127.0.0.1:7890',
            width: 240,
            onChange: (value) => patch({ proxy: value }),
          }),
        }),
        h(Row, {
          title: t('timeout'),
          help: t('timeoutHelp'),
          children: h(TextInput, {
            value: String(config.timeoutMs ?? 3000),
            type: 'number',
            width: 90,
            onChange: (value) => patch({ timeoutMs: value }),
          }),
        }),
        h(Row, {
          title: t('onUnavailable'),
          help: t('onUnavailableHelp'),
          children: h(Select, {
            value: config.onUnavailable ?? 'follow-sandbox',
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
            value: config.commandToolsText ?? (config.commandTools ?? []).join(', '),
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
        h('div', { style: { borderBottom: '1px solid var(--dsw-alias-border-l1)' } }, [
          tabButton('rules', t('tabRules')),
          tabButton('assist', t('tabAssist')),
        ]),
        tab === 'rules' ? rulesPanel : assistPanel,
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
                return lang === 'zh' ? '敏感命令守门' : 'Sensitive Guard'
              },
            },
            SensitiveGuardSection,
          ),
        )
      },
    }
  },
})
