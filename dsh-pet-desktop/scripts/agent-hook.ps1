param(
  [Parameter(Position = 0)][string]$Payload = "",
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest = @(),
  [string]$Provider = ""
)

# 把 Claude Code / Codex 的 hook 输入归一化后发到桌宠本机事件总线。
# 设计原则：只发送元数据（事件类型、工具名、项目名），默认不发送 prompt / 代码内容。

$ErrorActionPreference = "Stop"

function Read-StdinText {
  $stdin = [Console]::OpenStandardInput()
  $buffer = New-Object System.IO.MemoryStream
  $stdin.CopyTo($buffer)
  $bytes = $buffer.ToArray()
  if ($bytes.Length -eq 0) { return "" }
  # Claude Code / Codex 都用 UTF-8 传 hook JSON；PowerShell 5.1 的控制台输入编码是 GBK，直接 ReadToEnd 会乱码。
  try {
    $strict = New-Object System.Text.UTF8Encoding($false, $true)
    $text = $strict.GetString($bytes)
  } catch {
    $text = [System.Text.Encoding]::Default.GetString($bytes)
  }
  return $text.TrimStart([char]0xFEFF)
}
function Get-Field($obj, [string]$name, [string]$default = "") {
  if ($null -eq $obj) { return $default }
  $prop = $obj.PSObject.Properties[$name]
  if ($null -eq $prop -or $null -eq $prop.Value) { return $default }
  if ($prop.Value -is [array]) { return $default }
  return [string]$prop.Value
}

try {
  if ($Rest.Count -gt 0) {
    $Payload = (($Payload, ($Rest -join " ")) -join " ").Trim()
  }
  if (-not $Provider) {
    $Provider = if ($env:DSH_PET_PROVIDER) { $env:DSH_PET_PROVIDER } else { "generic" }
  }
  if (-not $Payload) {
    if ($env:DSH_PET_HOOK_JSON) {
      $Payload = $env:DSH_PET_HOOK_JSON
    } elseif ([Console]::IsInputRedirected) {
      $Payload = Read-StdinText
    }
  }
  if (-not $Payload -or -not $Payload.Trim()) { exit 0 }

  $obj = $Payload | ConvertFrom-Json
  if ($null -eq $obj) { exit 0 }

  $hubPath = Join-Path $env:USERPROFILE ".dsh-pet-desktop\agent-hub.json"
  if (-not (Test-Path -LiteralPath $hubPath)) { exit 0 }
  $hub = Get-Content -LiteralPath $hubPath -Raw | ConvertFrom-Json
  $port = [int]$hub.port
  $token = [string]$hub.token
  if ($port -le 0 -or -not $token) { exit 0 }

  $Provider = $Provider.Trim().ToLowerInvariant()
  if ($Provider -eq "claude" -or $Provider -eq "claudecode") { $Provider = "claude-code" }
  if ($Provider -eq "codex-cli") { $Provider = "codex" }

  $event = @{
    provider = $Provider
    kind = "notification"
    status = ""
    summary = ""
    severity = "info"
    attention = "glance"
    sessionId = ""
    project = ""
    cwd = ""
    title = ""
    windowTitle = ""
  }

  $hook = Get-Field $obj "hook_event_name"
  if (-not $hook) { $hook = Get-Field $obj "hookEventName" }
  $cwd = Get-Field $obj "cwd"
  $event.cwd = $cwd
  if ($cwd) { $event.project = Split-Path -Leaf $cwd }
  $event.sessionId = Get-Field $obj "session_id"
  if (-not $event.sessionId) { $event.sessionId = Get-Field $obj "sessionId" }

  if ($Provider -eq "claude-code") {
    $event.windowTitle = if ($env:DSH_PET_CLAUDE_WINDOW) { $env:DSH_PET_CLAUDE_WINDOW } else { "Claude" }
    $tool = Get-Field $obj "tool_name"
    $message = Get-Field $obj "message"
    switch ($hook) {
      "SessionStart" {
        $event.kind = "session.start"; $event.status = "已开始"; $event.attention = "silent"
      }
      "SessionEnd" {
        $event.kind = "session.end"; $event.status = "已结束"; $event.attention = "silent"
      }
      "UserPromptSubmit" {
        $event.kind = "prompt.submitted"; $event.status = "收到新任务"; $event.attention = "silent"
      }
      "PreToolUse" {
        $event.kind = "tool.start"
        $event.status = if ($tool) { "正在使用 $tool" } else { "正在调用工具" }
        $event.summary = $event.status
        $event.attention = "silent"
      }
      "PostToolUse" {
        $event.kind = "tool.end"
        $event.status = if ($tool) { "$tool 完成" } else { "工具完成" }
        $event.summary = $event.status
        $event.attention = "silent"
      }
      "Notification" {
        if ($message -match "(?i)permission|approve|approval|confirm|allow|权限|确认|批准|是否允许") {
          $event.kind = "approval.requested"
          $event.status = "等待确认"
          $event.summary = if ($message) { $message } else { "有一个操作需要你确认。" }
          $event.attention = "interrupt"
        } else {
          $event.kind = "notification"
          $event.status = "有新的提醒"
          $event.summary = $message
          $event.attention = "glance"
        }
      }
      "Stop" {
        $event.kind = "turn.completed"; $event.status = "回复完成"; $event.attention = "glance"
      }
      "SubagentStop" {
        $event.kind = "tool.end"; $event.status = "子任务完成"; $event.attention = "silent"
      }
      default {
        $event.kind = "notification"
        $event.status = if ($hook) { $hook } else { "Claude Code 事件" }
        $event.summary = $event.status
      }
    }
  } elseif ($Provider -eq "codex") {
    $event.windowTitle = if ($env:DSH_PET_CODEX_WINDOW) { $env:DSH_PET_CODEX_WINDOW } else { "Codex" }
    $type = Get-Field $obj "type"
    $kind = Get-Field $obj "kind"
    switch ($type) {
      "agent-turn-start" {
        $event.kind = "assistant.thinking"; $event.status = "思考中"; $event.attention = "silent"
      }
      "agent-turn-complete" {
        $event.kind = "turn.completed"; $event.status = "回复完成"; $event.attention = "glance"
      }
      default {
        if ($kind) { $event.kind = $kind.Trim().ToLowerInvariant().Replace("_", ".") }
        else { $event.kind = "notification"; $event.status = "Codex 事件" }
      }
    }
    $event.sessionId = Get-Field $obj "thread-id"
    if (-not $event.sessionId) { $event.sessionId = Get-Field $obj "thread_id" }
  } else {
    $event.kind = Get-Field $obj "kind"
    if (-not $event.kind) { $event.kind = "notification" }
    $event.kind = $event.kind.Trim().ToLowerInvariant().Replace("_", ".")
    $event.status = Get-Field $obj "status"
    $event.summary = Get-Field $obj "summary"
    $event.title = Get-Field $obj "title"
    $event.severity = Get-Field $obj "severity"
    $event.attention = Get-Field $obj "attention"
    $event.windowTitle = Get-Field $obj "windowTitle"
    $event.sessionId = Get-Field $obj "sessionId"
    $event.project = Get-Field $obj "project"
    $event.cwd = Get-Field $obj "cwd"
    if ($obj.PSObject.Properties["ok"] -and -not $obj.ok) { $event.severity = "error" }
  }

  $uri = "http://127.0.0.1:$port/api/events"
  $json = $event | ConvertTo-Json -Compress -Depth 6
  # Windows PowerShell 5.1 发送字符串时默认不是 UTF-8；显式转字节，避免中文状态变问号。
  $body = [System.Text.Encoding]::UTF8.GetBytes($json)
  Invoke-RestMethod -Uri $uri -Method Post -Headers @{ "X-Pet-Token" = $token } -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec 2 | Out-Null
} catch {
  # hook 不能阻断用户原本的 AI 工作流，所有错误静默退出。
}
exit 0
