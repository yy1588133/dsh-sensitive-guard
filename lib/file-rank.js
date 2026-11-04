/**
 * glob 结果按相关性排序。
 *
 * 宿主把 glob 当搜索工具用，`value.paths` 的顺序是文件系统给的。候选一多，模型
 * 得自己从一屏幕路径里挑，容易先看前几条就下判断。这里在结果返回后问一次决策
 * 模型「每条路径与当前任务的相关性」，把概率高的排前面，再用文本重述一遍。
 *
 * 关键取舍：
 * - **只改模型可见文本，不改结构化结果**。`value` 原样返回，路径一条不丢：
 *   排序只是呈现顺序，任何下游依赖 `value.paths` 的逻辑都不受影响。
 * - **候选太多就不排**。超过 `fileCandidates`（默认 40）时排序的意义下降，反而
 *   把一次工具调用拖成一次长请求，直接原样返回。
 * - **判不清就原样返回**。judge 不可用、答案缺失、请求抛错——一律退回原始结果，
 *   绝不让一条路径因为排序失败而消失。
 * - **一次调用只问一次**。每条路径一个 noul 题、装进同一个请求，网络往返只有一次。
 *
 * @module dsh-sensitive-guard/file-rank
 */

/** 参与排序的候选上限默认值。 */
const DEFAULT_FILE_CANDIDATES = 40

/** 待配对排序结果的上限：正常情况下 post-execute 会立刻取走，这里只兜底泄漏。 */
const MAX_PENDING = 32

/**
 * 从结果里取出 glob 的结构化值。
 * @param {any} result 工具结果
 * @returns {{ root: string; paths: string[] } | undefined} 合法值，否则 undefined
 */
function globValueOf(result) {
  const value = result?.value
  if (value === null || typeof value !== 'object') return undefined
  const root = value.root
  const paths = value.paths
  if (typeof root !== 'string' || !Array.isArray(paths)) return undefined
  if (!paths.every((path) => typeof path === 'string')) return undefined
  return { root, paths }
}

/**
 * 把 glob 的 pattern 参数拍成一段文本：可能是字符串，也可能是 glob 数组。
 * @param {unknown} pattern 调用参数里的 pattern
 * @returns {string} 可读的模式
 */
function patternOf(pattern) {
  if (typeof pattern === 'string') return pattern
  if (!Array.isArray(pattern)) return ''
  return pattern.filter((item) => typeof item === 'string').join(', ')
}

/**
 * 一条路径一个 noul 题：问它是不是用户要找的目标。
 * @param {string} pattern glob 模式
 * @param {string} path 候选路径
 * @returns {Record<string, unknown>} 题目
 */
function questionFor(pattern, path) {
  return {
    type: 'noul',
    instructions:
      `判断这条文件路径与当前任务的相关性，给出它正是用户要找的目标的概率。` +
      `glob 模式：${pattern === '' ? '（未提供）' : pattern}；候选路径：${path}。`,
    criteria: {
      true: '这条路径很可能就是用户要找的文件',
      false: '这条路径与当前任务无关',
    },
  }
}

/**
 * 把答案对回路径，按概率降序。
 *
 * 任何一条缺答案就整体放弃——只排一半的结果没有意义，还可能把模型引到「这
 * 就是全部」的错误印象上。同分保持原顺序（Array#sort 在 V8 上是稳定排序）。
 * @param {string[]} paths 候选路径
 * @param {Record<string, any>} answers judge 的答案
 * @returns {Array<{ path: string; probability: number }> | undefined} 排序结果
 */
function rankByProbability(paths, answers) {
  /** @type {Array<{ path: string; probability: number }>} */
  const scored = []
  for (const [index, path] of paths.entries()) {
    const answer = answers?.[`path-${index}`]
    if (answer?.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul)) return undefined
    scored.push({ path, probability: Math.min(1, Math.max(0, answer.noul)) })
  }
  return scored.sort((left, right) => right.probability - left.probability)
}

/**
 * 生成模型可见的文本：概率 + 路径逐行，结尾说明完整结果的位置。
 * @param {Array<{ path: string; probability: number }>} ranked 排序结果
 * @returns {string} 文本
 */
function summaryText(ranked) {
  const lines = ranked.map(({ path, probability }) => `${Math.round(probability * 100)}%  ${path}`)
  lines.push('', `共 ${ranked.length} 条，按相关性排序；完整结果仍在 value.paths`)
  return lines.join('\n')
}

/**
 * 创建 glob 排序器。
 * @param {object} options 依赖
 * @param {{ on: (name: string, handler: Function) => unknown }} options.ctx 插件上下文
 * @param {{ judge: Function }} options.client 决策客户端
 * @param {() => any} options.getSettings 读取当前设置
 * @param {{ warn?: (message: string) => void }} [options.logger] 日志
 */
export function createFileRanker({ ctx, client, getSettings, logger = {} }) {
  /** @type {Map<unknown, Array<{ path: string; probability: number }>>} token → 排序结果 */
  const pending = new Map()

  /** 读设置；读坏了按空设置处理，功能退回默认值而不是抛错。 */
  const settingsOf = () => {
    try {
      const value = getSettings?.()
      return value !== null && typeof value === 'object' ? value : {}
    } catch {
      return {}
    }
  }

  /** @param {any} settings 设置 @returns {number} 候选上限 */
  const candidateCap = (settings) => {
    const value = Number(settings?.fileCandidates)
    return Number.isSafeInteger(value) && value >= 1 ? value : DEFAULT_FILE_CANDIDATES
  }

  /** 日志失败不影响排序。 @param {string} message 说明 */
  const warn = (message) => {
    try {
      logger?.warn?.(message)
    } catch {
      /* 日志本身不重要 */
    }
  }

  /**
   * 问一次模型：每条路径一题，装进同一个请求。
   * @param {string} pattern glob 模式
   * @param {string} pathArg 调用的 path 参数
   * @param {string} root 结果根目录
   * @param {string[]} paths 候选路径
   * @param {AbortSignal | undefined} signal 取消信号
   * @returns {Promise<Array<{ path: string; probability: number }> | undefined>} 排序结果
   */
  const askModel = async (pattern, pathArg, root, paths, signal) => {
    if (typeof client?.judge !== 'function') return undefined
    /** @type {Record<string, unknown>} */
    const questions = {}
    for (const [index, path] of paths.entries()) questions[`path-${index}`] = questionFor(pattern, path)
    const outcome = await client.judge({
      state: { tool: 'glob', pattern, path: pathArg, root },
      questions,
      signal,
    })
    if (outcome?.ok !== true) return undefined
    return rankByProbability(paths, outcome.answers)
  }

  /**
   * 执行钩子：真实结果出来后再排序，结果本身原样往下传。
   * @param {any} exec 工具调用
   * @param {() => Promise<any>} next 继续执行
   * @returns {Promise<any>} 工具结果
   */
  async function onExecute(exec, next) {
    if (exec?.name !== 'glob') return next()
    const settings = settingsOf()
    if (settings.filesEnabled === false) return next()
    const result = await next()
    try {
      if (result?.isError === true) return result
      const value = globValueOf(result)
      if (value === undefined || value.paths.length === 0) return result
      if (value.paths.length > candidateCap(settings)) return result
      const args = exec.arguments ?? {}
      const pattern = patternOf(args.pattern)
      const pathArg = typeof args.path === 'string' ? args.path : '.'
      const ranked = await askModel(pattern, pathArg, value.root, value.paths, exec.signal)
      if (ranked !== undefined) {
        // 同一个 token 重新执行时以最后一次为准；Map 保持插入序，超限从最旧开始丢。
        pending.delete(exec.token)
        pending.set(exec.token, ranked)
        while (pending.size > MAX_PENDING) {
          const oldest = pending.keys().next()
          if (oldest.done === true) break
          pending.delete(oldest.value)
        }
      }
    } catch (error) {
      warn(`dsh-sensitive-guard: glob 结果排序失败，保持原顺序（${error instanceof Error ? error.message : String(error)}）`)
    }
    return result
  }

  /**
   * 结果钩子：把排序结果写成文本，结构化的 value 一个字都不动。
   * @param {any} exec 工具调用
   * @param {any} result 工具结果
   * @param {() => Promise<any>} next 交给下游
   * @returns {Promise<any>} 工具结果
   */
  async function onPostExecute(exec, result, next) {
    const ranked = pending.get(exec?.token)
    if (ranked === undefined) return next()
    pending.delete(exec?.token)
    const final = (await next()) ?? result
    if (result?.isError === true) return final
    return { ...final, content: [{ type: 'text', text: summaryText(ranked) }] }
  }

  ctx.on('tools/execute', onExecute)
  ctx.on('tools/post-execute', onPostExecute)

  return { onExecute, onPostExecute }
}