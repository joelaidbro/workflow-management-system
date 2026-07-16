@echo off
echo ========================================
echo    WorkFlow Agent Installer
echo ========================================
echo.

REM Check for administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Please run this file as Administrator
    echo Right-click install_agent.bat and select "Run as administrator"
    pause
    exit /b 1
)

cd /d "%~dp0"

REM Set installation directory
set INSTALL_DIR=%PROGRAMDATA%\WorkFlowAgent

echo Installing to: %INSTALL_DIR%
echo.

REM Create installation directory
mkdir "%INSTALL_DIR%" 2>nul

REM Grant Modify permission to all standard users
icacls "%INSTALL_DIR%" /grant *S-1-5-32-545:(OI)(CI)M /T >nul

REM Copy files
echo Copying agent files...
copy /Y "%~dp0WorkFlowAgent.exe" "%INSTALL_DIR%\WorkFlowAgent.exe"
echo Batch file location: %~dp0
echo Current directory: %CD%

if errorlevel 1 (
    echo ERROR: Could not copy WorkFlowAgent.exe
    echo Make sure WorkFlowAgent.exe is in the same folder as this installer
    pause
    exit /b 1
)

REM Add to Windows startup (runs automatically on boot)
echo Adding to Windows startup...
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" /v "WorkFlowAgent" /t REG_SZ /d "\"%INSTALL_DIR%\WorkFlowAgent.exe\"" /f

if errorlevel 1 (
    echo WARNING: Could not add to startup. Agent will not start automatically on boot.
) else (
    echo Agent added to Windows startup successfully.
)

echo.
echo ========================================
echo    Installation Complete
echo ========================================
echo.
echo The WorkFlow Agent has been installed.
echo It will start automatically when Windows boots.
echo Starting agent now...
echo.

REM Start the agent immediately
start "" "%INSTALL_DIR%\WorkFlowAgent.exe"

echo Agent started. You can close this window.
echo.
pause