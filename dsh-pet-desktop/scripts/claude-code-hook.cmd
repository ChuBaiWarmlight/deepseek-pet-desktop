@echo off
set "DSH_PET_PROVIDER=claude-code"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-hook.ps1" %*
