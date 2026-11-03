/**
 * 规则表移植的逐条比对：把 snow-app 的 PRESET_SENSITIVE_COMMANDS 原样抄成
 * 期望值，再和本插件导出比对。改错一个字符都会红。
 *
 * 用法：node test/rules-parity.mjs
 */

import assert from 'node:assert/strict'
import { PRESET_SENSITIVE_COMMANDS } from '../lib/rules.js'

/**
 * 直接抄自 snow-app `native/src/storage/services/sensitive_command_configs.rs`
 * 的 PRESET_SENSITIVE_COMMANDS，顺序、pattern、description、enabled 全部照抄。
 * pattern 里的反斜杠在 Rust raw string 里是字面量，这里同样用字面量。
 */
const EXPECTED = [
  ['rm', '(?:^|[^-\\w])rm\\s+\\S', 'Delete files or directories (rm, rm -rf, etc.)', true],
  ['rmdir', 'rmdir ', 'Remove directories', true],
  ['unlink', 'unlink ', 'Delete files using unlink command', true],
  ['mv-to-trash', 'mv .* /tmp', 'Move files to trash/tmp (potential data loss)', false],
  ['chmod', 'chmod ', 'Change file permissions', false],
  ['chown', 'chown ', 'Change file ownership', false],
  ['dd', '(?:^|[^-\\w])dd\\s+\\S', 'Low-level data copy (disk operations)', true],
  ['mkfs', 'mkfs', 'Format filesystem', true],
  ['fdisk', 'fdisk ', 'Disk partition manipulation', true],
  ['killall', 'killall ', 'Kill all processes by name', false],
  ['pkill', 'pkill ', 'Kill processes by pattern', false],
  ['reboot', 'reboot', 'Reboot the system', true],
  ['shutdown', 'shutdown ', 'Shutdown the system', true],
  ['sudo', 'sudo ', 'Execute commands with superuser privileges', false],
  ['su', 'su ', 'Switch user', false],
  ['curl-post', 'curl.*-X POST', 'HTTP POST requests (potential data transmission)', false],
  ['wget', 'wget ', 'Download files from internet', false],
  ['git-push', 'git push', 'Push code to remote repository', false],
  ['git-force-push', 'git push.*--force', 'Force push to remote repository (destructive)', true],
  ['git-force-push-short', 'git push.*-f', 'Force push to remote repository with -f flag (destructive)', true],
  ['git-reset-hard', 'git reset.*--hard', 'Hard reset git repository (destructive)', true],
  ['git-clean', 'git clean.*-f', 'Remove untracked files from git repository', true],
  ['git-revert', 'git revert', 'Revert git commits', false],
  ['git-reset', 'git reset ', 'Reset git repository state', false],
  ['npm-publish', 'npm publish', 'Publish package to npm registry', true],
  ['docker-rm', 'docker rm', 'Remove Docker containers', false],
  ['docker-rmi', 'docker rmi', 'Remove Docker images', false],
  ['powershell-remove-item', 'Remove-Item', 'PowerShell delete files or directories', true],
  ['powershell-remove-item-recurse', 'Remove-Item.*Recurse', 'PowerShell recursive delete (destructive)', true],
  ['cmd-del', '(?:^|[^\\w])del\\s+\\S', 'Delete files using del (CMD/PowerShell alias for Remove-Item)', true],
  ['cmd-rd', '(?:^|[^\\w])rd\\s+\\S', 'Remove directories using rd (CMD/PowerShell alias for rmdir)', true],
  ['cmd-erase', '(?:^|[^\\w])erase\\s+\\S', 'Delete files using erase (CMD alias for del)', true],
  ['format-volume', 'Format-Volume', 'Format disk volume (destructive)', true],
  ['mysql', 'mysql ', 'MySQL CLI client (direct database access)', false],
  ['psql', 'psql ', 'PostgreSQL CLI client (direct database access)', false],
  ['sqlite3', 'sqlite3 ', 'SQLite3 CLI (direct database access)', false],
  ['mongosh', 'mongosh ', 'MongoDB Shell (direct database access)', false],
  ['redis-cli', 'redis-cli ', 'Redis CLI client (direct cache/database access)', false],
  ['sqlcmd', 'sqlcmd ', 'SQL Server CLI client (direct database access)', false],
  ['sql-drop-table', 'DROP TABLE', 'SQL DROP TABLE statement (destroys table and all data)', true],
  ['sql-drop-database', 'DROP DATABASE', 'SQL DROP DATABASE statement (destroys entire database)', true],
  ['sql-truncate', 'TRUNCATE ', 'SQL TRUNCATE statement (removes all rows from table)', true],
  ['sql-delete', 'DELETE FROM', 'SQL DELETE statement (removes rows from table)', false],
]

assert.equal(PRESET_SENSITIVE_COMMANDS.length, EXPECTED.length, '规则条数不一致')

for (const [index, [commandId, pattern, description, enabled]] of EXPECTED.entries()) {
  const actual = PRESET_SENSITIVE_COMMANDS[index]
  assert.equal(actual.commandId, commandId, `第 ${index} 条 commandId 不一致`)
  assert.equal(actual.pattern, pattern, `${commandId} 的 pattern 不一致`)
  assert.equal(actual.description, description, `${commandId} 的 description 不一致`)
  assert.equal(actual.enabled, enabled, `${commandId} 的 enabled 不一致`)
}

console.log(`规则表逐条比对通过：${EXPECTED.length} 条，顺序与内容一致`)
