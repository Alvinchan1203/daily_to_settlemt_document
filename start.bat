@echo off
echo 正在啟動每日統計工具...
cd /d "%~dp0"

REM 關閉佔用 3000 端口的舊進程
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

if not exist node_modules (
    echo 首次運行，安裝依賴中...
    npm install
)

npm start
pause
