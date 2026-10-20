@echo off
set "DSH_PET_PROVIDER=codex"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-hook.ps1" %*
