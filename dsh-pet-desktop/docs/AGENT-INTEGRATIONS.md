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

## 隐私边界

- 默认不发送 prompt、代码、终端输出。
- 事件只存在内存里（最近 200 条），不写入聊天记录。
- `agent-hub.json` 含本机 Token，不要提交到 Git 或分享给别人。
- 不需要某个工具时，直接删除它对应的 hook 即可，桌宠不会受影响。

## 环境自检

接入出问题时先跑：

```powershell
powershell -File scripts\doctor-agent-hooks.ps1
```

它会检查事件总线是否在线、`claude` 是否指向真实二进制、nvm 当前版本是否装了 claude，以及 Claude / Codex 的 hook 是否完整。加 `-Deep` 会额外跑一次 `claude --version`。

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
4. 如果「去看看」找不到窗口，检查 `windowTitle` 是否和实际窗口标题匹配；也可以在脚本里设置 `DSH_PET_CLAUDE_WINDOW` / `DSH_PET_CODEX_WINDOW`。
