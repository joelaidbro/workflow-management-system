# Workflow Management Software (Internal codename - AidBro)

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

## Current state - Phase 4 in progress

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

### Phase 4 - Attendance & Daily Reports In progress

- Daily reports table
- End day logout with report submission
- Admin report review and reply
- Attendance calculation per staff per month
- Salary calculation route

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
