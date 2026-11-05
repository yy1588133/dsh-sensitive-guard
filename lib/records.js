/**
 * 判定记录的持久化存储。
 *
 * 三类记录分开存：敏感命令（command）、工具选择（tool）、技能选择（skill）。
 * 每条记录带 `at` 时间戳，最新的在前。落盘是合并写入（200ms 防抖），
 * 写失败只记日志，不影响判定主流程。
 *
 * 文件损坏时先备份成 `.corrupt-<时间戳>` 再重建，绝不静默覆盖用户数据。
 *
 * @module dsh-decision-guard/records
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 支持的分类。 */
export const CATEGORIES = Object.freeze(['command', 'tool', 'skill'])

/** 每类保留的最大条数。 */
const CAPACITY = 500

/** 合并写入的防抖间隔。 */
const WRITE_DELAY_MS = 200

/** 分页允许的每页条数。 */
export const PAGE_SIZES = Object.freeze([10, 20, 50, 100])

/**
 * 一条记录至少要有可读的时间戳。
 * @param {unknown} entry 任意值
 * @returns {boolean} 是否合法
 */
function isEntry(entry) {
  return entry !== null && typeof entry === 'object' && typeof entry.at === 'string'
}

/**
 * 造一个记录存储。
 * @param {object} options 依赖
 * @param {string} options.dir 数据目录
 * @param {{ warn?: (message: string) => void }} [options.logger] 日志
 * @returns {{ add: Function, list: Function, clear: Function, flush: Function, writeError: () => string | undefined }} 存储
 */
export function createRecordStore({ dir, logger }) {
  const file = join(dir, 'records.json')
  /** @type {{ command: any[], tool: any[], skill: any[] }} */
  let data = empty()
  let corrupt = false
  /** @type {NodeJS.Timeout | undefined} */
  let timer
  let writeError

  /** @returns {{ command: any[], tool: any[], skill: any[] }} 空表 */
  function empty() {
    return { command: [], tool: [], skill: [] }
  }

  // 首读：文件不存在就是空表；损坏则标记，首次落盘前先备份原文件。
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    for (const category of CATEGORIES) {
      const list = raw?.[category]
      data[category] = Array.isArray(list) ? list.filter(isEntry).slice(0, CAPACITY) : []
    }
  } catch {
    corrupt = existsSync(file)
    if (corrupt) logger?.warn?.(`判定记录文件损坏，已备份后重建：${file}`)
  }

  /** 立即落盘（原子替换）。 */
  function flush() {
    try {
      mkdirSync(dir, { recursive: true })
      if (corrupt) {
        renameSync(file, `${file}.corrupt-${Date.now()}`)
        corrupt = false
      }
      const temp = `${file}.${process.pid}.tmp`
      writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8')
      renameSync(temp, file)
      writeError = undefined
    } catch (error) {
      writeError = error instanceof Error ? error.message : String(error)
      logger?.warn?.(`判定记录落盘失败：${writeError}`)
    }
  }

  /** 合并写入：200ms 内的多次 add 只落一次盘。 */
  function scheduleWrite() {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      flush()
    }, WRITE_DELAY_MS)
    timer.unref?.()
  }

  return {
    /**
     * 追加一条记录（最新的在前）。
     * @param {'command'|'tool'|'skill'} category 分类
     * @param {object} entry 记录内容
     */
    add(category, entry) {
      if (!CATEGORIES.includes(category)) return
      const list = data[category]
      list.unshift({ at: new Date().toISOString(), ...entry })
      if (list.length > CAPACITY) list.length = CAPACITY
      scheduleWrite()
    },

    /**
     * 分页读取。
     * @param {'command'|'tool'|'skill'} category 分类
     * @param {number} [page] 页码，从 1 开始
     * @param {number} [size] 每页条数，只接受 10/20/50/100
     * @returns {{ items: any[], total: number, page: number, size: number }} 一页
     */
    list(category, page = 1, size = 20) {
      const items = data[category] ?? []
      const pageSize = PAGE_SIZES.includes(size) ? size : 20
      const pageNumber = Number.isInteger(page) && page > 0 ? page : 1
      const start = (pageNumber - 1) * pageSize
      return {
        items: items.slice(start, start + pageSize),
        total: items.length,
        page: pageNumber,
        size: pageSize,
      }
    },

    /**
     * 清空一个分类；不带参数清空全部。
     * @param {'command'|'tool'|'skill'} [category] 分类
     */
    clear(category) {
      if (CATEGORIES.includes(category)) data[category] = []
      else if (category === undefined) data = empty()
      flush()
    },

    /** 立即落盘（卸载前调用）。 */
    flush,

    /** @returns {string | undefined} 最近一次落盘失败的原因 */
    writeError: () => writeError,
  }
}