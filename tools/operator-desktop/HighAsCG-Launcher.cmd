@echo off
setlocal
cd /d "%~dp0..\.."
if not exist "package.json" (
  echo Expected HighAsCG repo at %CD%
  pause
  exit /b 1
)
call npm run launcher
set ERR=%ERRORLEVEL%
if %ERR% NEQ 0 (
  echo Electron launcher failed. Falling back to Python legacy launcher...
  python tools\operator-desktop\highascg-launcher.py %*
)
exit /b %ERRORLEVEL%
