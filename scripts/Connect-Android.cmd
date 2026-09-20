@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Connect-Android.ps1" %*
exit /b %ERRORLEVEL%
