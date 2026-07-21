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

### Security warning on first install
Because `install_agent.bat` is downloaded from a browser, Windows may show
a one-time warning before allowing it to run (Mark of the Web) — e.g.
"These files can't be opened" or "Windows protected your PC". This is
normal for any newly downloaded script/executable and is not specific to
this agent. The setup card includes instructions for staff:
right-click `install_agent.bat` → **Properties** → check **Unblock** →
**OK**, then try **Run as administrator** again. This only needs to happen
once per machine — auto-updates afterward are downloaded directly by the
running agent process (not through a browser), so they never trigger this
warning.

### Uninstalling
`install_agent.bat` automatically saves `uninstall_agent.bat` into
`%PROGRAMDATA%\WorkFlowAgent\` during install. To remove the agent later,
open that folder, right-click `uninstall_agent.bat`, and choose **Run as
administrator**. This is also documented on the setup card so staff (or
IT) can find it without contacting an admin.