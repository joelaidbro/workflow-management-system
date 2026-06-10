# WorkFlow Management System — Complete Project Memory Document

---

## Executive Summary

A Staff Monitoring and Communication SaaS platform built by a solo developer (Joel, from Tellicherry, Kerala, India) for a company called AidBro. The system monitors staff activity, enables real-time communication, tracks attendance, manages leave, and calculates salaries. Built first for internal use (10-15 staff), designed to scale as a commercial SaaS product.

**Live URL:** `https://teams.aidbro.com`
**GitHub:** Private repository (joelaidbro/workflow-management-system)
**Developer contact:** libin.reals@gmail.com (team email seen in vHost config)

---

## Complete System Architecture

### Tech Stack
- **Backend:** Python 3.12.3, FastAPI, SQLAlchemy ORM, PostgreSQL 16, Alembic migrations, Gunicorn with UvicornWorker
- **Frontend:** React + Vite, TailwindCSS, Axios, React Router, Socket.io client, react-hot-toast
- **Agent:** Python, pynput (idle detection), PyInstaller (packaging), requests
- **Server:** Hostinger VPS, Ubuntu 24.04 LTS, IP 187.127.155.96, 2GB RAM
- **Web server:** CyberPanel with OpenLiteSpeed
- **CI/CD:** GitHub Actions (appleboy/ssh-action)
- **SSL:** Let's Encrypt via CyberPanel

### Server Structure
```
/home/teams.aidbro.com/
    public_html/          ← React build (served by OpenLiteSpeed)
    logs/                 ← CyberPanel logs
    workflow/             ← Project root
        backend/          ← FastAPI app
        frontend/         ← React source
        agent/            ← Background agent
```

### Port Configuration
- Port 80/443: OpenLiteSpeed serving frontend
- Port 8001: Gunicorn/FastAPI backend (SSL enabled directly)
- Port 8000: Taken by existing website on VPS — DO NOT USE
- Frontend calls API at `https://teams.aidbro.com:8001`

### Key Architecture Decisions
- SaaS multi-tenant — every DB record has `company_id`
- Backend serves on port 8001 with SSL certificates directly (not proxied through OpenLiteSpeed — proxy attempts failed)
- Auth uses JWT in localStorage + Authorization Bearer header (not httpOnly cookies — CORS issues with cross-origin on different ports)
- Agent uses machine token for authentication (not session-based)
- WebSocket for real-time chat
- Separate `current_status` table (fast reads) from `activity_logs` table (historical, append-only)

---

## Database Schema (Complete)

### Tables

**companies**
- id (UUID PK), name (String 255), config (JSON), is_active (Boolean), created_at (DateTime)

**users**
- id (UUID PK), company_id (FK), employee_id (String 50), full_name (String 255), email (String 255), phone (String 20), department (String 100), job_title (String 100), role (String 20: staff/admin/super_admin/platform_admin), work_type (String 10: wfh/office), password_hash (String 255), is_active (Boolean), joining_date (DateTime), created_at (DateTime), base_salary (Numeric 10,2)

**sessions**
- id (UUID PK), user_id (FK), token (String 255 unique), created_at (DateTime), expires_at (DateTime), is_active (Boolean)

**current_status**
- user_id (UUID PK + FK), status (String 20), updated_at (DateTime), machine_id (String 255), today_work_mode (String 10), break_started_at (DateTime)

**activity_logs**
- id (UUID PK), company_id (FK), user_id (FK), status (String 20), timestamp (DateTime), machine_id (String 255)
- Index: compound on company_id + user_id + timestamp

**machine_tokens**
- id (UUID PK), company_id (FK), user_id (FK unique), token (String 255 unique), is_active (Boolean), created_at (DateTime)

**alerts**
- id (UUID PK), company_id (FK), sender_id (FK), recipient_id (FK nullable), alert_type (String 10: info/urgent), message (Text), created_at (DateTime), expires_at (DateTime)

**alert_recipients**
- id (UUID PK), alert_id (FK), recipient_id (FK), status (String 20: pending/acknowledged/expired), acknowledged_at (DateTime), reply (Text)

**messages**
- id (UUID PK), company_id (FK), sender_id (FK), recipient_id (FK), content (Text), is_read (Boolean), created_at (DateTime)

**daily_reports**
- id (UUID PK), company_id (FK), user_id (FK), report_date (Date), content (Text), submitted_at (DateTime), admin_reply (Text), admin_reply_at (DateTime), replied_by (FK), is_read_by_admin (Boolean)
- Unique constraint: user_id + report_date

**attendance**
- id (UUID PK), company_id (FK), user_id (FK), date (Date), logged_in (Boolean), report_submitted (Boolean), is_present (Boolean), work_mode (String 10), login_time (DateTime), logout_time (DateTime), working_minutes (Integer), break_minutes (Integer), meeting_minutes (Integer)
- Unique constraint: user_id + date

**salary_records**
- id (UUID PK), company_id (FK), user_id (FK), month (Integer), year (Integer), base_salary (Numeric), calculated_salary (Numeric), final_salary (Numeric), is_approved (Boolean), approved_by (FK), approved_at (DateTime)
- Unique constraint: user_id + month + year

**leave_requests**
- id (UUID PK), company_id (FK), user_id (FK), leave_type (String 50), start_date (Date), end_date (Date), total_days (Integer), reason (Text), status (String 20: pending/approved/rejected), reviewed_by (FK), reviewed_at (DateTime), admin_comment (Text), created_at (DateTime)

### Key Indexes
- activity_logs: compound (company_id, user_id, timestamp)
- users: company_id
- sessions: token
- machine_tokens: token
- alert_recipients: (alert_id, recipient_id) and (recipient_id, status)
- messages: (company_id, sender_id, recipient_id) and (recipient_id, is_read)

---

## Role Hierarchy (4 Layers)

```
Platform Admin (your team — AidBro developers)
    ↓
Super Admin (company CEO — full company control)
    ↓
Admin (Manager/HR — sees assigned team only)
    ↓
Staff (regular employees)
```

### Permission Summary
- Platform Admin: manages all companies, subscriptions, can log into any company
- Super Admin: creates all accounts, sets config, approves salary, views all data
- Admin: monitors team, reviews reports, approves leave, sends alerts to team
- Staff: logs in, works, chats, submits reports, requests leave

---

## API Routes (Complete)

### Auth (`/api/auth/`)
- POST /login — returns user data + access_token in body
- POST /logout
- GET /me
- GET /token — returns JWT for WebSocket auth

### Agent (`/api/agent/`)
- POST /heartbeat — machine_token auth, updates current_status
- POST /verify — validates machine token

### Status (`/api/status/`)
- GET /team — live team status (admin only)
- GET /user/{user_id}
- POST /break/start
- POST /break/end
- POST /meeting/start
- POST /meeting/end
- POST /meeting/set-team

### Alerts (`/api/alerts/`)
- POST /send
- GET /pending — agent polls this
- POST /acknowledge
- GET /delivery-report/{alert_id}

### Chat (`/api/chat/`)
- WebSocket /ws/{user_id}
- GET /history/{other_user_id}
- GET /conversations

### Attendance (`/api/attendance/`)
- POST /start-day
- POST /end-day
- GET /today
- GET /reports/my-reports
- GET /reports/team
- POST /reports/{report_id}/reply
- GET /summary/{user_id}
- GET /salary/{user_id}
- POST /salary/{user_id}/approve
- GET /export/team-excel
- GET /export/salary-slip/{user_id}

### Leave (`/api/leave/`)
- POST /request
- GET /my-requests
- GET /team-requests
- POST /requests/{request_id}/review
- GET /balance/{user_id}

### Users (`/api/users/`)
- POST /create
- GET /list
- PATCH /{user_id}
- POST /{user_id}/deactivate
- POST /{user_id}/generate-agent-token
- GET /{user_id}/agent-token-status

### Settings (`/api/settings/`)
- GET /config
- PATCH /config
- POST /leave-types
- DELETE /leave-types/{name}

### Platform (`/api/platform/`)
- GET /companies
- POST /companies
- PATCH /companies/{company_id}
- GET /companies/{company_id}/users
- GET /stats

### Health
- GET /health — returns {"status": "ok"}

---

## Frontend Structure

### Pages
- `/login` → LoginPage.jsx
- `/staff` → StaffDashboard.jsx (role: staff)
- `/admin` → AdminDashboard.jsx (role: admin, super_admin, platform_admin)
- `/platform` → PlatformDashboard.jsx (role: platform_admin)

### AdminDashboard Sections (sidebar)
- Dashboard → TeamStatusPanel
- Staff → StaffManagementPanel
- Reports → ReportsPanel
- Leave Requests → LeavePanel
- Alerts → AlertsPanel
- Chat → ChatPanel
- Settings → SettingsPanel (super_admin only)

### Auth Flow
- Login returns access_token in response body
- Token stored in localStorage as 'access_token'
- User info stored in localStorage as 'user' (JSON)
- Every axios request sends `Authorization: Bearer {token}` header
- ProtectedRoute calls /api/auth/me to verify token on route change
- Cookies NOT used for cross-origin auth (CORS limitation)

---

## Background Agent

### Location
`/agent/agent.py`

### How it works
- Reads config from `agent/config.json`
- config.json structure: `{"server_url": "https://teams.aidbro.com:8001", "machine_token": "...", "staff_id": "..."}`
- Checks alerts every 15 seconds, sends heartbeat every 60 seconds
- Detects idle via pynput (mouse/keyboard activity)
- Idle threshold: 10 minutes = 600 seconds
- Reports only "active" or "idle" — break/meeting/offline handled server-side
- Screen lock detection was removed — unreliable across Windows environments
- Uses ctypes MessageBox for Windows popup alerts
- Alert popup blocks until staff clicks OK, then sends acknowledgement

### Agent Status Flow
- active → idle (after 10 min no activity)
- active/idle → break (staff clicks Start Break in web UI)
- active/idle → meeting (staff or admin triggers meeting)
- break → auto-logout (after 1 hour break)
- any → offline (server detects missing heartbeat after 2 min)

### Packaging (planned)
- PyInstaller to build .exe
- `agent/build_agent.py` — build script
- `agent/install_agent.bat` — Windows installer with startup registry entry

---

## Deployment Configuration

### Production Files
- `backend/gunicorn.prod.conf.py` — NOT used currently
- `backend/gunicorn.conf.py` — PRODUCTION config (in .gitignore, managed directly on server)
  - bind = "0.0.0.0:8001"
  - SSL keyfile/certfile = /etc/letsencrypt/live/teams.aidbro.com/
  - workers = 2, worker_class = uvicorn.workers.UvicornWorker
- `backend/gunicorn.dev.conf.py` — local development config
  - bind = "127.0.0.1:8000", no SSL
- `workflowapp.service` — systemd service, User=root, Group=root
- `.github/workflows/deploy.yml` — CI/CD via appleboy/ssh-action

### GitHub Secrets Required
- VPS_HOST: 187.127.155.96
- VPS_USERNAME: root
- VPS_SSH_KEY: private SSH key
- VPS_PORT: 22

### CI/CD Flow
Push to main → GitHub Actions → SSH to VPS → git pull → pip install → alembic upgrade → systemctl restart workflowapp → npm build → cp to public_html

### .htaccess (in public_html — NOT in git repo)
```apache
Options -MultiViews
RewriteEngine On
RewriteCond %{REQUEST_URI} !^/api
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ /index.html [L]
```

### Database
- Production DB: staffmonitor_prod
- DB User: workflowapp
- Located: localhost PostgreSQL 16
- Migrations: Alembic, all applied

### Backend .env (production — never in git)
```
DATABASE_URL=postgresql://workflowapp:Aidbroaiadmin@localhost:5432/staffmonitor_prod
SECRET_KEY=[64 char hex — shorter than 72 bytes critical]
ALLOWED_ORIGINS=https://teams.aidbro.com
```

### Frontend .env (production — never in git)
```
VITE_API_URL=https://teams.aidbro.com:8001
```

---

## Known Issues and Bugs

### Critical — Fixed
1. bcrypt error — SECRET_KEY must be under 72 bytes. Current key is correct length.
2. gunicorn.conf.py conflict with git — solved by adding to .gitignore
3. Machine token duplicate on regenerate — fixed with update-or-insert logic
4. CORS cookies not working cross-origin — solved by switching to localStorage + Bearer token

### Active Bug Being Fixed Right Now
**`formatDate is not defined`** in StaffManagementPanel (AdminDashboard.jsx line 1687)
- Fix: Add `formatDate` helper function to StaffManagementPanel component
- Status: Fix prompt written, NOT YET COMMITTED OR PUSHED

### Known Limitations
- Screen lock detection removed — too unreliable on Windows
- Mac agent support deferred — Windows only
- OpenLiteSpeed proxy to backend doesn't work — backend runs directly on port 8001 with SSL instead
- WebSocket through production domain not yet tested end to end
- Group chat deferred to future version
- File attachments in chat deferred

### Technical Debt
- break/meeting backend routes built but not yet pushed to git (committed locally as "Add break and meeting status controls" — needs push)
- Agent token UI fix (formatDate) not yet pushed
- These two commits need to be pushed together

---

## Config Layer (Per-Company Settings)

All stored as JSON in `companies.config`. Default values:
```json
{
  "idle_timeout_minutes": 10,
  "break_limit_minutes": 60,
  "log_retention_months": 6,
  "failed_login_lockout_attempts": 5,
  "lockout_duration_minutes": 30,
  "password_min_length": 8,
  "working_hours_start": "09:00",
  "working_hours_end": "18:00",
  "working_days": ["monday","tuesday","wednesday","thursday","friday"],
  "alert_expiry_minutes": 120,
  "alert_sound_enabled": true,
  "push_notifications_enabled": false,
  "chat_enabled": true,
  "staff_to_staff_chat_enabled": true,
  "chat_visibility": "full",
  "read_receipts_enabled": true,
  "chat_retention_months": 6,
  "attendance_rule": "login_and_report",
  "working_days_per_month": 22,
  "salary_visibility_to_staff": false,
  "currency_symbol": "₹",
  "daily_report_enabled": true,
  "report_deadline_time": "21:00",
  "report_retention_months": 6,
  "leave_types": [],
  "half_day_leave_enabled": false,
  "leave_carry_forward": false,
  "heartbeat_frequency_seconds": 60,
  "offline_grace_period_minutes": 2,
  "working_days_definition": ["monday","tuesday","wednesday","thursday","friday"],
  "public_holidays": [],
  "chat_message_retention_months": 6,
  "minimum_working_hours_for_present": 0,
  "late_login_threshold": "09:15",
  "overtime_enabled": false,
  "currency_symbol": "₹",
  "max_consecutive_leave_days": 30,
  "min_leave_advance_notice_days": 0,
  "leave_balance_reset": "january",
  "report_submission_deadline": "21:00",
  "report_deadline_cutoff_time": "05:00"
}
```

---

## Salary Calculation Formula

`calculated_salary = (base_salary / total_working_days_in_month) × days_present`

- Days present = days where BOTH login AND End Day report submitted
- Approved leave days count as present
- Report cutoff time: 5:00 AM (configurable) — reports before 5 AM count for previous day
- Partial month (new joiner): salary calculated from joining date
- Month end: auto-calculated, admin can edit, super_admin gives final approval

---

## Completed Work (Full List)

### Backend ✅
- Database schema (13 tables)
- Authentication (login/logout/me/token)
- Machine token agent auth
- Heartbeat route
- Offline detection background task
- Team status route with staleness check
- Alert send/acknowledge/delivery-report routes
- Alert pending polling route
- WebSocket chat (connect/message/history/conversations)
- Attendance start-day/end-day routes
- Daily reports (submit/team view/reply)
- Salary calculation and approval
- Excel and PDF export
- Leave management (request/review/balance)
- User management (create/list/update/deactivate/token)
- Settings/config routes
- Platform admin routes
- Break/meeting status routes (committed, needs push)
- Rate limiting (slowapi)
- Agent token status route

### Frontend ✅
- Login page with role-based redirect
- Protected routes
- Admin dashboard with all panels
- TeamStatusPanel (live accordion)
- ReportsPanel (view/filter/reply)
- LeavePanel (approve/reject)
- AlertsPanel (send info/urgent)
- ChatPanel (WebSocket real-time)
- StaffManagementPanel (create/deactivate/token)
- SettingsPanel (5 tabs, per-company config)
- PlatformDashboard (overview/companies/create)
- StaffDashboard (start day/end day/reports/chat)
- Break/meeting buttons (committed, needs push, formatDate bug fix pending)
- Agent token modal with copy buttons (formatDate bug fix pending)

### Agent ✅
- Heartbeat loop (15s alert check, 60s heartbeat)
- Idle detection via pynput
- Alert polling and Windows popup
- Machine token authentication
- config.json based configuration

### Infrastructure ✅
- Production deployed on Hostinger VPS
- SSL via Let's Encrypt
- Systemd service (auto-restart)
- GitHub Actions CI/CD
- Weekly backup via Hostinger

---

## Outstanding Work

### Immediate (fix and push now)
1. **formatDate bug fix** — AdminDashboard.jsx StaffManagementPanel
2. **Push pending commits** — break/meeting routes + agent token UI

### Group 1 — Critical for daily use
3. WFH daily check-in prompt at login (currently not implemented in UI)
4. Agent packaged as .exe with installer batch file
5. WebSocket tested through production domain (https://teams.aidbro.com:8001)
6. First login consent checkbox

### Group 2 — Important
7. View Profile button working (currently shows alert "Coming soon")
8. Staff salary slip download in staff UI
9. Delivery report list in alerts panel
10. Attendance dispute / raise concern button
11. Admin set meeting status for team UI

### Group 3 — Nice to have
12. Auto-start on Windows boot (registry entry in installer)
13. Agent auto-update mechanism
14. Mobile admin status view improvements
15. Support message thread UI (platform admin ↔ company super admin)
16. Billing/subscription panel (product phase)

### Future / Product Phase
17. Group chat
18. File attachments in chat
19. Self-service company signup
20. Subdomain per company option
21. Code signing certificate for agent
22. CI/CD improvements
23. Redis caching for scale
24. API layer for integrations
25. Mac agent support

---

## Production Users (Test Data)

### Platform Admin
- Email: joel.aidbro@gmail.com
- Role: platform_admin
- Company: AidBro (id: 08f92e34-7993-4de3-984e-177a9963626b)
- User ID: 203cdaca-d84d-4eef-ac95-2db145ad1a75

### Development Test Users (local DB only)
- admin@testcompany.com / Test@1234 (super_admin)
- staff@testcompany.com / Staff@1234 (staff, EMP-002)
- platform@workflowapp.com / Platform@1234 (platform_admin)
- Company ID: 55c8189e-84a9-4bfd-94c9-591cb0a224e8
- Staff ID: e63cfa57-6780-43e4-8d97-10af168f55d3

---

## Developer Profile and Preferences

- **Name:** Joel
- **Location:** Tellicherry, Kerala, India
- **Experience:** Intermediate — comfortable with Python backend, React frontend, PostgreSQL, Git. Not expert level but learns quickly.
- **Tool:** Using Codex (AI coding assistant) to write code based on detailed prompts
- **Workflow:** Claude provides detailed prompts → Joel pastes into Codex → reviews output → comes back to Claude for verification and next steps
- **Preferences:**
  - Prefers explanations of what each prompt does
  - Wants to understand concepts, not just copy-paste
  - Prefers building feature by feature rather than all at once
  - Prefers practical solutions over theoretically perfect ones
  - Values honesty about difficulty and tradeoffs
  - Does not want over-complex solutions for small team needs

---

## Important Lessons Learned

1. **OpenLiteSpeed proxy is unreliable via vHost config** — after many attempts, solution was to run backend directly on port 8001 with SSL, bypassing proxy entirely
2. **SECRET_KEY must be under 72 bytes** — bcrypt limitation through passlib. Use `secrets.token_hex(32)` (64 chars), not token_hex(64)
3. **httpOnly cookies don't work cross-origin on different ports** — switched to localStorage + Bearer token
4. **gunicorn.conf.py must be in .gitignore** — production has SSL lines that differ from local dev
5. **agent only reports active/idle** — break/meeting/offline are web-controlled statuses
6. **Screen lock detection unreliable on Windows** — removed entirely, idle detection covers the use case
7. **Machine token is permanent credential** — used every heartbeat, not just installation
8. **company_id on activity_logs** — critical for query performance, avoids joins on large tables
9. **Separate current_status and activity_logs tables** — dashboard reads current_status (tiny, fast), reports read activity_logs (large, indexed)
10. **PyInstaller agent needs --noconsole** — runs silently on staff PCs

---

## Compressed Context

**Project:** WorkFlow — staff monitoring SaaS. Solo dev Joel (Kerala, India). Stack: FastAPI+PostgreSQL+React+Python agent. Live at https://teams.aidbro.com (Hostinger VPS Ubuntu 24.04, CyberPanel/OpenLiteSpeed). Backend port 8001 SSL direct (proxy failed). Frontend port 443 via OLS. CI/CD via GitHub Actions.

**Auth:** JWT in localStorage, Bearer header (not cookies — CORS issues). 4 roles: platform_admin→super_admin→admin→staff. Multi-tenant via company_id on all tables.

**13 DB tables:** companies, users, sessions, current_status, activity_logs, machine_tokens, alerts, alert_recipients, messages, daily_reports, attendance, salary_records, leave_requests.

**Agent:** Python, pynput idle detection, 15s alert poll/60s heartbeat, ctypes MessageBox popup, machine_token auth, reports only active/idle.

**CRITICAL BUGS PENDING:**
1. formatDate undefined in AdminDashboard.jsx:1687 StaffManagementPanel — fix: add formatDate helper function to component
2. Two commits need pushing: "Add break and meeting status controls" + agent token UI fix

**Production DB creds:** postgresql://workflowapp:Aidbroaiadmin@localhost:5432/staffmonitor_prod. SECRET_KEY must be <72 bytes. ALLOWED_ORIGINS=https://teams.aidbro.com.

**gunicorn.conf.py in .gitignore** — production has SSL lines (bind 0.0.0.0:8001 + keyfile/certfile letsencrypt). Local uses gunicorn.dev.conf.py (bind 127.0.0.1:8000, no SSL).

**Next actions in order:**
1. Fix formatDate bug → push all pending commits
2. WFH daily check-in UI at login
3. Package agent as .exe with install_agent.bat
4. Test WebSocket on production
5. First login consent checkbox
6. View Profile button
7. Staff salary slip download
8. Delivery report list in alerts panel

**Codex workflow:** Claude writes detailed prompts → Joel pastes to Codex → verifies output → Claude reviews → next prompt. Always add "what this does" explanation after each prompt per Joel's preference.