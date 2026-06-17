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
5. Copy the machine_token and staff_id

### Step 2 — Prepare installation files
You need three files in the same folder:
- WorkFlowAgent.exe (built by developer)
- config.json (updated with staff member's token)
- install_agent.bat

Update config.json with the staff member's values:
```json
{
    "server_url": "https://teams.aidbro.com:8001",
    "machine_token": "PASTE_TOKEN_HERE",
    "staff_id": "PASTE_STAFF_ID_HERE"
}