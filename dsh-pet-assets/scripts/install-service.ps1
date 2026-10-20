# Register an auto-start scheduled task (runs at user logon).
param(
  [string]$Node = "node",
  [string]$ServerDir = (Split-Path $PSScriptRoot -Parent)
)
$script = Join-Path $ServerDir "server.mjs"
if (-not (Test-Path $script)) {
  Write-Error "server.mjs not found: $script"
  exit 1
}
$action = New-ScheduledTaskAction -Execute $Node -Argument "`"$script`"" -WorkingDirectory $ServerDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "dsh-pet-assets" -Action $action -Trigger $trigger `
  -Description "dsh-pet assets management service auto-start" -Force | Out-Null
Write-Output "Registered auto-start task dsh-pet-assets (node $script)"
