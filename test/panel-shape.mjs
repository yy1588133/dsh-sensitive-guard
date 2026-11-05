/**
 * 设置面板形状自测：不启动 Web、不加载宿主，只读文本与求值纯函数。
 * - 语法：client.js 能被 Node 解析
 * - 两个新页签：tab 按钮、tab 分派、页签键都在
 * - 接口：GET / POST select 按契约调用
 * - 文案：zh / en / locale 三处键齐全且一致，原有两个页签文案不变
 * - 纯函数：白名单拆分、概率与整数夹取的真实行为
 *
 * 用法：node test/panel-shape.mjs
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let passed = 0
let failed = 0
/** @param {string} name 用例名 @param {() => void} body 断言体 */
function test(name, body) {
  try {
    body()
    passed += 1
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

/** 新页签必须新增的键：一个都不能少，也不该多出别的。 */
const NEW_KEYS = [
  'tabTools',
  'tabSelection',
  'selectToolsEnabled',
  'selectToolsEnabledHelp',
  'selectWhitelist',
  'selectWhitelistHelp',
  'selectWhitelistPlaceholder',
  'selectMinProbability',
  'selectMinProbabilityHelp',
  'selectStats',
  'selectStatsNone',
  'selectStatsHidden',
  'selectStatsSaved',
  'selectRestoreAll',
  'selectRestoreConfirm',
  'selectSkillsEnabled',
  'selectSkillsEnabledHelp',
  'selectSkillLimit',
  'selectSkillLimitHelp',
  'selectSkillMinProbability',
  'selectSkillMinProbabilityHelp',
  'selectFilesEnabled',
  'selectFilesEnabledHelp',
  'selectFileCandidates',
  'selectFileCandidatesHelp',
  'selectUnavailable',
  'selectUnavailableHelp',
  'selectReload',
]

/** 新键的组织性前缀，用来证明没有撞进旧命名空间。 */
const NEW_KEY_PREFIXES = ['tabTools', 'tabSelection', 'select']

const SRC = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** 抽出 `const STR = {...}` 字面量求值：它只含字符串，没有外部引用。 */
function readStr() {
  const start = SRC.indexOf('const STR = ')
  assert.ok(start >= 0, 'client.js 里找不到 const STR 定义')
  const tail = SRC.slice(start + 'const STR = '.length)
  const end = tail.indexOf('\n    /** 当前语言')
  assert.ok(end > 0, 'STR 字面量后面找不到结束锚点')
  const literal = tail.slice(0, end).trim().replace(/,$/, '')
  return new Function(`return ${literal}`)()
}

const STR = readStr()

/** 抽出 select-panel-helpers 标记之间的纯函数并求值。 */
function readHelpers() {
  const start = SRC.indexOf('/* select-panel-helpers:start */')
  const end = SRC.indexOf('/* select-panel-helpers:end */')
  assert.ok(start >= 0 && end > start, 'client.js 里找不到 select-panel-helpers 标记块')
  const block = SRC.slice(start, end)
  return new Function(`${block}; return { splitList, clamp01, intOr, selectDraftFrom }`)()
}

/** 读一个 locale 文件。 */
function readLocale(name) {
  return JSON.parse(readFileSync(new URL(`../locale/${name}.json`, import.meta.url), 'utf8'))
}

/** 「最近判定」改造必须新增的键。 */
const RECORD_KEYS = [
  'recordsCategoryCommand',
  'recordsCategoryTool',
  'recordsCategorySkill',
  'recordsCount',
  'recordsPageSize',
  'recordsPrev',
  'recordsNext',
  'recordsClear',
  'recordsClearConfirm',
  'recordsCleared',
  'recordsCopy',
  'recordsCopied',
  'recordsCopyFailed',
  'recordsHidden',
  'recordsKept',
  'recordsSavedTokens',
  'recordsWriteError',
  'recordsLoadFailed',
]

/** 抽出 records-panel-helpers 标记之间的纯函数并求值。 */
function readRecordsHelpers() {
  const start = SRC.indexOf('/* records-panel-helpers:start */')
  const end = SRC.indexOf('/* records-panel-helpers:end */')
  assert.ok(start >= 0 && end > start, 'client.js 里找不到 records-panel-helpers 标记块')
  const block = SRC.slice(start, end)
  return new Function(`${block}; return { recordsPages, entrySummary }`)()
}

test('client.js 能被 Node 解析', () => {
  execFileSync(process.execPath, ['--check', fileURLToPath(new URL('../client.js', import.meta.url))], {
    stdio: 'pipe',
  })
})

test('zh / en 键集合一致', () => {
  assert.deepEqual(Object.keys(STR.zh).sort(), Object.keys(STR.en).sort())
})

test('新键在两个语言里都存在且非空', () => {
  for (const key of NEW_KEYS) {
    for (const lang of ['zh', 'en']) {
      const value = STR[lang][key]
      assert.equal(typeof value, 'string', `${lang}.${key} 必须是字符串`)
      assert.ok(value.trim() !== '', `${lang}.${key} 不能为空`)
    }
  }
})

test('新键都落在新前缀下，没有覆盖旧键', () => {
  for (const key of NEW_KEYS) {
    assert.ok(
      NEW_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
      `${key} 不在约定的新前缀下`,
    )
  }
})

test('原有两个页签的文案没变', () => {
  assert.equal(STR.zh.tabRules, '命令规则')
  assert.equal(STR.zh.tabAssist, '决策模型辅助')
  assert.equal(STR.zh.sectionTitle, '决策模型守门')
  assert.equal(STR.en.tabRules, 'Command rules')
  assert.equal(STR.en.tabAssist, 'Decision model assist')
  assert.equal(STR.zh.save, '保存')
})

test('两个新页签按钮与分派都在', () => {
  for (const id of ['tools', 'skills']) {
    assert.ok(SRC.includes(`tabButton('${id}'`), `缺少 tabButton('${id}')`)
    assert.ok(SRC.includes(`tab === '${id}'`), `缺少 tab === '${id}' 分派`)
  }
  assert.ok(SRC.includes("tabButton('tools', t('tabTools'))"), 'tools 页签应使用 tabTools 文案')
  assert.ok(SRC.includes("tabButton('skills', t('tabSelection'))"), 'skills 页签应使用 tabSelection 文案')
})

test('按契约调用 select 接口', () => {
  assert.ok(/api\('select'\)/.test(SRC), '缺少 GET api(\'select\')')
  assert.ok(/api\('select',\s*\{\s*method:\s*'POST'/.test(SRC), "缺少 POST api('select', { method: 'POST' ... })")
  assert.ok(/tools:\s*\{/.test(SRC), '保存 tools 时应构造 tools 子对象')
  assert.ok(/selection:\s*\{/.test(SRC), '保存 selection 时应构造 selection 子对象')
  assert.ok(/action:\s*'restore-all'/.test(SRC), "恢复全部应提交 action: 'restore-all'")
})

test('提交的字段名与接口契约一致', () => {
  const payloads = [
    ['tools.enabled', /enabled:\s*selectDraft\.toolsEnabled/],
    ['tools.whitelist', /whitelist:\s*splitList\(selectDraft\.whitelistText\)/],
    ['tools.minProbability', /minProbability:\s*clamp01\(selectDraft\.toolMinProbability/],
    ['selection.skillsEnabled', /skillsEnabled:\s*selectDraft\.skillsEnabled/],
    ['selection.skillLimit', /skillLimit:\s*intOr\(selectDraft\.skillLimit/],
    ['selection.skillMinProbability', /skillMinProbability:\s*clamp01\(selectDraft\.skillMinProbability/],
    ['selection.filesEnabled', /filesEnabled:\s*selectDraft\.filesEnabled/],
    ['selection.fileCandidates', /fileCandidates:\s*intOr\(selectDraft\.fileCandidates/],
  ]
  for (const [name, pattern] of payloads) {
    assert.ok(pattern.test(SRC), `${name} 的提交写法与契约不符`)
  }
})

test('两个新页签的控件都接到草稿字段', () => {
  for (const field of [
    'toolsEnabled',
    'whitelistText',
    'toolMinProbability',
    'skillsEnabled',
    'skillLimit',
    'skillMinProbability',
    'filesEnabled',
    'fileCandidates',
  ]) {
    assert.ok(SRC.includes(`selectDraft.${field}`), `缺少对 selectDraft.${field} 的读写`)
  }
})

test('加载失败时页签给出提示与重读按钮', () => {
  assert.ok(SRC.includes("t('selectUnavailable'"), '缺少不可用提示')
  assert.ok(SRC.includes("t('selectReload'"), '缺少重新读取按钮文案')
})

test('locale 两种语言都补齐了新键，且与 client 文案一致', () => {
  const locales = { zh: readLocale('zh'), en: readLocale('en') }
  for (const [lang, data] of Object.entries(locales)) {
    assert.ok(data.select !== undefined, `${lang}.json 缺少 select 段`)
    assert.deepEqual(Object.keys(data.select).sort(), [...NEW_KEYS].sort(), `${lang}.json 的 select 键集合不符`)
    for (const key of NEW_KEYS) {
      assert.equal(data.select[key], STR[lang][key], `${lang}.json 的 ${key} 与 client.js 不一致`)
    }
  }
})

test('locale 原有 meta 段没被覆盖', () => {
  const zh = readLocale('zh')
  const en = readLocale('en')
  assert.equal(zh.meta.title, '决策模型守门')
  assert.equal(en.meta.title, 'Decision Guard')
  assert.equal(typeof zh.meta.description, 'string')
  assert.equal(typeof en.meta.description, 'string')
})

test('白名单拆分：逗号 / 中文逗号 / 换行 / 去重 / 去空', () => {
  const { splitList } = readHelpers()
  assert.deepEqual(splitList(' read, write，edit\nread ,, '), ['read', 'write', 'edit'])
  assert.deepEqual(splitList(''), [])
  assert.deepEqual(splitList(undefined), [])
  assert.deepEqual(splitList(null), [])
})

test('概率夹取：非法回落、越界夹到 0-1', () => {
  const { clamp01 } = readHelpers()
  assert.equal(clamp01('0.7', 0.5), 0.7)
  assert.equal(clamp01('2', 0.5), 1)
  assert.equal(clamp01('-3', 0.5), 0)
  assert.equal(clamp01('abc', 0.5), 0.5)
  assert.equal(clamp01('', 0.5), 0.5)
})

test('整数夹取：非法回落、越界夹到区间', () => {
  const { intOr } = readHelpers()
  assert.equal(intOr('12', 8, 1, 200), 12)
  assert.equal(intOr('0', 8, 1, 200), 1)
  assert.equal(intOr('999', 8, 1, 200), 200)
  assert.equal(intOr('abc', 8, 1, 200), 8)
  assert.equal(intOr('8.9', 8, 1, 200), 8, '小数应向下取整而不是原样发出')
})

test('草稿字段都初始化过，没有拼错的引用', () => {
  const { selectDraftFrom } = readHelpers()
  const initialized = new Set(Object.keys(selectDraftFrom({})))
  assert.equal(initialized.size, 8, '草稿应有 8 个字段')

  const used = [...SRC.matchAll(/selectDraft\.(\w+)/g)].map((match) => match[1])
  assert.ok(used.length > 0, '没找到任何 selectDraft 字段引用')
  for (const field of used) {
    assert.ok(initialized.has(field), `selectDraft.${field} 不在 selectDraftFrom 的返回里`)
  }

  const patched = [...SRC.matchAll(/patchSelect\(\{\s*(\w+):/g)].map((match) => match[1])
  assert.ok(patched.length > 0, '没找到任何 patchSelect 字段')
  for (const field of patched) {
    assert.ok(initialized.has(field), `patchSelect({ ${field} }) 不在 selectDraftFrom 的返回里`)
  }
})

test('后端快照摊平：数组转文本、缺失走默认值', () => {
  const { selectDraftFrom } = readHelpers()
  const draft = selectDraftFrom({
    tools: { enabled: true, whitelist: ['read', 'bash'], minProbability: 0.7 },
    selection: { skillsEnabled: true, skillLimit: 12, skillMinProbability: 0.3, filesEnabled: true, fileCandidates: 60 },
  })
  assert.equal(draft.toolsEnabled, true)
  assert.equal(draft.whitelistText, 'read, bash')
  assert.equal(draft.toolMinProbability, '0.7')
  assert.equal(draft.skillsEnabled, true)
  assert.equal(draft.skillLimit, '12')
  assert.equal(draft.filesEnabled, true)
  assert.equal(draft.fileCandidates, '60')

  const empty = selectDraftFrom({})
  assert.equal(empty.toolsEnabled, false)
  assert.equal(empty.whitelistText, '')
  assert.equal(empty.toolMinProbability, '0.5')
  assert.equal(empty.skillLimit, '8')
  assert.equal(empty.fileCandidates, '40')
})

test('记录面板新键在两个语言里都存在且非空', () => {
  for (const key of RECORD_KEYS) {
    for (const lang of ['zh', 'en']) {
      const value = STR[lang][key]
      assert.equal(typeof value, 'string', `${lang}.${key} 必须是字符串`)
      assert.ok(value.trim() !== '', `${lang}.${key} 不能为空`)
    }
  }
})

test('记录面板新键与旧键不冲突', () => {
  const existing = new Set([...NEW_KEYS, 'tabTools', 'tabSelection'])
  for (const key of RECORD_KEYS) {
    assert.ok(!existing.has(key), `${key} 与按需加载页签的键重名`)
    assert.ok(key.startsWith('records'), `${key} 不在 records 前缀下`)
  }
})

test('locale 两种语言都补齐了 records 段，且与 client 文案一致', () => {
  for (const lang of ['zh', 'en']) {
    const data = readLocale(lang)
    assert.ok(data.records !== undefined, `${lang}.json 缺少 records 段`)
    assert.deepEqual(Object.keys(data.records).sort(), [...RECORD_KEYS].sort(), `${lang}.json 的 records 键集合不符`)
    for (const key of RECORD_KEYS) {
      assert.equal(data.records[key], STR[lang][key], `${lang}.json 的 ${key} 与 client.js 不一致`)
    }
  }
})

test('记录接口按契约调用：分类 + 分页 GET，按分类 DELETE', () => {
  assert.match(
    SRC,
    /records\?category=\$\{\w+\}&page=\$\{\w+\}&size=\$\{\w+\}/,
    'GET 记录应带上 category / page / size',
  )
  assert.match(SRC, /api\(`records\?category=\$\{\w+\}`, \{ method: 'DELETE' \}\)/, 'DELETE 记录应带上当前分类')
  assert.ok(!SRC.includes("api('log')"), '不应再调用旧的 log 路由')
})

test('分类切换与默认分类都在', () => {
  for (const category of ['command', 'tool', 'skill']) {
    assert.ok(SRC.includes(`id: '${category}'`), `缺少分类 ${category}`)
    assert.ok(SRC.includes(`recordsCategory${category[0].toUpperCase()}${category.slice(1)}`), `缺少分类文案键 ${category}`)
  }
  assert.ok(SRC.includes("React.useState('command')"), '默认分类应为敏感命令')
  assert.ok(SRC.includes('categoryButton(item.id'), '分类按钮应由分类表驱动')
})

test('分页：每页档位、计数文案、边界禁用', () => {
  assert.ok(SRC.includes('[10, 20, 50, 100]'), '每页档位应为 10/20/50/100')
  assert.ok(SRC.includes("t('recordsCount'"), '缺少「共 N 条 · 第 x/y 页」文案调用')
  assert.ok(SRC.includes('records.page <= 1'), '上一页应在第一页禁用')
  assert.ok(SRC.includes('records.page >= totalPages'), '下一页应在末页禁用')
})

test('单条复制：写剪贴板、成功与失败都有提示', () => {
  assert.ok(SRC.includes('navigator.clipboard.writeText'), '应调用 navigator.clipboard.writeText')
  assert.ok(SRC.includes('JSON.stringify(entry, null, 2)'), '复制的应是该条完整 JSON')
  assert.ok(SRC.includes("key: 'recordsCopied'"), '缺少复制成功提示')
  assert.ok(SRC.includes("key: 'recordsCopyFailed'"), '缺少复制失败提示')
  assert.ok(SRC.includes('t(recordStatus.key'), '状态文案应在渲染时翻译，避免留下旧语言的句子')
})

test('清空按当前分类，确认文案点明范围', () => {
  assert.ok(SRC.includes("t('recordsClear')"), '缺少清空按钮文案')
  assert.ok(SRC.includes("t('recordsClearConfirm'"), '缺少清空确认文案')
  assert.match(STR.zh.recordsClearConfirm, /当前分类/, '中文确认文案要点明只清当前分类')
  assert.match(STR.en.recordsClearConfirm, /category/, '英文确认文案要点明只清当前分类')
})

test('四个页签仍在，没有被动过', () => {
  for (const id of ['rules', 'assist', 'tools', 'skills']) {
    assert.ok(SRC.includes(`tabButton('${id}'`), `缺少页签 ${id}`)
  }
})

test('总页数：至少一页，按每页条数向上取整', () => {
  const { recordsPages } = readRecordsHelpers()
  assert.equal(recordsPages(0, 20), 1)
  assert.equal(recordsPages(1, 20), 1)
  assert.equal(recordsPages(20, 20), 1)
  assert.equal(recordsPages(21, 20), 2)
  assert.equal(recordsPages(100, 50), 2)
  assert.equal(recordsPages(5, 0), 1, '每页条数非法时不应出现 0 页')
})

test('记录摘要：命令 / 工具 / 技能三类都能出摘要', () => {
  const { entrySummary } = readRecordsHelpers()
  const labels = { hidden: 'hidden', kept: 'kept', saved: 'saved' }
  assert.equal(entrySummary({ tool: 'bash', rules: 'rm', reason: 'outside' }, labels), 'bash · rm · outside')
  assert.equal(entrySummary({ hidden: ['a', 'b'], kept: ['c'], savedTokens: 120 }, labels), 'hidden 2 · kept 1 · saved 120')
  assert.equal(entrySummary({ kept: ['x'] }, labels), 'kept 1')
  assert.equal(
    entrySummary({ verdict: 'trim', retained: ['a', 'b'], deferred: ['c'], total: 3 }, labels),
    'hidden 1 · kept 2',
    '技能选择记录的 deferred / retained 也要出摘要',
  )
  assert.equal(entrySummary({}, labels), '')
})

// 模块工厂与 apply 的执行检查：单独一段，验证定义期与注册期不会抛错。
try {
  let captured
  globalThis.window = { __ModuleLoader__: { load: (definition) => { captured = definition } } }
  await import(new URL('../client.js', import.meta.url).href)
  assert.ok(captured, '模块加载时应调用 window.__ModuleLoader__.load')

  const fakeReact = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
  }
  const plugin = captured.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require: ${name}`)
  })
  assert.equal(typeof plugin.apply, 'function', 'apply 应是函数')

  let registered
  plugin.apply({
    slots: {
      inject: (name, body) => {
        assert.equal(name, 'settings.section', '应注入设置区插槽')
        body()
      },
      register: (meta, component) => {
        registered = { meta, component }
        return { meta, component }
      },
    },
  })
  assert.ok(registered, 'apply 应注册设置页')
  assert.equal(typeof registered.component, 'function', '注册的应是组件函数')
  passed += 1
} catch (error) {
  failed += 1
  console.error('FAIL 模块工厂与 apply 可执行')
  console.error(error)
}

console.log(`panel-shape: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exitCode = 1
  console.error('panel-shape: 有失败用例')
}