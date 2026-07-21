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
set DOWNLOAD_BASE=https://teams.aidbro.com/downloads

echo Installing to: %INSTALL_DIR%
echo.

REM Create installation directory
mkdir "%INSTALL_DIR%" 2>nul

REM Grant Modify permission to all standard users
icacls "%INSTALL_DIR%" /grant *S-1-5-32-545:(OI)(CI)M /T >nul

REM Get the agent executable — use a local copy if one was placed next to
REM this installer, otherwise fetch it. This lets a single install_agent.bat
REM be the only file staff need to download.
if exist "%~dp0WorkFlowAgent.exe" (
    echo Using WorkFlowAgent.exe found next to this installer...
    copy /Y "%~dp0WorkFlowAgent.exe" "%INSTALL_DIR%\WorkFlowAgent.exe" >nul
) else (
    echo Downloading WorkFlow Agent...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri '%DOWNLOAD_BASE%/WorkFlowAgent.exe' -OutFile '%INSTALL_DIR%\WorkFlowAgent.exe' -UseBasicParsing } catch { exit 1 }"
)

if not exist "%INSTALL_DIR%\WorkFlowAgent.exe" (
    echo ERROR: Could not obtain WorkFlowAgent.exe.
    echo Check your internet connection and try again.
    pause
    exit /b 1
)

REM Fetch the uninstaller too, so it's available later without re-downloading
echo Fetching uninstaller for future use...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Uri '%DOWNLOAD_BASE%/uninstall_agent.bat' -OutFile '%INSTALL_DIR%\uninstall_agent.bat' -UseBasicParsing } catch { }"

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
