/**
 * 会话状态存储自测：不连宿主，用临时目录验证
 * - tool / skill 结果读写与落盘
 * - 重启（新实例）能读回
 * - 会话数超限按最近使用淘汰
 * - 文件损坏先备份再重建
 * - isFirstUserTurn 按会话事件判断首轮
 *
 * 用法：node test/session-state.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionState, isFirstUserTurn } from '../lib/session-state.js'

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

const tempDir = () => mkdtempSync(join(tmpdir(), 'dsh-decision-guard-state-'))

test('工具与技能结果分别读写', () => {
  const state = createSessionState({ dir: tempDir() })
  state.setTool('s1', { hidden: ['a', 'b'] })
  state.setSkill('s1', { fingerprint: 'fp', retained: [{ name: 'alpha', description: '' }], deferred: [] })

  assert.deepEqual(state.getTool('s1'), { hidden: ['a', 'b'] })
  assert.equal(state.getSkill('s1').fingerprint, 'fp')
  assert.equal(state.getTool('missing'), undefined)
})

test('落盘后新实例能读回（重启恢复）', () => {
  const dir = tempDir()
  const first = createSessionState({ dir })
  first.setTool('s1', { hidden: ['x'] })
  first.setSkill('s1', { fingerprint: 'fp', retained: [], deferred: [] })
  first.flush()
  assert.ok(existsSync(join(dir, 'sessions.json')))

  const second = createSessionState({ dir })
  assert.deepEqual(second.getTool('s1'), { hidden: ['x'] })
  assert.equal(second.getSkill('s1').fingerprint, 'fp')
})

test('会话数超限按最近使用淘汰', () => {
  const state = createSessionState({ dir: tempDir() })
  for (let index = 0; index < 60; index += 1) {
    state.setTool(`s${index}`, { hidden: [] })
  }
  assert.ok(state.getTool('s59'))
  assert.equal(state.getTool('s0'), undefined)
})

test('文件损坏先备份再重建', () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'sessions.json'), '[]', 'utf8')
  const state = createSessionState({ dir })
  state.setTool('s1', { hidden: [] })
  state.flush()

  const backups = readdirSync(dir).filter((name) => name.startsWith('sessions.json.corrupt-'))
  assert.equal(backups.length, 1)
  assert.deepEqual(state.getTool('s1'), { hidden: [] })
})

test('isFirstUserTurn：无会话按首轮；一条用户消息算首轮；两条不算', () => {
  assert.equal(isFirstUserTurn({}), true)
  assert.equal(isFirstUserTurn({ session: { snapshotEvents: () => [] } }), true)
  const one = { session: { snapshotEvents: () => [{ type: 'user/message' }] } }
  const two = { session: { snapshotEvents: () => [{ type: 'user/message' }, { type: 'user/message' }] } }
  assert.equal(isFirstUserTurn(one), true)
  assert.equal(isFirstUserTurn(two), false)
})

console.log(`session-state: ${passed} passed`)