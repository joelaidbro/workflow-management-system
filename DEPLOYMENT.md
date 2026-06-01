# Deployment Guide - WorkFlow App

## Server: Hostinger VPS - Ubuntu 24.04

## Panel: CyberPanel with OpenLiteSpeed

## Domain: teams.aidbro.com

## Server Requirements Already Met

- Python 3.12.3 ✓
- PostgreSQL ✓
- Node.js ✓
- OpenLiteSpeed via CyberPanel ✓

## Project Location on Server

```text
/home/teams.aidbro.com/workflow/
  backend/
  frontend/
  agent/
```

## First Time Deployment Steps

See deployment steps in conversation history.

## Updating After Code Changes

```bash
cd /home/teams.aidbro.com/workflow
git pull
chmod +x deploy.sh
bash deploy.sh
```

## Service Management

```bash
sudo systemctl restart workflowapp    # Restart backend
sudo systemctl status workflowapp     # Check status
journalctl -u workflowapp -f          # Live logs
```

## Log Locations

```text
/var/log/workflowapp/access.log
/var/log/workflowapp/error.log
```
