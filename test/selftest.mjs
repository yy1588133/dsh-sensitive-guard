/**
 * 本地自测：不连网、不装插件，直接跑规则匹配与判定解析的纯逻辑。
 * 用法：node test/selftest.mjs
 */

import assert from 'node:assert/strict'
import { PRESET_SENSITIVE_COMMANDS, PRESET_DESCRIPTION_ZH, describeRule, matchRules } from '../lib/rules.js'
import { normalizeSettings, DEFAULT_SETTINGS } from '../lib/store.js'

let passed = 0
/** @param {string} name 用例名 @param {() => void} body 断言体 */
function test(name, body) {
  try {
    body()
    passed += 1
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  }
}

// ── 规则移植完整性与顺序 ─────────────────────────────────────────────
test('规则条数与 snow-app 一致（43 条）', () => {
  assert.equal(PRESET_SENSITIVE_COMMANDS.length, 43)
})

test('规则 id 不重复', () => {
  const ids = PRESET_SENSITIVE_COMMANDS.map((rule) => rule.commandId)
  assert.equal(new Set(ids).size, ids.length)
})

test('内置规则全部能编译', () => {
  for (const rule of PRESET_SENSITIVE_COMMANDS) {
    assert.doesNotThrow(() => new RegExp(rule.pattern, 'i'), `${rule.commandId} 的正则编译失败`)
  }
})

const enabled = () => PRESET_SENSITIVE_COMMANDS.filter((rule) => rule.enabled)

/** @param {string} text 命令文本 */
const hits = (text) => matchRules(text, enabled()).matches.map((rule) => rule.commandId)

// ── 命中：默认启用的危险命令 ─────────────────────────────────────────
test('rm -rf 命中', () => assert.deepEqual(hits('rm -rf build'), ['rm']))
test('sudo rm 命中 rm', () => assert.ok(hits('sudo rm -rf /').includes('rm')))
test('rmdir 命中', () => assert.deepEqual(hits('rmdir old'), ['rmdir']))
test('PowerShell 递归删除命中', () => assert.ok(hits('Remove-Item -Recurse -Force ./dist').includes('powershell-remove-item')))
test('cmd del 命中', () => assert.ok(hits('del /f a.txt').includes('cmd-del')))
test('cmd rd 命中', () => assert.ok(hits('rd /s /q old').includes('cmd-rd')))
test('force push 命中', () => assert.ok(hits('git push origin main --force').includes('git-force-push')))
test('git reset --hard 命中', () => assert.ok(hits('git reset --hard HEAD~3').includes('git-reset-hard')))
test('git clean -f 命中', () => assert.ok(hits('git clean -fd').includes('git-clean')))
test('DROP TABLE 命中', () => assert.ok(hits('psql -c "DROP TABLE users"').includes('sql-drop-table')))
test('dd 命中', () => assert.ok(hits('dd if=/dev/zero of=/dev/sda').includes('dd')))
test('mkfs 命中', () => assert.ok(hits('mkfs.ext4 /dev/sdb1').includes('mkfs')))
test('npm publish 命中', () => assert.ok(hits('npm publish --access public').includes('npm-publish')))
test('大小写不敏感（DROP TABLE 小写也命中）', () => assert.ok(hits('drop table users').includes('sql-drop-table')))
test('Format-Volume 命中', () => assert.ok(hits('Format-Volume -DriveLetter D').includes('format-volume')))

// ── 不命中：词边界与安全命令 ─────────────────────────────────────────
test('arm64 不误伤 rm', () => assert.deepEqual(hits('npm install arm64-pkg'), []))
test('warm 不误伤 rm', () => assert.deepEqual(hits('echo warm up'), []))
test('--format 不误伤 rm', () => assert.deepEqual(hits('prettier --format json'), []))
test('git add 不误伤 dd', () => assert.deepEqual(hits('git add .'), []))
test('address 不误伤 dd', () => assert.deepEqual(hits('echo address'), []))
test('cancel 不误伤 cmd-del', () => assert.deepEqual(hits('echo cancel'), []))
test('model 不误伤 rd', () => assert.deepEqual(hits('echo model'), []))
test('普通 ls 不命中', () => assert.deepEqual(hits('ls -la'), []))
test('npm install 不命中', () => assert.deepEqual(hits('npm install'), []))
test('git commit 不命中', () => assert.deepEqual(hits('git commit -m "fix"'), []))

// ── 停用的规则不参与匹配 ─────────────────────────────────────────────
test('停用规则不出现在结果里', () => {
  // 只给 rm 一条规则：rm 命中，chmod 不在表里所以不命中。
  const onlyRm = PRESET_SENSITIVE_COMMANDS.filter((rule) => rule.commandId === 'rm')
  assert.deepEqual(matchRules('rm -rf x', onlyRm).matches.map((rule) => rule.commandId), ['rm'])
  assert.deepEqual(matchRules('chmod 777 x', onlyRm).matches, [])
  // chmod 出厂就是停用的：全表匹配也不应该命中它。
  assert.ok(!hits('chmod 777 x').includes('chmod'))
})

// ── 坏正则必须报失败，不能静默放行 ───────────────────────────────────
test('坏正则返回 failed', () => {
  const result = matchRules('anything', [{ commandId: 'bad', pattern: '([', description: '' }])
  assert.equal(result.matches.length, 0)
  assert.ok(typeof result.failed === 'string' && result.failed.includes('bad'))
})

// ── 设置规整 ────────────────────────────────────────────────────────
test('设置缺省回落默认值', () => {
  const settings = normalizeSettings({})
  assert.equal(settings.enabled, DEFAULT_SETTINGS.enabled)
  assert.equal(settings.endpoint, DEFAULT_SETTINGS.endpoint)
  assert.equal(settings.contextMessageCount, 8)
})

test('会话条数被钳到 1-50', () => {
  assert.equal(normalizeSettings({ contextMessageCount: 0 }).contextMessageCount, 1)
  assert.equal(normalizeSettings({ contextMessageCount: 999 }).contextMessageCount, 50)
  assert.equal(normalizeSettings({ contextMessageCount: 'abc' }).contextMessageCount, 8)
})

test('非法 onUnavailable 回落 follow-sandbox', () => {
  assert.equal(normalizeSettings({ onUnavailable: 'yolo' }).onUnavailable, 'follow-sandbox')
  assert.equal(normalizeSettings({ onUnavailable: 'deny' }).onUnavailable, 'deny')
  assert.equal(normalizeSettings({ onUnavailable: 'allow' }).onUnavailable, 'allow')
})

test('工具清单默认是空数组（= 检查所有命令类工具）', () => {
  assert.deepEqual(normalizeSettings({}).commandTools, [])
  assert.deepEqual(DEFAULT_SETTINGS.commandTools, [])
})

test('工具名去重去空', () => {
  const settings = normalizeSettings({ commandTools: ['bash', ' bash ', '', 'ops_bash'] })
  assert.deepEqual(settings.commandTools, ['bash', 'ops_bash'])
})

// ── 中文规则说明 ────────────────────────────────────────────────────
test('内置规则都有中文说明', () => {
  for (const rule of PRESET_SENSITIVE_COMMANDS) {
    assert.ok(
      typeof PRESET_DESCRIPTION_ZH[rule.commandId] === 'string' && PRESET_DESCRIPTION_ZH[rule.commandId] !== '',
      `${rule.commandId} 缺少中文说明`,
    )
  }
})

test('中文说明表没有多余的 key', () => {
  const ids = new Set(PRESET_SENSITIVE_COMMANDS.map((rule) => rule.commandId))
  for (const key of Object.keys(PRESET_DESCRIPTION_ZH)) {
    assert.ok(ids.has(key), `多出来的中文说明: ${key}`)
  }
})

test('describeRule 对内置规则返回中文，对自定义规则返回原文', () => {
  assert.equal(describeRule({ commandId: 'rm', description: 'Delete files', isPreset: true }), PRESET_DESCRIPTION_ZH['rm'])
  assert.equal(describeRule({ commandId: 'mine', description: '自定义的', isPreset: false }), '自定义的')
})

console.log(process.exitCode === 1 ? `\n有失败用例（通过 ${passed}）` : `全部 ${passed} 个用例通过`)
