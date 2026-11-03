# dsh-sensitive-guard · 敏感命令守门

补齐 DeepSeek Harness「完全权限」模式的安全缺口：**执行敏感命令之前，先让决策模型判一句**。

「完全权限」这个预设等于把两把锁同时打开——文件沙箱不限制，审批策略是 `never`（所有审批请求直接拒绝，连弹窗都没有）。于是 `rm -rf` 说跑就跑。这个插件在工具真正执行前插一道闸：先用规则认出「可能有害的命令」，再让 [TypeSafe Jev](https://typesafe.ai) 判断这一条具体命令在**当前目录**下到底该不该放行。

## 安装

从 GitHub 直接装，不需要发 npm：

```bash
dsh plugin --profile <你的 profile> add yy1588133/dsh-sensitive-guard
```

也可以写完整地址：`github:yy1588133/dsh-sensitive-guard`。

装完重启 DSH 桌面端，设置里就会出现「敏感命令守门」。

**更新**：

```bash
dsh plugin --profile <你的 profile> remove dsh-sensitive-guard
dsh plugin --profile <你的 profile> add yy1588133/dsh-sensitive-guard
```

（先删再装是 dsh 的现有行为：同版本号重复安装会报 `already-installed`，换版本号则可以直接 `add`。）

> 这个包是纯 JavaScript，没有构建步骤。pnpm 10.26 起默认阻止 git 依赖执行 `prepare` 脚本，纯 JS 包正好不受影响——装下来就能跑。

## 它抄了什么

功能对齐 [snow-app](https://github.com/MayDay-wpf/snow-app) 的「决策模型辅助」：

| snow-app | 这里 |
|---|---|
| 命令规则（43 条内置 + 自定义正则） | 逐条移植，`test/rules-parity.mjs` 逐条比对，改一个字符都会红 |
| 决策模型辅助（Jev `choice`/`score` 三题） | 同协议：`verdict` / `reason` / `severity`，题面与判据原文照抄 |
| 由决策模型托管 | 同名开关 |
| 拒绝时仍让我确认 | 同名开关 |
| 参考最近会话 / 发送条数 | 同名开关，裁剪规则一致（正文 2000 字、参数 600、输出 1200、单条消息最多 8 个工具调用） |

## 它没照抄的地方，以及为什么

**1. 「托管」只管辖「允许」这一侧。**

原版里托管关闭时，判定只是「建议」，最终还是弹窗问人。但 DSH 的 `never` 策略下根本弹不出窗——`ask` 会被直接判成拒绝。如果照搬原版语义，托管关掉就等于把放行权也交出去了，反而不安全。

所以这里的规则是：**拒绝永远不会被「建议」稀释**。判定说这条命令有风险，就一定会被拦下；托管开关只决定「允许」的判定要不要再问你一次（有审批通道时才问得出来）。

**2. 判不清就回退，绝不硬拍。**

无 key、超时、HTTP 错误、答案缺字段——一律回到原生行为，并按设置决定是交给人确认还是直接拒绝。默认是「交给人确认」，在完全权限模式下这就等于拒绝，也就是 fail-closed。

插件**永远不会**返回「强制允许」。它最多返回 `next()`（透传给下游，不吞掉别人的否决权）。所以它能收紧权限，不能放宽。

**3. 配置存在 `$DSH_HOME/plugins/dsh-sensitive-guard/`，不在包目录里。**

上一版 `dsh-jev-interceptor` 的教训：`cordis.patch.yml` 和 `lib/` 都住在 `node_modules` 下，任何一次 pnpm 操作都会把整包从 store 重新展开，配置跟着蒸发。这里把 `config.json`（设置）和 `rules.json`（规则）放在包外面，升级、重装、换 profile 都不受影响。

## 怎么用

1. 设置 → **敏感命令守门** → 决策模型辅助
2. 填 TypeSafe API Key（没有就去 typesafe.ai 申请）
3. 需要国内直连的话填代理，或者留空让它自动读环境变量 / Windows 系统代理
4. 点「测试连接」，看到 `jev-1.14.0` 之类就通了
5. 打开「启用决策模型辅助」，按需选择是否托管

界面上每项说明都收在那个 `?` 里，鼠标移上去才展开。面板宽度随容器走，不会出现横向滚动条。

命令行快速验证：

```bash
curl -s http://127.0.0.1:55422/sensitive-guard/api/config
curl -s -X POST http://127.0.0.1:55422/sensitive-guard/api/test -H 'content-type: application/json' -d '{}'
curl -s http://127.0.0.1:55422/sensitive-guard/api/log
curl -s -X DELETE http://127.0.0.1:55422/sensitive-guard/api/log   # 清空最近判定
```

## 决策模型不可用时

三选一：

| 选项 | 行为 |
|---|---|
| 直接放行 | 不拦，最宽松 |
| 跟随当前权限模式（默认） | 只读 / 工作区模式有沙箱兜底，放行；完全权限模式没有任何边界，拒绝 |
| 直接拒绝 | 一律拦下 |

默认选「跟随权限模式」，因为它既不让你在受控环境里被无谓地卡住，也不让完全权限模式真的裸奔。

## 关于国内网络

从中国大陆直连 `api.typesafe.ai` 会被 Cloudflare 按地域返回 **HTTP 451**（"Typesafe is not available in your region"）。实测走本地代理后落到东京节点，同一个 key 就正常返回。

插件自带一个零依赖的 CONNECT 隧道，解析顺序是：**面板配置 → 环境变量 → Windows 系统代理 → 直连**。回环地址与 `no_proxy` 命中项、以及非 https 目标走全局 `fetch`，留给宿主的 `dsh-http-proxy` 接管。

## 参与检查的工具

默认**留空**，意思是「所有命令类工具都检查」——判断依据是参数里有没有 `command` / `script` / `text` 这类命令字段。

写文件、读文件的工具不会被误伤：`write` 写的是 `content`、`edit` 写的是 `new_string`，这些正文类字段不在命令字段表里，所以写一篇内容里带 `rm -rf` 的文档不会触发判定。

填了工具名就只检查列出的那些，逗号分隔。

## 自测

```bash
node test/selftest.mjs       # 规则匹配、词边界、设置规整、中文说明（38 例）
node test/tool-scope.mjs     # 工具范围：清单留空/非空的判定（14 例）
node test/rules-parity.mjs   # 与 snow-app 的 43 条规则逐条比对
node test/jev-protocol.mjs   # 请求体形状、答案解析、失败降级、缓存冷却（22 例）
```

## 已知限制

- **完全权限模式下没有中间态。** `ask` 在 `never` 策略下等于拒绝，所以「拦下但先问我」只在会话使用需要审批的权限预设时才成立。
- **只审命中规则的调用。** 没命中就零成本直通；规则表覆盖不到的危险命令不会有第二次机会。
- **判定依据有限。** 决策模型看到的是命令文本、说明、工作目录和可选会话片段，它不做静态分析，也不读脚本文件内容（`script_path` 只匹配路径本身）。
- **它加速决策，不是最后防线。** 敏感规则 + 权限预设仍然是主干，这个插件让「完全权限」不至于一点网都没有。
