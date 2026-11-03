/**
 * 「参与检查的工具」语义测试：清单留空 = 检查所有命令类工具，且不能误伤写文件。
 *
 * 直接 import Host 侧导出的判定函数会拉起整份插件，所以这里用一份等价实现
 * 交叉校验：把 index.js 里的 shouldInspect / commandTextOf 逻辑抄成期望表，
 * 再用真实的字段表验证行为一致。字段表来自 lib/store.js，是唯一真相。
 *
 * 用法：node test/tool-scope.mjs
 */

import assert from 'node:assert/strict'
import { COMMAND_FIELD_NAMES } from '../lib/store.js'

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

/** 与 index.js 的 shouldInspect 等价。 */
function shouldInspect(toolName, args, allowlist) {
  if (allowlist.length > 0) return allowlist.includes(toolName)
  if (args === null || typeof args !== 'object') return false
  return COMMAND_FIELD_NAMES.some((field) => typeof args[field] === 'string')
}

/** 与 index.js 的 commandTextOf 等价。 */
function commandTextOf(toolName, args) {
  if (args === null || typeof args !== 'object') return ''
  const text = (key) => (typeof args[key] === 'string' ? args[key] : '')
  if (toolName === 'terminal_send') return text('text')
  if (['ssh_workspace_shell', 'ssh_workspace_exec', 'bash', 'pwsh', 'shell', 'ops_bash'].includes(toolName)) {
    return [text('command'), text('script_path'), text('workdir')].filter((part) => part !== '').join(' ')
  }
  const parts = []
  for (const field of COMMAND_FIELD_NAMES) {
    const value = args[field]
    if (typeof value === 'string' && value !== '') parts.push(value)
  }
  return parts.join(' ')
}

const EMPTY = []

// ── 清单留空时 ──────────────────────────────────────────────────────
test('空清单：ops_bash 被检查', () => {
  assert.equal(shouldInspect('ops_bash', { command: 'ls', description: 'list' }, EMPTY), true)
})

test('空清单：bash 被检查', () => {
  assert.equal(shouldInspect('bash', { command: 'ls' }, EMPTY), true)
})

test('空清单：terminal_send 被检查', () => {
  assert.equal(shouldInspect('terminal_send', { text: 'ls\n' }, EMPTY), true)
})

test('空清单：write 不被检查（参数里没有命令字段）', () => {
  assert.equal(shouldInspect('write', { file_path: 'a.md', content: 'rm -rf /' }, EMPTY), false)
})

test('空清单：edit 不被检查', () => {
  assert.equal(shouldInspect('edit', { file_path: 'a.md', old_string: 'x', new_string: 'rm -rf /' }, EMPTY), false)
})

test('空清单：read 不被检查', () => {
  assert.equal(shouldInspect('read', { file_path: 'a.md' }, EMPTY), false)
})

test('空清单：grep 不被检查', () => {
  assert.equal(shouldInspect('grep', { pattern: 'rm -rf' }, EMPTY), false)
})

test('空清单：无关对象参数不被检查', () => {
  assert.equal(shouldInspect('whatever', {}, EMPTY), false)
  assert.equal(shouldInspect('whatever', null, EMPTY), false)
})

// ── 清单非空时 ──────────────────────────────────────────────────────
test('非空清单：只检查列出的工具', () => {
  const list = ['bash']
  assert.equal(shouldInspect('bash', { command: 'ls' }, list), true)
  assert.equal(shouldInspect('ops_bash', { command: 'ls' }, list), false)
})

test('非空清单：即使参数里有命令字段也不越界', () => {
  assert.equal(shouldInspect('terminal_send', { text: 'ls' }, ['bash']), false)
})

// ── 文本提取 ────────────────────────────────────────────────────────
test('ops_bash 只取 command / script_path / workdir', () => {
  const text = commandTextOf('ops_bash', {
    command: 'ls -la',
    description: '列出文件',
    script_path: 'run.sh',
    workdir: 'sub',
  })
  assert.equal(text, 'ls -la run.sh sub')
  // description 是给人看的说明，不进匹配
  assert.ok(!text.includes('列出文件'))
})

test('terminal_send 取 text', () => {
  assert.equal(commandTextOf('terminal_send', { text: 'git reset --hard' }), 'git reset --hard')
})

test('未知工具只拼命令字段，不碰正文', () => {
  const text = commandTextOf('custom_exec', { command: 'rm -rf x', content: '正文里提到 rm -rf y' })
  assert.equal(text, 'rm -rf x')
})

test('write 的 content 不进命令文本', () => {
  const text = commandTextOf('write', { file_path: 'a.md', content: 'rm -rf /' })
  assert.equal(text, '')
})

console.log(process.exitCode === 1 ? `\n有失败用例（通过 ${passed}）` : `全部 ${passed} 个工具范围用例通过`)
