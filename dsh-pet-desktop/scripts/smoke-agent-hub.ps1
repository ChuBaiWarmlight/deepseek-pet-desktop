# Smoke test for the local agent hub. ASCII-only so Windows PowerShell 5.1 can parse it safely.
$ErrorActionPreference = "Stop"

$hubFile = Join-Path $env:USERPROFILE ".dsh-pet-desktop\agent-hub.json"
if (-not (Test-Path $hubFile)) { throw "agent-hub.json not found: $hubFile" }
$hub = Get-Content $hubFile -Raw | ConvertFrom-Json
$base = "http://127.0.0.1:$($hub.port)"
$headers = @{ "X-Pet-Token" = $hub.token }
$provider = "smoke-test"
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$sessionA = "smoke-a-$stamp"
$sessionB = "smoke-b-$stamp"

function Post-Event($event) {
  $body = $event | ConvertTo-Json -Compress -Depth 8
  Invoke-RestMethod -Uri "$base/api/events" -Method Post -Headers $headers -ContentType "application/json; charset=utf-8" -Body $body
}

function Invoke-Mcp($id, $method, $params) {
  $payload = @{ jsonrpc = "2.0"; id = $id; method = $method; params = $params } | ConvertTo-Json -Compress -Depth 8
  Invoke-RestMethod -Uri "$base/mcp?token=$($hub.token)" -Method Post -ContentType "application/json; charset=utf-8" -Body $payload
}

$results = @()
function Check($name, $ok, $detail) {
  $script:results += [pscustomobject]@{ Name = $name; Ok = [bool]$ok; Detail = $detail }
  $mark = if ($ok) { "PASS" } else { "FAIL" }
  Write-Host "$mark  $name  $detail"
}

$health = Invoke-RestMethod -Uri "$base/health"
Check "health" ($health.ok -eq $true) "version=$($health.version)"

Post-Event @{ provider = $provider; kind = "session.start"; sessionId = $sessionA; project = "smoke-project" } | Out-Null
Post-Event @{ provider = $provider; kind = "tool.start"; sessionId = $sessionA; project = "smoke-project"; status = "using Edit"; data = @{ tool = "Edit"; paths = @("E:\work\demo.tsx") } } | Out-Null
Post-Event @{ provider = $provider; kind = "approval.requested"; sessionId = $sessionA; project = "smoke-project"; attention = "interrupt" } | Out-Null
Post-Event @{ provider = $provider; kind = "session.start"; sessionId = $sessionB; project = "smoke-project-b" } | Out-Null
Post-Event @{ provider = $provider; kind = "approval.requested"; sessionId = $sessionB; project = "smoke-project-b"; attention = "interrupt" } | Out-Null
# Same event again inside 2 seconds: must be deduplicated.
Post-Event @{ provider = $provider; kind = "approval.requested"; sessionId = $sessionA; project = "smoke-project"; attention = "interrupt" } | Out-Null

Start-Sleep -Milliseconds 600
$recent = Invoke-RestMethod -Uri "$base/api/recent?limit=50" -Headers $headers
$mine = @($recent.events | Where-Object { $_.provider -eq $provider })
$approvalsA = @($mine | Where-Object { $_.kind -eq "approval.requested" -and $_.sessionId -eq $sessionA })
Check "events ingested" ($mine.Count -ge 5) "count=$($mine.Count)"
Check "duplicate dropped" ($approvalsA.Count -eq 1) "approvalA=$($approvalsA.Count)"

$init = Invoke-Mcp 1 "initialize" @{ protocolVersion = "2024-11-05"; capabilities = @{}; clientInfo = @{ name = "smoke"; version = "1" } }
Check "mcp initialize" ($init.result.serverInfo.name -eq "dsh-pet-desktop") "protocol=$($init.result.protocolVersion)"

$tools = Invoke-Mcp 2 "tools/list" @{}
$toolNames = @($tools.result.tools | ForEach-Object { $_.name })
$expected = @("report_event", "work_summary", "work_task_cards", "work_report", "work_focus")
$missing = @($expected | Where-Object { $toolNames -notcontains $_ })
Check "mcp tools" ($missing.Count -eq 0) "tools=$($toolNames -join ',')"

$focus = Invoke-Mcp 3 "tools/call" @{ name = "work_focus"; arguments = @{} }
$focusText = $focus.result.content[0].text | ConvertFrom-Json
Check "mcp work_focus" ($null -ne $focusText.working) "working=$($focusText.working) pending=$($focusText.pendingApprovals)"
Check "approval aggregation" ([int]$focusText.pendingApprovals -ge 2) "pending=$($focusText.pendingApprovals)"

$cards = Invoke-Mcp 4 "tools/call" @{ name = "work_task_cards"; arguments = @{} }
$cardsText = $cards.result.content[0].text | ConvertFrom-Json
$myCards = @($cardsText.cards | Where-Object { $_.provider -eq $provider })
$cardA = $myCards | Where-Object { $_.sessionId -eq $sessionA } | Select-Object -First 1
Check "task cards" ($myCards.Count -eq 2) "cards=$($myCards.Count)"
Check "tool metadata" ($cardA -and $cardA.tools[0].name -eq "Edit" -and $cardA.files[0] -eq "E:\work\demo.tsx") "tools=$($cardA.tools[0].name) files=$($cardA.files[0])"

$summary = Invoke-Mcp 5 "tools/call" @{ name = "work_summary"; arguments = @{} }
$summaryText = $summary.result.content[0].text | ConvertFrom-Json
Check "mcp work_summary" ($null -ne $summaryText.digest.events) "events=$($summaryText.digest.events)"

$report = Invoke-Mcp 6 "tools/call" @{ name = "work_report"; arguments = @{ period = "day" } }
$reportText = $report.result.content[0].text | ConvertFrom-Json
Check "mcp work_report" ($reportText.markdown -match "##") "title=$($reportText.title)"

Post-Event @{ provider = $provider; kind = "approval.resolved"; sessionId = $sessionA; project = "smoke-project" } | Out-Null
Post-Event @{ provider = $provider; kind = "session.end"; sessionId = $sessionB; project = "smoke-project-b" } | Out-Null
Start-Sleep -Milliseconds 300
$focusAfter = Invoke-Mcp 7 "tools/call" @{ name = "work_focus"; arguments = @{} }
$focusAfterText = $focusAfter.result.content[0].text | ConvertFrom-Json
Check "approval resolved" ([int]$focusAfterText.pendingApprovals -eq 0) "pending=$($focusAfterText.pendingApprovals)"

# Remove only this run's rows from today's timeline so smoke data does not pollute reports.
$today = Get-Date -Format "yyyy-MM-dd"
$timelineFile = Join-Path $env:USERPROFILE ".dsh-pet-desktop\timeline\$today.jsonl"
if (Test-Path $timelineFile) {
  $lines = [System.IO.File]::ReadAllLines($timelineFile, [System.Text.Encoding]::UTF8)
  $kept = @($lines | Where-Object {
    if ([string]::IsNullOrWhiteSpace($_)) { return $false }
    try { ($_ | ConvertFrom-Json).provider -ne $provider } catch { return $true }
  })
  [System.IO.File]::WriteAllLines($timelineFile, $kept, (New-Object System.Text.UTF8Encoding($false)))
}

Invoke-RestMethod -Uri "$base/api/focus/reset" -Method Post -Headers $headers -ContentType "application/json" -Body "{}" | Out-Null
$focusReset = Invoke-Mcp 8 "tools/call" @{ name = "work_focus"; arguments = @{} }
$focusResetText = $focusReset.result.content[0].text | ConvertFrom-Json
Check "focus reset" ($focusResetText.working -eq $false -and [int]$focusResetText.pendingApprovals -eq 0) "working=$($focusResetText.working) pending=$($focusResetText.pendingApprovals)"

$failed = @($results | Where-Object { -not $_.Ok })
Write-Host ""
Write-Host "Smoke result: $($results.Count - $failed.Count)/$($results.Count) passed"
if ($failed.Count -gt 0) { exit 1 }
