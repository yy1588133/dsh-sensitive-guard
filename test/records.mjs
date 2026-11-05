/**
 * 判定记录存储自测：不连宿主，用临时目录验证
 * - add / list 分页与条数白名单
 * - clear 分类与全清
 * - 落盘后新实例能读回（重启不丢）
 * - 文件损坏时备份原文件再重建
 *
 * 用法：node test/records.mjs
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRecordStore } from '../lib/records.js'

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

const tempDir = () => mkdtempSync(join(tmpdir(), 'dsh-decision-guard-records-'))

test('add 后按分类分页读取，最新的在前', () => {
  const dir = tempDir()
  const store = createRecordStore({ dir })
  for (let index = 0; index < 25; index += 1) {
    store.add('command', { tool: 'bash', command: `cmd-${index}` })
  }
  store.add('tool', { verdict: 'hide', hidden: ['a'] })
  store.flush()

  const first = store.list('command', 1, 10)
  assert.equal(first.total, 25)
  assert.equal(first.items.length, 10)
  assert.equal(first.page, 1)
  assert.equal(first.size, 10)
  assert.equal(first.items[0].command, 'cmd-24')

  const third = store.list('command', 3, 10)
  assert.equal(third.items.length, 5)
  assert.equal(third.items[0].command, 'cmd-4')

  // 非法 size 回落 20；越界页返回空数组而不是报错
  assert.equal(store.list('command', 1, 7).size, 20)
  assert.deepEqual(store.list('command', 99, 20).items, [])

  assert.equal(store.list('tool').total, 1)
  assert.equal(store.list('skill').total, 0)
})

test('clear 只清当前分类；不带参数清全部', () => {
  const dir = tempDir()
  const store = createRecordStore({ dir })
  store.add('command', { tool: 'bash' })
  store.add('tool', { verdict: 'hide' })
  store.add('skill', { verdict: 'trim' })

  store.clear('command')
  assert.equal(store.list('command').total, 0)
  assert.equal(store.list('tool').total, 1)

  store.clear()
  assert.equal(store.list('tool').total, 0)
  assert.equal(store.list('skill').total, 0)
})

test('落盘后新实例能读回（重启不丢）', () => {
  const dir = tempDir()
  const first = createRecordStore({ dir })
  first.add('command', { tool: 'bash', verdict: 'deny', command: 'rm -rf /' })
  first.add('skill', { verdict: 'trim', retained: ['alpha'] })
  first.flush()
  assert.ok(existsSync(join(dir, 'records.json')))

  const second = createRecordStore({ dir })
  assert.equal(second.list('command').total, 1)
  assert.equal(second.list('command').items[0].verdict, 'deny')
  assert.equal(second.list('skill').total, 1)
  assert.equal(second.list('skill').items[0].retained[0], 'alpha')
})

test('文件损坏时先备份再重建，不覆盖原始内容', () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'records.json'), '{ not json', 'utf8')
  const store = createRecordStore({ dir })
  assert.equal(store.list('command').total, 0)

  store.add('command', { tool: 'bash' })
  store.flush()

  const backups = readdirSync(dir).filter((name) => name.startsWith('records.json.corrupt-'))
  assert.equal(backups.length, 1)
  assert.equal(store.list('command').total, 1)
})

test('每类超过上限时丢弃最旧的', () => {
  const dir = tempDir()
  const store = createRecordStore({ dir })
  for (let index = 0; index < 520; index += 1) {
    store.add('command', { tool: 'bash', index })
  }
  assert.equal(store.list('command').total, 500)
  assert.equal(store.list('command', 1, 20).items[0].index, 519)
})

console.log(`records: ${passed} passed`)