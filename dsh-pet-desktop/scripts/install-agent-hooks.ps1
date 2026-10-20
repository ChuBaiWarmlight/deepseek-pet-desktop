param(
  [switch]$Claude,
  [switch]$Codex,
  [switch]$CodexChain,
  [switch]$PrintOnly
)

# 一键接入：
#   powershell -File scripts\install-agent-hooks.ps1 -Claude
#   powershell -File scripts\install-agent-hooks.ps1 -Codex
#   powershell -File scripts\install-agent-hooks.ps1 -Claude -Codex
# 修改前会自动备份原配置；-PrintOnly 只打印命令不写文件。

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$psHook = Join-Path $scriptDir "agent-hook.ps1"
$claudeCmd = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + $psHook + '" -Provider claude-code'
$codexNotify = 'notify = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ''' + $psHook + ''', "-Provider", "codex"]'

function Backup-File([string]$path) {
  if (Test-Path -LiteralPath $path) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backup = "$path.bak-$stamp"
    Copy-Item -LiteralPath $path -Destination $backup -Force
    return $backup
  }
  return ""
}

function Install-Claude {
  $settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
  Write-Host "Claude Code: $settingsPath"
  Write-Host "Hook: $claudeCmd"
  if ($PrintOnly) { return }

  $dir = Split-Path -Parent $settingsPath
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $settings = if (Test-Path -LiteralPath $settingsPath) {
    $raw = [System.IO.File]::ReadAllText($settingsPath)
    if ($raw.Trim()) { $raw | ConvertFrom-Json } else { [PSCustomObject]@{} }
  } else {
    [PSCustomObject]@{}
  }

  $hookProp = $settings.PSObject.Properties["hooks"]
  if ($null -eq $hookProp -or $null -eq $hookProp.Value) {
    if ($null -eq $hookProp) {
      $settings | Add-Member -NotePropertyName hooks -NotePropertyValue ([PSCustomObject]@{})
    } else {
      $settings.hooks = [PSCustomObject]@{}
    }
  }
  $hooks = $settings.hooks
  $events = @("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop", "SubagentStop", "SessionEnd")
  $entry = [PSCustomObject]@{
    hooks = @([PSCustomObject]@{ type = "command"; command = $claudeCmd })
  }
  $added = 0
  foreach ($ev in $events) {
    $prop = $hooks.PSObject.Properties[$ev]
    if ($null -eq $prop -or $null -eq $prop.Value) {
      if ($null -eq $prop) {
        $hooks | Add-Member -NotePropertyName $ev -NotePropertyValue @($entry)
      } else {
        $hooks.$ev = @($entry)
      }
      $added++
    } else {
      $existingJson = @($prop.Value) | ConvertTo-Json -Depth 12 -Compress
      if ($existingJson -notmatch [regex]::Escape("agent-hook.ps1")) {
        $hooks.$ev = @(@($prop.Value) + $entry)
        $added++
      }
    }
  }
  $backup = Backup-File $settingsPath
  $json = $settings | ConvertTo-Json -Depth 24
  [System.IO.File]::WriteAllText($settingsPath, $json, [System.Text.UTF8Encoding]::new($false))
  Write-Host "已写入 $added 个 hook 事件。"
  if ($backup) { Write-Host "原配置备份：$backup" }
}

function Install-Codex {
  $configPath = Join-Path $env:USERPROFILE ".codex\config.toml"
  Write-Host "Codex: $configPath"
  Write-Host $codexNotify
  if ($PrintOnly) { return }
  $dir = Split-Path -Parent $configPath
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $content = if (Test-Path -LiteralPath $configPath) { [System.IO.File]::ReadAllText($configPath) } else { "" }
  if ($content -match "(?m)^\s*notify\s*=") {
    Write-Host "检测到已有 notify 配置，未自动覆盖。请把上面的 notify 行替换进去，或先删除旧行后再运行。" -ForegroundColor Yellow
    return
  }
  $backup = Backup-File $configPath
  $next = if ($content.Trim()) { $content.TrimEnd() + "`r`n`r`n" + $codexNotify + "`r`n" } else { $codexNotify + "`r`n" }
  [System.IO.File]::WriteAllText($configPath, $next, [System.Text.UTF8Encoding]::new($false))
  Write-Host "已写入 Codex notify。"
  if ($backup) { Write-Host "原配置备份：$backup" }
}

function Install-CodexChain {
  $configPath = Join-Path $env:USERPROFILE ".codex\config.toml"
  $wrapperPath = Join-Path (Join-Path $env:USERPROFILE ".dsh-pet-desktop") "codex-notify-chain.ps1"
  Write-Host "Codex: $configPath"
  Write-Host "链式通知脚本：$wrapperPath"
  if ($PrintOnly) { return }

  if (-not (Test-Path -LiteralPath $configPath)) {
    Write-Host "没有找到 Codex 配置。请先运行 -Codex 生成 notify。" -ForegroundColor Yellow
    return
  }
  $content = [System.IO.File]::ReadAllText($configPath)
  $m = [regex]::Match($content, '(?m)^[ \t]*notify[ \t]*=[ \t]*\[(.*)\][ \t]*$')
  if (-not $m.Success) {
    Write-Host "没有检测到已有 notify，直接运行 -Codex 即可。" -ForegroundColor Yellow
    return
  }
  if ($m.Value -match 'agent-hook\.ps1|codex-notify-chain\.ps1') {
    Write-Host "notify 已经指向桌宠 hook，无需链式安装。" -ForegroundColor Yellow
    return
  }

  $argv = @()
  foreach ($q in [regex]::Matches($m.Groups[1].Value, "'((?:[^']|'')*)'|""((?:[^""\\]|\\.)*)""")) {
    if ($q.Groups[1].Success) { $argv += $q.Groups[1].Value.Replace("''", "'") }
    else { $argv += ($q.Groups[2].Value -replace '\\(.)', '$1') }
  }
  if ($argv.Count -eq 0) {
    Write-Host "无法解析已有 notify，请手动处理。" -ForegroundColor Yellow
    return
  }

  $dir = Split-Path -Parent $wrapperPath
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

  $origLiteral = ($argv | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ", "
  $hookLiteral = "'" + ($psHook -replace "'", "''") + "'"
  $wrapper = @"
param([Parameter(ValueFromRemainingArguments = `$true)][string[]]`$Rest = @())

# 由 install-agent-hooks.ps1 生成：先调用原有 notify，再把事件转给桌宠。
`$original = @($origLiteral)
`$hook = $hookLiteral

try {
  if (`$original.Count -gt 0 -and (Test-Path -LiteralPath `$original[0])) {
    `$exe = `$original[0]
    `$originalRest = @()
    if (`$original.Count -gt 1) { `$originalRest = `$original[1..(`$original.Count - 1)] }
    & `$exe @originalRest @Rest | Out-Null
  }
} catch { }

try {
  `$payload = if (`$Rest.Count -gt 0) { `$Rest -join " " } else { "" }
  if (`$payload) { & `$hook -Payload `$payload -Provider codex | Out-Null }
} catch { }

exit 0
"@
  [System.IO.File]::WriteAllText($wrapperPath, $wrapper, [System.Text.UTF8Encoding]::new($true))

  $notifyLine = 'notify = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ''' + $wrapperPath + ''']'
  $next = $content.Substring(0, $m.Index) + $notifyLine + $content.Substring($m.Index + $m.Length)
  $backup = Backup-File $configPath
  [System.IO.File]::WriteAllText($configPath, $next, [System.Text.UTF8Encoding]::new($false))
  Write-Host "已把原有 notify 链到桌宠 hook。"
  if ($backup) { Write-Host "原配置备份：$backup" }
}

if (-not $Claude -and -not $Codex -and -not $CodexChain) {
  Write-Host "用法："
  Write-Host "  powershell -File scripts\install-agent-hooks.ps1 -Claude"
  Write-Host "  powershell -File scripts\install-agent-hooks.ps1 -Codex"
  Write-Host "  powershell -File scripts\install-agent-hooks.ps1 -CodexChain"
  Write-Host "  powershell -File scripts\install-agent-hooks.ps1 -Claude -Codex"
  Write-Host "  powershell -File scripts\install-agent-hooks.ps1 -Claude -PrintOnly"
  Write-Host ""
  Write-Host "Claude Code 命令：$claudeCmd"
  Write-Host "Codex notify：$codexNotify"
  exit 0
}

if ($Claude) { Install-Claude }
if ($Codex) { Install-Codex }
if ($CodexChain) { Install-CodexChain }
