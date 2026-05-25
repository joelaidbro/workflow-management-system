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

## Current state - Phase 0 in progress

- Project skeleton created (`main.py`, `database.py`, `models.py`, `.env`, `requirements.txt`)
- Five foundation tables modelled: `companies`, `users`, `sessions`, `current_status`, `activity_logs`
- Alembic configured. Initial migration file created.
- [x] Dependencies installed (`pip install -r requirements.txt`)
- [x] Migration applied to database (`alembic upgrade head`)
- Authentication routes built (login, logout, get current user)

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
