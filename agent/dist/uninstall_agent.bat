@echo off
echo ========================================
echo    WorkFlow Agent Uninstaller
echo ========================================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Please run as Administrator
    pause
    exit /b 1
)

REM Stop the running agent
echo Stopping WorkFlow Agent...
taskkill /F /IM WorkFlowAgent.exe 2>nul

REM Remove from startup
echo Removing from Windows startup...
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" /v "WorkFlowAgent" /f 2>nul

REM Delete installation folder
echo Removing installation files...
rmdir /S /Q "%PROGRAMDATA%\WorkFlowAgent" 2>nul

echo.
echo WorkFlow Agent has been uninstalled successfully.
pause