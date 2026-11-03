/**
 * 内置敏感命令规则表：从 snow-app 的
 * `native/src/storage/services/sensitive_command_configs.rs`（PRESET_SENSITIVE_COMMANDS）
 * 逐条移植，command_id、pattern、description、enabled 四个字段保持原样，顺序不变。
 *
 * 匹配语义与原版一致：
 * - 大小写不敏感（snow-app 由匹配层保证，见 sensitive_guard/mod.rs 的注释）；
 * - 任一规则命中即算命中，命中结果只作为「证据」交给决策模型，不直接决定放行/拒绝；
 * - 正则写坏了不能静默放行——调用方必须按 fail-closed 处理。
 *
 * 注意 pattern 里刻意保留的几处细节，改动会让行为漂移：
 * - `rm` / `dd` 用了 `(?:^|[^-\w])` 词边界，避免误伤 arm64、warm、--rm、--format、
 *   git add、address 这类子串；
 * - `git push.*-f` 会顺带匹配 `--force`，原版如此，不做「优化」。
 *
 * @module dsh-sensitive-guard/rules
 */

/**
 * @typedef {object} PresetRule
 * @property {string} commandId 稳定 id，`isPreset` 为 true 的规则不接受删除
 * @property {string} pattern 正则源码（大小写不敏感匹配）
 * @property {string} description 英文说明，UI 侧再本地化
 * @property {boolean} enabled 出厂是否启用
 */

/** @type {readonly PresetRule[]} */
export const PRESET_SENSITIVE_COMMANDS = Object.freeze([
  {
    commandId: 'rm',
    pattern: '(?:^|[^-\\w])rm\\s+\\S',
    description: 'Delete files or directories (rm, rm -rf, etc.)',
    enabled: true,
  },
  {
    commandId: 'rmdir',
    pattern: 'rmdir ',
    description: 'Remove directories',
    enabled: true,
  },
  {
    commandId: 'unlink',
    pattern: 'unlink ',
    description: 'Delete files using unlink command',
    enabled: true,
  },
  {
    commandId: 'mv-to-trash',
    pattern: 'mv .* /tmp',
    description: 'Move files to trash/tmp (potential data loss)',
    enabled: false,
  },
  {
    commandId: 'chmod',
    pattern: 'chmod ',
    description: 'Change file permissions',
    enabled: false,
  },
  {
    commandId: 'chown',
    pattern: 'chown ',
    description: 'Change file ownership',
    enabled: false,
  },
  {
    commandId: 'dd',
    pattern: '(?:^|[^-\\w])dd\\s+\\S',
    description: 'Low-level data copy (disk operations)',
    enabled: true,
  },
  {
    commandId: 'mkfs',
    pattern: 'mkfs',
    description: 'Format filesystem',
    enabled: true,
  },
  {
    commandId: 'fdisk',
    pattern: 'fdisk ',
    description: 'Disk partition manipulation',
    enabled: true,
  },
  {
    commandId: 'killall',
    pattern: 'killall ',
    description: 'Kill all processes by name',
    enabled: false,
  },
  {
    commandId: 'pkill',
    pattern: 'pkill ',
    description: 'Kill processes by pattern',
    enabled: false,
  },
  {
    commandId: 'reboot',
    pattern: 'reboot',
    description: 'Reboot the system',
    enabled: true,
  },
  {
    commandId: 'shutdown',
    pattern: 'shutdown ',
    description: 'Shutdown the system',
    enabled: true,
  },
  {
    commandId: 'sudo',
    pattern: 'sudo ',
    description: 'Execute commands with superuser privileges',
    enabled: false,
  },
  {
    commandId: 'su',
    pattern: 'su ',
    description: 'Switch user',
    enabled: false,
  },
  {
    commandId: 'curl-post',
    pattern: 'curl.*-X POST',
    description: 'HTTP POST requests (potential data transmission)',
    enabled: false,
  },
  {
    commandId: 'wget',
    pattern: 'wget ',
    description: 'Download files from internet',
    enabled: false,
  },
  {
    commandId: 'git-push',
    pattern: 'git push',
    description: 'Push code to remote repository',
    enabled: false,
  },
  {
    commandId: 'git-force-push',
    pattern: 'git push.*--force',
    description: 'Force push to remote repository (destructive)',
    enabled: true,
  },
  {
    commandId: 'git-force-push-short',
    pattern: 'git push.*-f',
    description: 'Force push to remote repository with -f flag (destructive)',
    enabled: true,
  },
  {
    commandId: 'git-reset-hard',
    pattern: 'git reset.*--hard',
    description: 'Hard reset git repository (destructive)',
    enabled: true,
  },
  {
    commandId: 'git-clean',
    pattern: 'git clean.*-f',
    description: 'Remove untracked files from git repository',
    enabled: true,
  },
  {
    commandId: 'git-revert',
    pattern: 'git revert',
    description: 'Revert git commits',
    enabled: false,
  },
  {
    commandId: 'git-reset',
    pattern: 'git reset ',
    description: 'Reset git repository state',
    enabled: false,
  },
  {
    commandId: 'npm-publish',
    pattern: 'npm publish',
    description: 'Publish package to npm registry',
    enabled: true,
  },
  {
    commandId: 'docker-rm',
    pattern: 'docker rm',
    description: 'Remove Docker containers',
    enabled: false,
  },
  {
    commandId: 'docker-rmi',
    pattern: 'docker rmi',
    description: 'Remove Docker images',
    enabled: false,
  },
  {
    commandId: 'powershell-remove-item',
    pattern: 'Remove-Item',
    description: 'PowerShell delete files or directories',
    enabled: true,
  },
  {
    commandId: 'powershell-remove-item-recurse',
    pattern: 'Remove-Item.*Recurse',
    description: 'PowerShell recursive delete (destructive)',
    enabled: true,
  },
  {
    commandId: 'cmd-del',
    pattern: '(?:^|[^\\w])del\\s+\\S',
    description: 'Delete files using del (CMD/PowerShell alias for Remove-Item)',
    enabled: true,
  },
  {
    commandId: 'cmd-rd',
    pattern: '(?:^|[^\\w])rd\\s+\\S',
    description: 'Remove directories using rd (CMD/PowerShell alias for rmdir)',
    enabled: true,
  },
  {
    commandId: 'cmd-erase',
    pattern: '(?:^|[^\\w])erase\\s+\\S',
    description: 'Delete files using erase (CMD alias for del)',
    enabled: true,
  },
  {
    commandId: 'format-volume',
    pattern: 'Format-Volume',
    description: 'Format disk volume (destructive)',
    enabled: true,
  },
  {
    commandId: 'mysql',
    pattern: 'mysql ',
    description: 'MySQL CLI client (direct database access)',
    enabled: false,
  },
  {
    commandId: 'psql',
    pattern: 'psql ',
    description: 'PostgreSQL CLI client (direct database access)',
    enabled: false,
  },
  {
    commandId: 'sqlite3',
    pattern: 'sqlite3 ',
    description: 'SQLite3 CLI (direct database access)',
    enabled: false,
  },
  {
    commandId: 'mongosh',
    pattern: 'mongosh ',
    description: 'MongoDB Shell (direct database access)',
    enabled: false,
  },
  {
    commandId: 'redis-cli',
    pattern: 'redis-cli ',
    description: 'Redis CLI client (direct cache/database access)',
    enabled: false,
  },
  {
    commandId: 'sqlcmd',
    pattern: 'sqlcmd ',
    description: 'SQL Server CLI client (direct database access)',
    enabled: false,
  },
  {
    commandId: 'sql-drop-table',
    pattern: 'DROP TABLE',
    description: 'SQL DROP TABLE statement (destroys table and all data)',
    enabled: true,
  },
  {
    commandId: 'sql-drop-database',
    pattern: 'DROP DATABASE',
    description: 'SQL DROP DATABASE statement (destroys entire database)',
    enabled: true,
  },
  {
    commandId: 'sql-truncate',
    pattern: 'TRUNCATE ',
    description: 'SQL TRUNCATE statement (removes all rows from table)',
    enabled: true,
  },
  {
    commandId: 'sql-delete',
    pattern: 'DELETE FROM',
    description: 'SQL DELETE statement (removes rows from table)',
    enabled: false,
  },
])

/** 内置判定使用的规则 id，`snow:` 前缀与原版一致，不会与用户规则冲突。 */
export const CHECK_FAILED_RULE_ID = 'snow:check-failed'

/**
 * 内置规则的中文说明，按 commandId 索引。
 *
 * 英文原文保留在 {@link PRESET_SENSITIVE_COMMANDS} 里不动（逐条比对测试要用），
 * 播种到磁盘时换成这里的中文，界面和规则列表都读中文。
 */
export const PRESET_DESCRIPTION_ZH = Object.freeze({
  rm: '删除文件或目录（rm、rm -rf 等）',
  rmdir: '删除目录',
  unlink: '用 unlink 删除文件',
  'mv-to-trash': '把文件移到临时目录（可能丢数据）',
  chmod: '修改文件权限',
  chown: '修改文件所有者',
  dd: '底层数据复制（可能擦写磁盘）',
  mkfs: '格式化文件系统',
  fdisk: '磁盘分区操作',
  killall: '按名字杀掉所有进程',
  pkill: '按模式杀进程',
  reboot: '重启系统',
  shutdown: '关闭系统',
  sudo: '以超级用户权限执行命令',
  su: '切换用户',
  'curl-post': '发起 HTTP POST（可能外发数据）',
  wget: '从网络下载文件',
  'git-push': '推送代码到远程仓库',
  'git-force-push': '强制推送（会覆盖远端历史）',
  'git-force-push-short': '用 -f 强制推送（会覆盖远端历史）',
  'git-reset-hard': '硬重置仓库（丢弃本地改动）',
  'git-clean': '清理仓库里的未跟踪文件',
  'git-revert': '回滚提交',
  'git-reset': '重置仓库状态',
  'npm-publish': '发布包到 npm 仓库',
  'docker-rm': '删除 Docker 容器',
  'docker-rmi': '删除 Docker 镜像',
  'powershell-remove-item': 'PowerShell 删除文件或目录',
  'powershell-remove-item-recurse': 'PowerShell 递归删除（破坏性强）',
  'cmd-del': '用 del 删除文件（CMD / PowerShell 等价于 Remove-Item）',
  'cmd-rd': '用 rd 删除目录（CMD / PowerShell 等价于 rmdir）',
  'cmd-erase': '用 erase 删除文件（CMD 里等价于 del）',
  'format-volume': '格式化磁盘卷（破坏性强）',
  mysql: 'MySQL 命令行客户端（直连数据库）',
  psql: 'PostgreSQL 命令行客户端（直连数据库）',
  sqlite3: 'SQLite3 命令行（直连数据库）',
  mongosh: 'MongoDB Shell（直连数据库）',
  'redis-cli': 'Redis 命令行客户端（直连缓存/数据库）',
  sqlcmd: 'SQL Server 命令行客户端（直连数据库）',
  'sql-drop-table': 'SQL 删表（表和全部数据一起没）',
  'sql-drop-database': 'SQL 删库（整个数据库都没）',
  'sql-truncate': 'SQL 清空表（删掉全部行）',
  'sql-delete': 'SQL 删除行',
})

/**
 * 取一条规则的说明：内置规则优先用中文，自定义规则用它自己写的。
 * @param {{ commandId: string; description: string; isPreset?: boolean }} rule 规则
 * @returns {string} 展示用说明
 */
export function describeRule(rule) {
  if (rule.isPreset !== false) {
    const zh = PRESET_DESCRIPTION_ZH[rule.commandId]
    if (zh !== undefined) return zh
  }
  return rule.description
}

/**
 * 编译一条规则。编译失败抛出，由调用方按 fail-closed 记成「检查失败」命中。
 * @param {string} pattern 正则源码
 * @returns {RegExp} 大小写不敏感的正则
 */
export function compilePattern(pattern) {
  return new RegExp(pattern, 'i')
}

/**
 * 用一组规则匹配一段文本。
 * @param {string} text 被检查的命令文本
 * @param {ReadonlyArray<{ commandId: string; pattern: string; description: string }>} rules 已启用的规则
 * @returns {{ matches: Array<{ commandId: string; pattern: string; description: string }>; failed: string | undefined }}
 *   `failed` 非空表示有规则编译失败，调用方必须按 fail-closed 处理。
 */
export function matchRules(text, rules) {
  /** @type {Array<{ commandId: string; pattern: string; description: string }>} */
  const matches = []
  let failed
  for (const rule of rules) {
    let regex
    try {
      regex = compilePattern(rule.pattern)
    } catch (error) {
      failed = `${rule.commandId}: ${error instanceof Error ? error.message : String(error)}`
      continue
    }
    if (regex.test(text)) {
      matches.push({
        commandId: rule.commandId,
        pattern: rule.pattern,
        description: rule.description,
      })
    }
  }
  return { matches, failed }
}
