/**
 * 会话级评估结果的持久化。
 *
 * 工具选择与技能选择的结果按 sessionId 落盘：重启后遇到同一个会话，
 * 直接恢复上次的隐藏集/保留集，不再问一次决策模型。
 *
 * 只保存「已经生效」的结果：
 * - tool: { hidden: string[] }   真正被 restrict 掉的工具名
 * - skill: { fingerprint, retained, deferred }   技能集合指纹与两池内容
 *
 * 容量按会话数（最近 50 个）淘汰；写盘合并 400ms，损坏时备份重来。
 *
 * @module dsh-decision-guard/session-state
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 保留的会话数上限。 */
const MAX_SESSIONS = 50

/** 合并写入的防抖间隔。 */
const WRITE_DELAY_MS = 400

/**
 * 会话里是否只有一条用户消息（首次发言）。
 * 重启后内存状态清空，用它判断「是不是首轮」，避免把第 N 轮当成首轮重评估。
 * @param {any} agent agent
 * @returns {boolean} 是否首轮
 */
export function isFirstUserTurn(agent) {
  const events = agent?.session?.snapshotEvents?.()
  if (!Array.isArray(events)) return true
  let count = 0
  for (const event of events) {
    if (event?.type === 'user/message') count += 1
  }
  return count <= 1
}

/**
 * 造一个会话状态存储。
 * @param {object} options 依赖
 * @param {string} options.dir 数据目录
 * @param {{ warn?: (message: string) => void }} [options.logger] 日志
 * @returns {{ getTool: Function, setTool: Function, getSkill: Function, setSkill: Function, flush: Function, writeError: Function }} 存储
 */
export function createSessionState({ dir, logger }) {
  const file = join(dir, 'sessions.json')
  /** @type {Record<string, { tool?: object, skill?: object, at?: string }>} */
  let sessions = {}
  let corrupt = false
  /** @type {NodeJS.Timeout | undefined} */
  let timer
  let writeError

  // 首读：文件不存在就是空表；损坏则标记，首次落盘前先备份。
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('sessions.json 不是对象')
    const list = raw.sessions !== null && typeof raw.sessions === 'object' ? raw.sessions : {}
    for (const [id, value] of Object.entries(list)) {
      if (value !== null && typeof value === 'object') sessions[id] = value
    }
  } catch {
    corrupt = existsSync(file)
    if (corrupt) logger?.warn?.(`会话状态文件损坏，已备份后重建：${file}`)
  }

  /** 立即落盘（原子替换）。 */
  function flush() {
    try {
      mkdirSync(dir, { recursive: true })
      if (corrupt) {
        try {
          renameSync(file, `${file}.corrupt-${Date.now()}`)
        } catch (error) {
          // 原文件已经被删掉：没有东西可备份，直接重建。
          if (error?.code !== 'ENOENT') throw error
        }
        corrupt = false
      }
      const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
      writeFileSync(temp, JSON.stringify({ sessions }, null, 2), 'utf8')
      renameSync(temp, file)
      writeError = undefined
    } catch (error) {
      writeError = error instanceof Error ? error.message : String(error)
      logger?.warn?.(`会话状态落盘失败：${writeError}`)
    }
  }

  /** 合并写入。 */
  function scheduleWrite() {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      flush()
    }, WRITE_DELAY_MS)
    timer.unref()
  }

  /** 按最近使用时间淘汰超出的会话。 */
  function evict() {
    const ids = Object.keys(sessions)
    if (ids.length <= MAX_SESSIONS) return
    ids.sort((left, right) => String(sessions[left]?.at ?? '').localeCompare(String(sessions[right]?.at ?? '')))
    for (const id of ids.slice(0, ids.length - MAX_SESSIONS)) delete sessions[id]
  }

  /** 标记会话最近使用并安排写盘。 @param {string} id 会话 id */
  function touch(id) {
    sessions[id] = { ...sessions[id], at: new Date().toISOString() }
    evict()
    scheduleWrite()
  }

  return {
    /** @param {string} id 会话 id @returns {{ hidden?: string[] } | undefined} 工具选择结果 */
    getTool(id) {
      return sessions[id]?.tool
    },
    /**
     * @param {string} id 会话 id
     * @param {{ hidden: string[] }} value 结果
     */
    setTool(id, value) {
      sessions[id] = { ...sessions[id], tool: value }
      touch(id)
    },
    /** @param {string} id 会话 id @returns {{ fingerprint?: string, retained?: any[], deferred?: any[] } | undefined} 技能选择结果 */
    getSkill(id) {
      return sessions[id]?.skill
    },
    /**
     * @param {string} id 会话 id
     * @param {{ fingerprint: string, retained: any[], deferred: any[] }} value 结果
     */
    setSkill(id, value) {
      sessions[id] = { ...sessions[id], skill: value }
      touch(id)
    },
    flush,
    /** @returns {string | undefined} 最近一次落盘失败的原因 */
    writeError: () => writeError,
  }
}