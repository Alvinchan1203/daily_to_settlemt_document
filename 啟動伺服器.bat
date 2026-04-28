@echo off
title 每日走袋統計伺服器
cd /d C:\Users\alvinchan\stats-app

echo ============================
echo   每日走袋統計伺服器
echo ============================
echo.

for /f "tokens=4 delims= " %%i in ('route print ^| find " 0.0.0.0"') do (
    if not "%%i"=="0.0.0.0" (
        set MY_IP=%%i
        goto :found
    )
)
:found
echo 同事請使用以下地址訪問：
echo   http://%MY_IP%:3000
echo.
echo 關閉此視窗即停止伺服器
echo ============================
echo.

node server.js

pause
