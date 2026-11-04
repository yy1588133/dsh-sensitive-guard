# dsh-decision-guard · 决策模型守门

给 DeepSeek Harness 装一个「应用决策模型」的多功能插件：**执行敏感命令前先判一句**，**会话开始时把用不上的工具摘出上下文**，**技能目录按任务裁剪**，**glob 结果按相关性排序**。四件事共用一套 Jev 连接，全部默认关闭、失败自动退回原生行为。

> 改名说明：这个包原叫 `dsh-sensitive-guard`，0.2.0 起更名为 `dsh-decision-guard`。配置目录会自动从旧目录复制一次，旧目录保留不删；安装时先移除旧包再装新包（见「安装」）。

## 四个功能

| 功能 | 什么时候生效 | 省什么 | 判不清时 |
|---|---|---|---|
| 敏感命令守门 | 命中 43 条规则之一 | 防住完全权限模式下的误删 | 按设置回退（默认跟随权限模式） |
| 工具按需加载 | 每个会话首条消息 | 工具 schema 的常驻 token | 一个都不摘 |
| 技能选择 | 每次注入技能目录 | 技能摘要的常驻 token | 保留完整目录 |
| 文件排序 | 每次 `glob` | 模型挑路径的注意力 | 原样返回 |

前两项是这次升级的重点。工具 schema 按每个请求付费，20 个工具的整份定义约 3.7k token，每一轮都在发；摘掉用不上的，等于把上下文预算还给你。

## 安装

从 GitHub 直接装，不需要发 npm，也没有构建步骤（纯 JavaScript）：

```bash
dsh plugin --profile <你的 profile> remove dsh-sensitive-guard   # 旧包名，若装过
dsh plugin --profile <你的 profile> add yy1588133/dsh-sensitive-guard
```

仓库名仍是 `dsh-sensitive-guard`，包名已经变成 `dsh-decision-guard`，所以依赖键会跟着变——这就是要先 remove 的原因。

装完重启 DSH 桌面端，设置里出现「决策模型守门」。

> pnpm 10.26 起默认阻止 git 依赖执行 `prepare` 脚本，纯 JS 包正好不受影响——装下来就能跑。

## 工具按需加载

**它怎么工作**

1. 会话里出现第一条真正的用户消息时，插件把当前可见工具的名字和描述拿去做一次判断：这个任务用得上哪些。
2. 用不上的工具被 `tools.restrict({ deny })` 摘掉——它们整份 schema 不再进入请求，模型看不到，也调不了。
3. 同时常驻一个 `tool_search` 工具：模型发现缺能力时，不带参数调用它就能看到被摘掉的工具，`enable: ["名字"]` 取回指定工具，`all: true` 全部取回。

**每会话只评估一次。** 工具表一变，prompt 前缀就作废，KV 缓存跟着重算；为了省 token 反而每轮重算一次，不划算。换任务了想让模型重新判断，在面板点「重新评估」（下一次会话生效）。

**白名单永远不会被摘。** 默认包含 `read`、`write`、`edit`、`bash`、`glob`、`grep`、`todo`、`skill`、`tool_search`、`skill_catalog`，你可以在面板里追加。少了这些，模型连「把工具找回来」这一步都做不了。

**判不清就不摘。** 没 key、超时、冷却中、答案缺项、`restrict` 抛错——任何一步失败都保持完整工具表。宁可多花 token，不能把工具变没。

**已知代价**

- `tool_search` 自己也要占一份 schema（几百 token），省下来的是净额。
- 模型如果一开始就判断错，它得先调用一次 `tool_search` 才能继续，多一轮往返。
- 与 `dsh-plugin-tool-management` 的「模型工具表」并存：两边各自隐藏、各自恢复，同一个工具被两边同时藏起来时，要两边都放出来才看得见。面板会把「另一方隐藏」标出来。

## 技能选择

技能目录默认每轮都把全部技能摘要塞进上下文。开启后，插件在目录注入时问一次决策模型「每个技能与当前任务的相关性」，只保留过线的前 N 个（默认 8 个、概率阈值 0.5），其余从目录里去掉。

**技能没有被禁用。** 目录只是摘要清单，`skill` 工具仍能按名字加载任意技能；模型需要完整清单时调用常驻的 `skill_catalog`，它会列出全部可加载技能。所以裁错了最多是「模型不知道有这个技能」，不会「这个技能用不了」。

## 文件排序

`glob` 返回的路径顺序是文件系统给的。开启后，插件在结果返回时给每条路径打一个相关性概率，把高的排前面，并在文本结果里标上概率。结构化结果 `value.paths` 原样保留，路径一条不丢，候选超过 40 条时直接跳过排序（排一屏没意义，还把一次工具调用拖成一次长请求）。

## 敏感命令守门

沿用 0.1.0 的行为，没有改动：

- 命中规则后，把命令文本、说明、工作目录和可选会话片段交给 Jev 判 `verdict` / `reason` / `severity`。
- 拒绝永远不会被「建议」稀释；托管开关只决定「允许」的判定要不要再问你一次。
- 插件永远不会返回「强制允许」，最多 `next()` 透传给下游。
- 判不清时按设置回退：直接放行 / 跟随权限模式（默认）/ 直接拒绝。

## 配置

1. 设置 → **决策模型守门** → 决策模型辅助
2. 填 TypeSafe API Key（没有就去 typesafe.ai 申请）
3. 需要国内直连的话填代理，或者留空让它自动读环境变量 / Windows 系统代理
4. 点「测试连接」，看到 `jev-1.14.0` 之类就通了
5. 按需打开「敏感命令守门」「工具按需加载」「技能选择」「文件排序」四个开关

界面上每项说明都收在 `?` 气泡里。命令行快速验证：

```bash
curl -s http://127.0.0.1:55422/sensitive-guard/api/config
curl -s http://127.0.0.1:55422/sensitive-guard/api/select
curl -s -X POST http://127.0.0.1:55422/sensitive-guard/api/test -H 'content-type: application/json' -d '{}'
curl -s -X POST http://127.0.0.1:55422/sensitive-guard/api/select -H 'content-type: application/json' -d '{"action":"restore-all"}'
```

配置放在 `$DSH_HOME/plugins/dsh-decision-guard/`（`config.json` + `rules.json`），不在包目录里，升级重装都不会蒸发。首次启动会从 `dsh-sensitive-guard/` 复制一次，旧目录保留。

## 关于国内网络

从中国大陆直连 `api.typesafe.ai` 会被 Cloudflare 按地域返回 **HTTP 451**。插件自带零依赖的 CONNECT 隧道，解析顺序是：**面板配置 → 环境变量 → Windows 系统代理 → 直连**。回环地址、`no_proxy` 命中项和非 https 目标走全局 `fetch`，留给宿主接管。

## 自测

```bash
npm test
# 等价于逐个跑：
node test/selftest.mjs        # 规则匹配、设置规整（38 例）
node test/tool-scope.mjs      # 工具范围判定（14 例）
node test/jev-protocol.mjs    # 请求体、答案解析、失败降级、缓存冷却（22 例）
node test/decision-judge.mjs  # 通用 judge 的降级路径（4 例）
node test/tool-select.mjs     # 工具隐藏/召回/白名单/失败不摘（6 例）
node test/skill-select.mjs    # 技能裁剪/阈值/失败降级（9 例）
node test/file-rank.mjs       # glob 排序/超候选/路径不丢（9 例）
node test/rules-parity.mjs    # 与 snow-app 的 43 条规则逐条比对
node test/web-route-timing.mjs# 面板路由挂载时机（4 例）
```

## 已知限制

- **完全权限模式下没有中间态。** `ask` 在 `never` 策略下等于拒绝，「拦下但先问我」只在会话使用需要审批的权限预设时才成立。
- **工具选择按会话一次。** 长会话中途换任务时，工具表不会自动跟着换；靠 `tool_search` 兜底，或者开会话。
- **决策模型不是代码审查器。** 它看的是命令文本、工具描述、路径名，不做静态分析，也不读脚本文件内容。
- **省 token 的估算有误差。** 面板上的数字按字符数粗估，和真实分词器有出入；精确值要用宿主自己的估算器。
- **它加速决策，不是最后防线。** 规则表、权限预设、沙箱边界仍然是主干，这个插件让「完全权限」不至于一点网都没有。