"""
Build script for WorkFlow Agent Windows installer.
Run this on a Windows machine:
    python build_agent.py
Output: dist/WorkFlowAgent.exe
"""
import subprocess
import sys
import os

def build():
    print("Building WorkFlow Agent...")

    # Ensure PyInstaller is installed
    subprocess.run([
        sys.executable, "-m", "pip", "install", "pyinstaller"
    ], check=True)

    # Build the executable
    subprocess.run([
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--noconsole",
        "--name", "WorkFlowAgent",
        "--add-data", "config.json;.",
        "--hidden-import", "pynput.keyboard._win32",
        "--hidden-import", "pynput.mouse._win32",
        "agent.py"
    ], check=True)

    print("\nBuild complete!")
    print("Find WorkFlowAgent.exe in the dist/ folder")
    print("\nBefore distributing:")
    print("1. Update dist/config.json with the staff member's token and staff_id")
    print("2. Run install_agent.bat as Administrator on the target PC")

if __name__ == "__main__":
    build()