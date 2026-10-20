param([switch]$Deep)

# 桌宠 AI 工作搭子环境自检
# 用法：powershell -File scripts\doctor-agent-hooks.ps1
# 检查：事件总线、Claude Code 安装、nvm 版本、Claude / Codex hook 配置。

$ErrorActionPreference = "SilentlyContinue"
$script:ok = 0
$script:warn = 0
$script:fail = 0

function Pass([string]$m) { Write-Host "[ OK ] $m" -ForegroundColor Green; $script:ok++ }
function Warn([string]$m) { Write-Host "[WARN] $m" -ForegroundColor Yellow; $script:warn++ }
function Fail([string]$m) { Write-Host "[FAIL] $m" -ForegroundColor Red; $script:fail++ }

Write-Host "== 桌宠事件总线 =="
$hubPath = Join-Path $env:USERPROFILE ".dsh-pet-desktop\agent-hub.json"
if (Test-Path -LiteralPath $hubPath) {
  $hub = [System.IO.File]::ReadAllText($hubPath) | ConvertFrom-Json
  if ($hub.port -and $hub.token) {
    Pass "hub 配置存在，端口 $($hub.port)"
    try {
      $null = Invoke-RestMethod -Uri "http://127.0.0.1:$($hub.port)/api/status" -Headers @{ "X-Pet-Token" = $hub.token } -TimeoutSec 3
      Pass "事件总线可访问"
    } catch {
      Fail "事件总线连不上，桌宠可能没启动：$($_.Exception.Message)"
    }
  } else {
    Fail "hub 配置缺少 port / token，启动一次桌宠会重新生成"
  }
} else {
  Fail "找不到 $hubPath，请先启动桌宠"
}

Write-Host ""
Write-Host "== Node / nvm =="
$nvmHome = $env:NVM_HOME
if (-not $nvmHome -and (Test-Path -LiteralPath "E:\DownLoad\nvm")) { $nvmHome = "E:\DownLoad\nvm" }
$nvmLink = $env:NVM_SYMLINK
if (-not $nvmLink -and (Test-Path -LiteralPath "E:\DownLoad\nodefiles")) { $nvmLink = "E:\DownLoad\nodefiles" }

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($nodeExe) { Pass "node $(node -v)（$nodeExe）" } else { Warn "PATH 里没有 node" }

if ($nvmLink -and (Test-Path -LiteralPath $nvmLink)) {
  $linkItem = Get-Item -LiteralPath $nvmLink -Force
  if ($linkItem.LinkType) {
    Pass "$nvmLink -> $($linkItem.Target)"
  } else {
    Warn "$nvmLink 不是符号链接，nvm 切换版本可能不会生效"
  }
}

$workingVersions = @()
if ($nvmHome -and (Test-Path -LiteralPath $nvmHome)) {
  foreach ($v in Get-ChildItem -LiteralPath $nvmHome -Directory -Filter "v*") {
    $exe = Join-Path $v.FullName "node_modules\@anthropic-ai\claude-code\bin\claude.exe"
    if (Test-Path -LiteralPath $exe) { $workingVersions += $v.Name }
  }
  if ($workingVersions.Count -gt 0) {
    Pass "装有可用 claude 的 Node 版本：$($workingVersions -join ', ')"
  } else {
    Fail "所有 Node 版本里都没有 claude.exe，需要重新全局安装"
  }
} else {
  Warn "没找到 nvm 目录，跳过版本扫描"
}

Write-Host ""
Write-Host "== Claude Code =="
$claudeCmd = Get-Command claude -All -ErrorAction SilentlyContinue | Where-Object { $_.Source -match "\.(cmd|exe|ps1)$" } | Select-Object -First 1
if ($claudeCmd) {
  $target = $null
  if ($claudeCmd.Source -match "\.(cmd|ps1)$") {
    $shimText = [System.IO.File]::ReadAllText($claudeCmd.Source)
    $hit = [regex]::Match($shimText, "node_modules[\\/]@anthropic-ai[\\/]claude-code[\\/]bin[\\/]claude\.exe")
    if ($hit.Success) {
      $target = Join-Path (Split-Path -Parent $claudeCmd.Source) ($hit.Value -replace "/", "\")
    }
  } else {
    $target = $claudeCmd.Source
  }
  if ($target -and (Test-Path -LiteralPath $target)) {
    Pass "claude 指向可用二进制：$target"
  } elseif ($target) {
    Fail "claude 是坏的：$target 不存在（nvm 切到了没装 claude 的 Node 版本）"
  } else {
    Warn "无法解析 claude shim：$($claudeCmd.Source)"
  }
} else {
  Fail "PATH 里找不到 claude"
}

$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
if (Test-Path -LiteralPath $settingsPath) {
  $settings = [System.IO.File]::ReadAllText($settingsPath) | ConvertFrom-Json
  $events = @("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop", "SubagentStop", "SessionEnd")
  $missing = @()
  foreach ($ev in $events) {
    $json = @($settings.hooks.$ev) | ConvertTo-Json -Depth 12 -Compress
    if ($json -notmatch "agent-hook\.ps1") { $missing += $ev }
  }
  if ($missing.Count -eq 0) {
    Pass "Claude hook 已接入 8 个事件"
  } else {
    Warn "Claude hook 缺少：$($missing -join ', ')，运行 -Claude 补齐"
  }
} else {
  Warn "没有 $settingsPath，Claude 尚未接入"
}

Write-Host ""
Write-Host "== Codex =="
$codexPath = Join-Path $env:USERPROFILE ".codex\config.toml"
if (Test-Path -LiteralPath $codexPath) {
  $notifyLine = (Select-String -LiteralPath $codexPath -Pattern "^\s*notify\s*=" | Select-Object -First 1).Line
  if ($notifyLine -match "agent-hook\.ps1") {
    Pass "Codex notify 直连桌宠 hook"
  } elseif ($notifyLine -match "codex-notify-chain\.ps1") {
    $wrapper = Join-Path $env:USERPROFILE ".dsh-pet-desktop\codex-notify-chain.ps1"
    if (Test-Path -LiteralPath $wrapper) { Pass "Codex notify 走链式转发" } else { Fail "Codex notify 指向的链式脚本不存在" }
  } elseif ($notifyLine) {
    Warn "Codex notify 还没接入桌宠：$notifyLine"
  } else {
    Warn "Codex 没有 notify 配置"
  }
} else {
  Warn "没有 $codexPath"
}

if ($Deep -and $claudeCmd) {
  Write-Host ""
  Write-Host "== claude --version =="
  claude --version
}

Write-Host ""
Write-Host "结果：OK=$($script:ok)  WARN=$($script:warn)  FAIL=$($script:fail)"
if ($script:fail -gt 0) { exit 1 }
exit 0