@echo off
setlocal
cd /d "%~dp0..\.."
if not exist "package.json" (
  echo Expected HighAsCG repo at %CD%
  pause
  exit /b 1
)
python tools\operator-desktop\highascg-launcher.py %*
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 pause
exit /b %ERR%
