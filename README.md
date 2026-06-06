# Workflow Management Software (Internal codename - AidBro)

CI/CD: Automated deployment via GitHub Actions on every push to main

## What this is

A Staff Monitoring and Communication SaaS platform. Multi-tenant. Built for internal company use first, then commercial product.

## Tech Stack

- Backend: Python, FastAPI, SQLAlchemy, PostgreSQL, Alembic
- Frontend: React, TailwindCSS
- Agent: Python (PyInstaller for packaging)
- Auth: JWT tokens, bcrypt password hashing

## Role hierarchy

platform_admin -> super_admin -> admin -> staff

## Project structure

```text
/backend   - FastAPI app
/frontend  - React app (not started yet)
/agent     - Background agent (not started yet)
README.md
```

## Database

PostgreSQL. Database name: `staffmonitor_dev`. ORM: SQLAlchemy. Migrations: Alembic.

## Build phases

- Phase 0 - Foundation: database schema, authentication <- CURRENT
- Phase 1 - Monitoring: background agent, live status dashboard
- Phase 2 - Alerts: pop-up alerts, acknowledgement
- Phase 3 - Chat: real-time 1-to-1 messaging
- Phase 4 - Attendance and reports: daily report submission, salary calculation
- Phase 5 - Leave management
- Phase 6 - Config layer, platform admin panel, polish

## Current state - Phase 7 in progress

### Phase 0 - Foundation Complete

- Project skeleton created
- Five foundation tables: `companies`, `users`, `sessions`, `current_status`, `activity_logs`
- Alembic configured and migration applied
- Dependencies installed
- Authentication built and tested - login, logout, `/me` routes working
- JWT httpOnly cookie authentication confirmed working
- CORS configured for React frontend

### Phase 1 - Monitoring Complete

- Background agent - heartbeat and idle detection
- `machine_tokens` table for secure agent authentication
- Heartbeat route - updates `current_status`, logs status changes only
- Offline detection background task on server
- Team status route with 2-minute staleness check
- Agent only reports active or idle - break/meeting/offline handled server side
- Screen lock detection removed - idle detection covers the use case

### Phase 2 - Alerts Complete

- `alerts` and `alert_recipients` tables created
- `POST /api/alerts/send` - direct and broadcast, info and urgent types
- `GET /api/alerts/pending` - agent polls every 15 seconds
- `POST /api/alerts/acknowledge` - agent confirms after staff clicks OK
- `GET /api/alerts/delivery-report/{alert_id}` - sender sees acknowledgement status
- Windows popup via ctypes MessageBox confirmed working
- Alert expiry handled - expired alerts not delivered
- Separate heartbeat (60s) and alert polling (15s) cycles

### Phase 3 - Chat Complete

- `messages` table created
- WebSocket connection manager built
- WebSocket `/api/chat/ws/{user_id}` - real-time messaging
- `GET /api/chat/history/{other_user_id}` - message history with pagination
- `GET /api/chat/conversations` - conversation list with unread counts
- `GET /api/auth/token` - JWT token endpoint for WebSocket auth
- Message delivery confirmed working - `new_message` and `message_sent` events
- Messages stored in database with `is_read` tracking

### Phase 4 - Attendance & Daily Reports Complete

- `daily_reports` table created
- `attendance` table created
- `salary_records` table created
- `POST /api/attendance/start-day` - staff clocks in with work mode
- `POST /api/attendance/end-day` - submits report and marks day present
- `GET /api/attendance/today` - current day status
- `GET /api/attendance/reports/my-reports` - staff views own report history
- `GET /api/attendance/reports/team` - admin views team reports
- `POST /api/attendance/reports/{id}/reply` - admin replies to report
- `GET /api/attendance/summary/{user_id}` - monthly attendance breakdown
- `GET /api/attendance/salary/{user_id}` - salary calculation with formula
- `POST /api/attendance/salary/{user_id}/approve` - super admin approves salary
- Full flow tested end to end - staff and admin roles verified

### Phase 5 - Leave Management Complete

- `leave_requests` table created
- `POST /api/leave/request` - staff submits leave with date validation and overlap check
- `GET /api/leave/my-requests` - staff views own requests with status filter
- `GET /api/leave/team-requests` - admin views team requests
- `POST /api/leave/requests/{id}/review` - admin approves or rejects
- Approved leave automatically marks attendance days as present
- Rejected leave does not affect attendance
- `GET /api/leave/balance/{user_id}` - leave balance from company config
- Full flow tested - submit, approve, reject, attendance verified

### Phase 6 - Frontend Complete

- React + Vite + TailwindCSS setup
- Token based auth (localStorage + Authorization header)
- Login page with role based redirect
- Protected routes for staff and admin
- Admin dashboard with sidebar navigation
- Team status panel - live accordion list with summary cards
- Reports panel - view, filter, reply to daily reports
- Leave requests panel - approve and reject with comments
- Alerts panel - send info and urgent alerts with recipient selector
- Chat panel - real time WebSocket messaging with conversation list
- Staff dashboard - start day, end day with report, recent reports, chat
- Staff management panel - create staff, generate agent tokens, deactivate
- Rate limiting added - login, alerts, attendance routes protected

### Phase 7 - Final Polish & Config ✅ Complete

- Config settings UI - five tabs, per company configuration
- Input focus bug fixed - separate local state per tab
- Excel team attendance export with styled headers
- PDF salary slip generation
- Export buttons in frontend - Reports panel and Staff Management
- Platform admin backend routes - companies, stats, create company
- Platform admin frontend - dark gray dashboard, overview, companies, create
- All four role levels working end to end

## Current Status: All phases complete - system ready for internal deployment

## Remaining before production deployment

- Remove all debug print statements from agent
- Environment variables review - confirm no hardcoded values
- Replace `agent/config.json` `machine_token` and `staff_id` placeholders with real values generated through the Staff Management panel before deploying to real machines
- Test full flow with real staff accounts
- Deploy backend to Hostinger VPS
- Deploy frontend build to VPS
- Install agent on office computers

## Key design decisions to always follow

- UUID for all primary keys - never integers
- Every major table has `company_id` for multi-tenant isolation
- Never raw SQL - always SQLAlchemy ORM
- Never hardcode secrets - always use `.env`
- One task at a time - do not add unrequested features

## Pending decisions / known limitations

- Mac agent support deferred - Windows only for now
- Group chat deferred to future version
- File attachments in chat deferred to future version
- Code signing certificate needed before external deployment
