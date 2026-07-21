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
5. Click **Download Setup Card** — this generates a short-lived, single-use
   **Setup Code** (not the raw permanent token) and downloads a small HTML
   card with the code, a one-click Copy Code button, and a single download
   link. Send this card file to the staff member. The setup code expires
   after 24 hours or first use, whichever comes first, so nothing sensitive
   lingers if the card is forwarded or saved.

### Step 2 — Send the installation package
Staff only need **one file**: `install_agent.bat`. It's a self-contained
bootstrapper — when run, it downloads `WorkFlowAgent.exe` and
`uninstall_agent.bat` from the server automatically, so there's nothing
else to distribute. (If `WorkFlowAgent.exe` happens to already be sitting
next to the installer, it uses that copy instead of downloading.)

### Step 3 — Staff installs and sets up
1. Staff opens the setup card and clicks its one download link to get
   `install_agent.bat`
2. Right-clicks it → **Run as administrator** — it fetches the agent and
   uninstaller and installs everything by itself
3. A **First Time Setup** window appears asking for the **Setup Code**
4. Staff copies the code from the setup card (Copy Code button) and pastes
   it in, then clicks **Connect & Save**
5. The agent exchanges the code for the real credentials and starts monitoring

If a setup code has expired or was already used, generating a new agent
token (or clicking "Regenerate Token") issues a fresh one. For support
cases, the wizard also has a "Use manual token entry instead" link that
accepts the raw Machine Token + Staff ID directly.