"""
WorkFlow Agent — Windows Installer Build Script
Run this on a Windows machine with Python installed:
    python build_agent.py
Output: dist/WorkFlowAgent.exe
"""
import subprocess
import sys
import os

def build():
    print("=" * 50)
    print("WorkFlow Agent — Build Script")
    print("=" * 50)

    # Ensure PyInstaller is installed
    print("\nInstalling PyInstaller...")
    subprocess.run([
        sys.executable, "-m", "pip", "install", "pyinstaller", "--quiet"
    ], check=True)

    # Clean previous build
    print("Cleaning previous build...")
    if os.path.exists("dist"):
        import shutil
        shutil.rmtree("dist")
    if os.path.exists("build"):
        shutil.rmtree("build")
    if os.path.exists("WorkFlowAgent.spec"):
        os.remove("WorkFlowAgent.spec")

    # Build the executable
    print("\nBuilding executable...")
    subprocess.run([
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--noconsole",
        "--name", "WorkFlowAgent",
        "--add-data", "config.json;.",
        "--hidden-import", "pynput.keyboard._win32",
        "--hidden-import", "pynput.mouse._win32",
        "--hidden-import", "pystray._win32",
        "--hidden-import", "PIL._tkinter_finder",
        "--hidden-import", "PIL.Image",
        "--hidden-import", "pyautogui",
        "--collect-all", "pystray",
        "--collect-all", "PIL",
        "agent.py"
    ], check=True)

    print("\n" + "=" * 50)
    print("Build complete!")
    print("=" * 50)
    print("\nFiles created:")
    print("  dist/WorkFlowAgent.exe")
    print("\nDistribution package for each staff member:")
    print("  1. dist/WorkFlowAgent.exe  (same for everyone)")
    print("  2. config.json             (unique per staff — update token and staff_id)")
    print("  3. install_agent.bat       (same for everyone)")
    print("\nBefore distributing:")
    print("  Update config.json with the staff member's machine_token and staff_id")
    print("  Get these values from Admin Panel → Staff Management → Agent Token")

if __name__ == "__main__":
    build()