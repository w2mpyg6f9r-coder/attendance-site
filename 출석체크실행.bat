@echo off
cd /d "%~dp0"
start "attendance-server" cmd /k "py -m http.server 8000"
timeout /t 2 >nul
start "" "http://localhost:8000"