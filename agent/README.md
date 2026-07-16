# WorkFlow Agent

Background monitoring agent for the WorkFlow staff monitoring system.
Runs silently on Windows PCs and reports staff activity to the server.

## What it does
- Sends heartbeat to server every 60 seconds
- Detects idle time (no mouse/keyboard activity for 10 minutes)
- Checks for alerts from admin every 15 seconds
- Shows popup alerts that must be acknowledged
- Runs automatically on Windows startup

## Setup for each staff member

### Step 1 — Generate token in admin panel
1. Log into the WorkFlow admin dashboard
2. Go to Staff Management
3. Find the staff member
4. Click "Agent Token"
5. Copy the **Machine Token** and **Staff ID** — send these to the staff member (email, WhatsApp, etc.)

### Step 2 — Send the installation package
Give the staff member two files (same for everyone — no per-person editing needed):
- `WorkFlowAgent.exe`
- `install_agent.bat`

### Step 3 — Staff installs and sets up
1. Staff right-clicks `install_agent.bat` → **Run as administrator**
2. The agent installs and opens automatically
3. A **First Time Setup** window appears asking for Machine Token and Staff ID
4. Staff pastes the values you sent them, clicks **Connect & Save**
5. The agent verifies the credentials and starts monitoring