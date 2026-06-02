@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\download-models.ps1" -ModelSet all -InstallDir "E:\AI-Models\PR" -Source hf-mirror -OpenFolder
pause
