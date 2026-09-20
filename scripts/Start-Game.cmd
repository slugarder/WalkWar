@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Game.ps1" %*
exit /b %ERRORLEVEL%
