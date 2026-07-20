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
5. Click **Open Setup Card** — this generates a short-lived, single-use
   **Setup Code** (not the raw permanent token) and opens a printable/downloadable
   card with the code, download links, and instructions. Send this card to the
   staff member. The setup code expires after 24 hours or first use, whichever
   comes first, so nothing sensitive lingers if the card is forwarded or saved.

### Step 2 — Send the installation package
The setup card links to all the files needed (same for everyone — no per-person editing needed):
- `WorkFlowAgent.exe`
- `install_agent.bat`
- `uninstall_agent.bat`

### Step 3 — Staff installs and sets up
1. Staff right-clicks `install_agent.bat` → **Run as administrator**
2. The agent installs and opens automatically
3. A **First Time Setup** window appears asking for the **Setup Code**
4. Staff pastes the code from the setup card, clicks **Connect & Save**
5. The agent exchanges the code for the real credentials and starts monitoring

If a setup code has expired or was already used, generating a new agent
token (or clicking "Regenerate Token") issues a fresh one. For support
cases, the wizard also has a "Use manual token entry instead" link that
accepts the raw Machine Token + Staff ID directly.