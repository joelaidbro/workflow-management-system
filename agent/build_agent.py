"""
WorkFlow Agent — Windows Installer Build Script
Run this on a Windows machine with Python installed:
    python build_agent.py
Output: dist/WorkFlowAgent_{version}.exe
"""
import os
import shutil
import subprocess
import sys


def build():
    print("=" * 50)
    print("WorkFlow Agent — Build Script")
    print("=" * 50)

    with open("version.txt", "r", encoding="utf-8") as f:
        version = f.read().strip()

    exe_name = f"WorkFlowAgent_{version}"
    print(f"\nVersion : {version}")
    print(f"Output  : dist/{exe_name}.exe")

    print("\nInstalling PyInstaller...")
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "pyinstaller", "--quiet"],
        check=True,
    )

    # Only clean intermediate build artifacts.
    # dist/ is intentionally kept so previous version exes accumulate.
    print("Cleaning build artifacts...")
    if os.path.exists("build"):
        shutil.rmtree("build")
    spec_file = f"{exe_name}.spec"
    if os.path.exists(spec_file):
        os.remove(spec_file)

    print(f"\nBuilding {exe_name}.exe ...")
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller",
            "--onefile",
            "--noconsole",
            "--name", exe_name,
            "--hidden-import", "pynput.keyboard._win32",
            "--hidden-import", "pynput.mouse._win32",
            "--hidden-import", "pystray._win32",
            "--hidden-import", "PIL._tkinter_finder",
            "--hidden-import", "PIL.Image",
            "--hidden-import", "pyautogui",
            "--collect-all", "pystray",
            "--collect-all", "PIL",
            "agent.py",
        ],
        check=True,
    )

    print("\n" + "=" * 50)
    print("Build complete!")
    print("=" * 50)
    print(f"\nNew file : dist/{exe_name}.exe")
    print("\nBefore committing a new release:")
    print("  1. Bump AGENT_VERSION in agent.py")
    print("  2. Update version.txt to match")
    print("  3. Make sure install_agent.bat and uninstall_agent.bat are in dist/")
    print("  4. git add agent/dist/ agent/version.txt agent/agent.py")
    print("  5. Commit and push")
    print("     CI/CD will copy the versioned exe to the public downloads folder")
    print("     and update agent_release.json automatically")


if __name__ == "__main__":
    build()
