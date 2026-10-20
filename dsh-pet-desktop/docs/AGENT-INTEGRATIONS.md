# AI 工作搭子接入说明

桌宠内置一个只监听本机的 HTTP 事件总线，默认地址是：

```text
http://127.0.0.1:17777/api/events
```

端口和 Token 会写到 `%USERPROFILE%\.dsh-pet-desktop\agent-hub.json`，并在「工作搭子」面板里显示。所有请求都必须带：

```text
X-Pet-Token: <agent-hub.json 里的 token>
```

事件总线只绑定 `127.0.0.1`，不暴露到局域网。适配器默认只上报事件类型、工具名、项目目录等元数据，不上报 prompt 和代码内容。

## 统一事件格式

```json
{
  "provider": "claude-code",
  "kind": "approval.requested",
  "status": "等待确认",
  "summary": "有一个操作需要你确认。",
  "severity": "info",
  "attention": "interrupt",
  "sessionId": "abc123",
  "project": "my-project",
  "cwd": "E:\\work\\my-project",
  "windowTitle": "Claude"
}
```

`kind` 常用值：

- `session.start` / `session.end`
- `prompt.submitted`
- `assistant.thinking` / `assistant.message`
- `tool.start` / `tool.end`
- `approval.requested` / `approval.resolved`
- `test.result` / `build.result`
- `task.done` / `task.failed`
- `turn.completed`
- `notification`

`attention` 三档：

- `silent`：只更新桌宠状态胶囊，不主动打扰。
- `glance`：弹出气泡，几秒后自动收起。
- `interrupt`：审批、失败等关键事件，气泡保留到用户处理。

## Claude Code

### 自动接入

在桌宠目录运行：

```powershell
powershell -File scripts\install-agent-hooks.ps1 -Claude
```

脚本会合并写入 `%USERPROFILE%\.claude\settings.json`，并在写入前备份原文件。它接入这些事件：

`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Notification`、`Stop`、`SubagentStop`、`SessionEnd`。

其中 `Notification` 里包含权限/确认关键字时，会作为 `approval.requested` 发给桌宠，触发审批雷达。

### 手动配置

在 `settings.json` 的 `hooks` 中加入：

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"E:\\deepseek-harness-student\\dsh-pet-desktop\\scripts\\agent-hook.ps1\" -Provider claude-code" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"E:\\deepseek-harness-student\\dsh-pet-desktop\\scripts\\agent-hook.ps1\" -Provider claude-code" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "powershell -NoProfile -ExecutionPolicy Bypass -File \"E:\\deepseek-harness-student\\dsh-pet-desktop\\scripts\\agent-hook.ps1\" -Provider claude-code" }] }
    ]
  }
}
```

如果 Claude Code 运行在 Windows Terminal / PowerShell 里，审批雷达默认查找标题包含 `Claude` 的窗口。窗口标题不含 `Claude` 时，可以设置环境变量：

```powershell
$env:DSH_PET_CLAUDE_WINDOW = "Windows Terminal"
```

## Codex

在桌宠目录运行：

```powershell
powershell -File scripts\install-agent-hooks.ps1 -Codex
```

脚本会向 `%USERPROFILE%\.codex\config.toml` 追加：

```toml
notify = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", 'E:\deepseek-harness-student\dsh-pet-desktop\scripts\agent-hook.ps1', "-Provider", "codex"]
```

如果已经有 `notify` 配置（例如 Codex 自带的 `codex-computer-use.exe`），不要覆盖它，改用链式安装：

```powershell
powershell -File scripts\install-agent-hooks.ps1 -CodexChain
```

它会在 `%USERPROFILE%\.dsh-pet-desktop\codex-notify-chain.ps1` 生成一个转发脚本：先按原样调用你已有的 notify 命令，再把同一个事件转给桌宠，最后 `exit 0`。原 `config.toml` 会先备份，只有 `notify` 这一行会被替换。

Codex 的 `agent-turn-complete` 会映射成 `turn.completed`；如果你在其他地方显式发送 `task.done`，桌宠会播放庆祝动画。

> 注意：Codex 的 `notify` 只有回合级事件，拿不到工具调用和审批细节。想要审批雷达，优先接 Claude Code；Codex 侧后续会走 MCP / 本地日志适配器。

## 任意脚本 / Cursor / 其他 AI 工具

任何能发 HTTP 的程序都可以直接发事件：

```powershell
$hub = Get-Content "$env:USERPROFILE\.dsh-pet-desktop\agent-hub.json" -Raw | ConvertFrom-Json
$body = @{
  provider = "cursor"
  kind = "test.result"
  status = "测试失败"
  summary = "2 个用例未通过"
  severity = "error"
  attention = "interrupt"
  windowTitle = "Cursor"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Uri "http://127.0.0.1:$($hub.port)/api/events" `
  -Method Post `
  -Headers @{ "X-Pet-Token" = $hub.token } `
  -ContentType "application/json" `
  -Body $body
```

## 会话时间线

事件除了进内存队列，还会按本地日期追加到：

```text
%USERPROFILE%\.dsh-pet-desktop\timeline\YYYY-MM-DD.jsonl
```

每行一条原始事件，断电或重启都不会丢历史。读取用这三个命令：

- `agent_timeline(day?, limit?)`：某天的事件，新的在前，默认 500 条。
- `agent_timeline_summary(day?)`：当天聚合——会话数、工具调用、审批、失败、在岗分钟、按 provider 统计。
- `agent_timeline_days(limit?)`：有记录的日期列表。

`activeMinutes` 不是简单首尾相减，而是把同一天所有会话区间合并后计算，多开几个终端也不会重复计时。

时间线只存在本机，不参与同步。后续的晨间简报、下班收尾、工作成就都从这里取数。

## 专注态

总线会根据事件自动判断你是否在工作，不需要额外计时器：

- 任意事件到来就算「活跃」；超过 10 分钟没有事件自动回到待机。
- 连续工作满 90 分钟，发一次 `work-break` 提醒；同一段连续工作只提醒一次。
- 同时有 2 个以上任务在等确认时，发一次 `approval-aggregate`，不会每来一个就弹一次。
- 审批请求 30 分钟没有结果会自动失效，不会一直挂在「待确认」里。
- 同一 provider / 会话 / 类型 / 状态下 2 秒内重复上报的事件会去重；工具事件会把 `data` 里的文件路径一起参与比较，不会误吞不同文件的连续操作。

前端可以用 `work_focus_state` 读取当前状态：

```json
{
  "working": true,
  "sinceTs": 1792477000000,
  "continuousMinutes": 42,
  "idleMinutes": 0,
  "needsBreak": false,
  "pendingApprovals": 1,
  "providers": ["claude-code"]
}
```

排障或测试脚本可以用 `POST /api/focus/reset` 清空当前连续工作段和待确认列表（需要 `X-Pet-Token`）。

## 任务卡

`work_task_cards(day?)` 把当天每个会话聚合成一张卡：

```json
{
  "provider": "claude-code",
  "sessionId": "abc",
  "project": "deepseek-pet-desktop",
  "startTs": 1792477000000,
  "endTs": 1792478800000,
  "minutes": 30,
  "events": 42,
  "approvals": 1,
  "failures": 0,
  "completed": true,
  "tools": [{ "name": "Edit", "count": 8 }],
  "files": ["src/PetApp.tsx", "src/pet.css"]
}
```

文件路径来自 `PreToolUse` 的 `tool_input.file_path` / `notebook_path` / `path`，只存路径，不存文件内容。设置 `DSH_PET_CAPTURE_PATHS=0` 可以完全关闭路径采集。

## 工作汇报

- `work_report(period, day?)`：生成 Markdown 日报（`period=day`）或周报（`period=week`）。
- `work_report_export(period, day?)`：写入 `%USERPROFILE%\.dsh-pet-desktop\reports\`，返回文件路径。
- `work_brief(kind)`：`morning` 返回昨天概览 + 近 7 天习惯；`evening` 返回今天的收尾总结。

桌宠会在 09:30 推晨间简报、18:30 推下班收尾；当天完全没有工作记录时不会弹，避免无意义打扰。

「工作搭子」面板现在直接展示专注状态、今日任务卡和工作汇报，可以生成日报 / 周报并导出 Markdown，不必手敲命令。

报告只做本地统计，不调用大模型。

## MCP 接入

事件总线同时是一个最小可用的 MCP server，地址：

```text
http://127.0.0.1:17777/mcp?token=<agent-hub.json 里的 token>
```

只接受 `POST`，JSON-RPC 2.0。支持的方法：`initialize`、`ping`、`tools/list`、`tools/call`。

工具：

| 名称 | 作用 |
| --- | --- |
| `report_event` | 任意 AI 工具上报事件 |
| `work_summary` | 某天的工作摘要 + 最近 7 天习惯 |
| `work_task_cards` | 某天的任务卡 |
| `work_report` | 生成日报 / 周报 |
| `work_focus` | 当前专注状态 |

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "work_summary",
    "arguments": { "day": "2026-10-20" }
  }
}
```

Cursor / Windsurf 这类没有 hook 的工具，把上面的地址配成 MCP server，或者直接用 HTTP `POST /api/events` 上报即可。

## 数据保留

时间线按天保留最近 90 天，启动时自动清理更早的文件。报告文件不会被自动删除。

## 隐私边界

- 默认不发送 prompt、代码、终端输出，只采集工具名、文件路径等元数据。
- 事件按天落盘到 `timeline`，保留 90 天；内存里额外保留最近 200 条。
- 文件路径可以用 `DSH_PET_CAPTURE_PATHS=0` 完全关闭。
- `agent-hub.json` 含本机 Token，不要提交到 Git 或分享给别人。
- 不需要某个工具时，直接删除它对应的 hook 即可，桌宠不会受影响。

## 环境自检

接入出问题时先跑：

```powershell
powershell -File scripts\doctor-agent-hooks.ps1
```

它会检查事件总线是否在线、`claude` 是否指向真实二进制、nvm 当前版本是否装了 claude，以及 Claude / Codex 的 hook 是否完整。加 `-Deep` 会额外跑一次 `claude --version`。

想确认总线、去重、专注态、任务卡、MCP 和报告整条链路是否正常，可以跑：

```powershell
powershell -File scripts\smoke-agent-hub.ps1
```

脚本会使用 `smoke-test` 这个 provider 写入测试事件，跑完自动从当天时间线删除，并重置专注态，不会污染日报。

### nvm 与 Node 版本

`nvm` 会把全局包装在各自的 Node 版本目录里，`%NVM_SYMLINK%`（你机器上是 `E:\DownLoad\nodefiles`）只是指向当前版本的符号链接。所以：

- 只有装过 `@anthropic-ai/claude-code` 的那个 Node 版本才有可用的 `claude.exe`。
- `nvm use` 切到别的版本后，`claude` 会直接报「不是内部或外部命令」，即使之前能用。
- 已经启动的 `claude` 进程不受影响：Windows 允许运行中的 exe 被改名或删除，所以旧窗口还能继续工作，但新窗口打不开。

自检脚本会列出「装了可用 claude 的 Node 版本」，切版本前确认一下即可。

## 排查

1. 打开桌宠右键菜单 →「🤝 工作搭子」，确认事件总线显示「运行中」。
2. 点「手动模拟」里的「等待确认」，应出现审批气泡。
3. 如果 Claude Code 没反应，运行 `powershell -File scripts\agent-hook.ps1 -Provider claude-code`，把一段 JSON 从 stdin 喂进去测试。脚本会按 UTF-8 读取 stdin（PowerShell 5.1 默认是 GBK，会弄坏中文 JSON）。
4. 如果「去看看」找错窗口，检查 `windowTitle` 是否和实际窗口标题匹配；也可以在脚本里设置 `DSH_PET_CLAUDE_WINDOW` / `DSH_PET_CODEX_WINDOW`。

## 定位窗口

「工作搭子」里的「定位窗口」会按三层顺序处理：

1. 先找已经打开的窗口：同时匹配窗口标题、进程名和事件里的项目目录。Codex / ChatGPT 桌面版的实际进程名是 `ChatGPT.exe`（属于 `OpenAI.Codex` 包），所以标题只写 `Codex` 也能正确定位。
2. Claude Code 优先匹配标题里包含 `Claude` 或项目目录的终端 / VS Code 窗口；不会随便抢一个无关的 PowerShell 窗口。
3. 找不到时自动启动：Claude Code 会打开 Windows Terminal 到事件的 `cwd`，并尝试 `claude --resume <sessionId>`；ChatGPT / Codex 会通过开始菜单应用启动。

如果 Claude Code 终端的标题既不含项目名也不含 Claude，定位会认为它不存在并新开一个窗口。此时可以把终端标签改成项目名，或设置 `DSH_PET_CLAUDE_WINDOW` 为固定标题。
