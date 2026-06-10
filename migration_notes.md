# Hidden Knowledge Extraction — WorkFlow Project

---

## 1. Hidden Assumptions

- **The agent config.json is manually edited per staff member** — there is no automated config generation. IT physically edits the file before running the installer. The "install_url" returned by the API is never actually used programmatically — it was designed but never wired up.

- **The production platform admin account uses Joel's personal email** (joel.aidbro@gmail.com) not a company admin email. This is a security concern for production.

- **The local development database still has test data** from building — test users, test alerts, test attendance records. These are in the local PostgreSQL instance, not production. Production database is clean except for the platform admin user.

- **bcrypt==4.0.1 was manually installed on the VPS** but may not be in requirements.txt correctly. The production venv has this version but if a fresh deployment happens, it might install a newer incompatible version again. Verify requirements.txt has `bcrypt==4.0.1` pinned exactly.

- **The offline detection background task** runs every 60 seconds and marks staff offline after 2 minutes of no heartbeat. This means there is up to a 3-minute delay before admin sees someone as offline. This was accepted but never explicitly documented as a known delay.

- **Chat monitoring notice** ("Messages on this platform may be monitored") is in the chat UI but the actual backend visibility setting defaults to "full" — all messages are readable by admin. This was a deliberate decision for AidBro's use case but other companies using the product may not realize this is the default.

- **The attendance "present" rule requires BOTH login AND End Day report** — a staff member who logs in but does a regular logout (not End Day) is NOT counted as present for that day. This is easy to miss and will confuse staff initially.

- **Report cutoff at 5:00 AM** — a report submitted at 4:59 AM counts for the previous day. This is configurable but the default is 5 AM. The config key is `report_deadline_cutoff_time`.

- **The WFH daily check-in is only for WFH-designated staff** — office staff never see this prompt. The `work_type` column on the user determines this, not a daily setting.

- **salary_visibility_to_staff defaults to false** — staff cannot see their own calculated salary. This was a deliberate AidBro decision but differs from what many staff would expect.

---

## 2. User Preferences (Inferred)

- **Joel prefers explanations before code** — always explain what a prompt does BEFORE giving the prompt. He noted this explicitly after feeling overwhelmed early on.

- **Joel uses Codex as the code writer** — Claude's role is to write precise prompts for Codex, review outputs, catch bugs, and guide architecture. Never assume Joel is writing code directly.

- **Joel prefers one feature at a time** — his previous project became a mess by building everything simultaneously. Respect this preference strictly.

- **Joel responds well to honest difficulty ratings** — when asked "is X difficult?", give a concrete number out of 10 and a reason. He made decisions based on these ratings.

- **Joel prefers practical over perfect** — when given options, he consistently chooses the simpler approach that works now over the architecturally superior approach that takes longer.

- **Joel checks in for confirmation before major decisions** — he asked his manager about several items (salary formula, backup strategy, leave types). Always prompt him to check with his manager for business decisions.

- **Joel appreciates when Claude catches mistakes proactively** — several times Claude caught issues before they became problems (gunicorn.conf.py git conflict, bcrypt key length, machine token duplicate). This builds trust.

- **Joel does not like being overwhelmed** — the conversation had a turning point where Joel admitted feeling too overwhelmed by the complexity. After that, Claude shifted to a step-by-step approach. Always maintain this simpler pace.

- **Joel commits frequently when prompted** — he doesn't do it spontaneously but always does it when told to. Always end feature sections with explicit git commit and push instructions.

- **Joel prefers visual diagrams for system understanding** — the SVG diagrams throughout the planning phase were very helpful. Use visualizations when explaining complex concepts.

---

## 3. Development Patterns Used Repeatedly

- **Pattern: Prompt → Codex → Output → Claude review → Next prompt** — never skip the review step. Joel always pastes Codex output back for verification.

- **Pattern: Backend routes first, then frontend UI** — always build the API route, test it with curl, confirm it works, THEN build the React component.

- **Pattern: Always test with curl before building UI** — every new route was tested with curl commands before any frontend work. Continue this.

- **Pattern: Always commit before moving to next feature** — this was established early and prevents lost work.

- **Pattern: README updates after each phase** — the README tracks current state. Update it after each completed feature group.

- **Pattern: Codex context prompt first** — every new Codex session starts with the master context prompt. If Joel starts a new Codex session, remind him to paste the context prompt first.

- **Pattern: Database schema on paper before code** — this was the lesson from Joel's previous messy project. Never skip schema design.

---

## 4. Architectural Preferences and Reasoning

- **Why localStorage over cookies:** CORS issues with cross-origin requests between port 5173/443 (frontend) and port 8001 (backend). httpOnly cookies with SameSite=none require HTTPS on both ends and specific server config that OpenLiteSpeed couldn't handle cleanly. localStorage + Bearer token is less secure but works reliably in this setup.

- **Why port 8001 instead of proxying:** OpenLiteSpeed proxy configuration in CyberPanel was attempted many times (vHost context, .htaccess with [P,L] flag, External App registration) and consistently failed with path stripping or 403 errors. The decision to expose backend directly on port 8001 with SSL was made out of practical necessity, not preference. This is a known architectural weakness.

- **Why agent reports only active/idle:** Break and meeting statuses are user-initiated (conscious actions). Idle is machine-detected. Keeping these separate means the agent code is simpler and the server has authoritative control over non-machine statuses.

- **Why two tables for monitoring (current_status + activity_logs):** Dashboard needs sub-second reads on current state. Logs grow to millions of rows. Mixing them causes slow dashboard queries. This was a deliberate performance decision.

- **Why company_id directly on activity_logs:** Avoids JOIN with users table on hot query path. Critical for multi-tenant performance as data grows.

- **Why SQLAlchemy ORM:** Joel had prior experience with it. Raw SQL was explicitly ruled out as a project requirement.

---

## 5. Implicit Context That Became Assumed

- **CyberPanel is the control panel** — any server configuration suggestions must be compatible with CyberPanel. Standard Nginx/Apache advice doesn't apply.

- **OpenLiteSpeed is the web server** — not Nginx, not Apache. This affects all reverse proxy, SSL, and rewrite rule instructions.

- **The company name is AidBro** — the product/system is called "WorkFlow." These are different things. AidBro is the company building WorkFlow.

- **Joel is building this alone** — despite the system being designed for a team product, there is ONE developer. Every suggestion should be scoped to solo developer capability.

- **The system is currently internal only** — no external clients yet. Production = AidBro's own staff. This affects urgency of certain security and legal features.

- **Windows is the only OS for agent** — all staff use Windows. Mac support is explicitly deferred. Never suggest Mac-specific code.

- **India is the primary jurisdiction** — DPDPA 2023 is the relevant law, not GDPR. Salary is in INR (₹). Working pattern is Mon-Fri.

---

## 6. Ideas Discussed But Never Implemented

- **Option C password delivery** — secure one-time link emailed to staff. Currently using Option B (manual verbal/WhatsApp delivery). Planned for future but no prompt written.

- **Redis caching** — discussed for current_status reads at scale. Architecture was designed to accommodate it (abstraction layer). Never implemented.

- **WebSocket adapter for scaling** — Socket.io with Redis adapter discussed but not implemented. Single process WebSocket is fine for current scale.

- **Webhook system** — discussed for future integrations. Never designed.

- **API layer for integrations** — discussed as future feature. Database structure designed to support it. Never implemented.

- **Subdomain per company** — `companyname.yourproduct.com` discussed as premium option. Currently single domain only.

- **Keyword filtering for chat monitoring** — mentioned briefly as an alternative to full visibility. Never designed or implemented.

- **Email notifications** — welcome email with credentials was planned but the actual email sending mechanism was never implemented. Currently super admin delivers credentials manually.

---

## 7. Features Planned But Not Started

In priority order based on last discussion:

1. **WFH daily check-in prompt** — at login, WFH staff should see "Working from home or office today?" No backend route or UI exists for this.

2. **Agent .exe packaging** — `agent/build_agent.py` and `agent/install_agent.bat` were written by Codex but never tested. PyInstaller has not been run. No actual .exe has been produced.

3. **WebSocket production test** — chat works locally and backend routes are deployed, but no end-to-end test through `wss://teams.aidbro.com:8001` has been done.

4. **First login consent checkbox** — staff should agree to monitoring policy on first login. No backend field or frontend UI exists.

5. **View Profile button** — in admin dashboard accordion, clicking "View Profile" shows `alert("Coming soon")`. The backend route GET /api/attendance/summary/{user_id} exists. Just needs a modal/page UI.

6. **Staff salary slip download** — button planned in staff dashboard. Backend route exists. UI not built.

7. **Delivery report list** — in alerts panel right section, placeholder text exists. No actual list of sent alerts is shown.

8. **Attendance dispute / raise concern** — staff can flag incorrect attendance. No route or UI exists.

9. **Admin set meeting status for team** — POST /status/meeting/set-team route exists but no UI in admin dashboard.

10. **Auto-start on Windows boot** — install_agent.bat has registry entry code but has never been tested. Unknown if it works correctly.

11. **Support message thread** — platform admin ↔ company super admin messaging. Backend not built. UI not built.

---

## 8. Unanswered Questions and Unresolved Decisions

- **How does agent auto-update work exactly?** — designed conceptually (agent checks version on startup, downloads new version silently) but never implemented. No version field exists in the agent or backend.

- **What happens to agent when staff account is deactivated?** — server rejects heartbeats (token deactivated), agent keeps trying and logging errors silently. No graceful shutdown. Is this acceptable?

- **Should the agent token be shown in the admin UI anywhere after first generation?** — the masked preview approach was just implemented (formatDate bug pending). But what if IT needs to verify which token is installed on a PC?

- **Email sending — what service?** — welcome emails were discussed but no email service (SendGrid, AWS SES, SMTP) was ever chosen or integrated. Currently credentials are delivered manually.

- **What is the data retention policy when a company churns?** — discussed in planning, designed DB to support clean deletion, but no actual deletion route for company data exists in platform admin.

- **Does the agent work when the PC is on a VPN?** — WFH staff on corporate VPNs may have issues reaching teams.aidbro.com:8001. Never discussed.

- **Should break_minutes in attendance accumulate across multiple breaks in a day?** — the route adds to existing break_minutes which suggests yes, but this was never explicitly confirmed.

- **What timezone does the server use for timestamps?** — all DateTime fields use utcnow(). Frontend displays these. If staff are in different timezones (not relevant for AidBro but important for product), this could cause date boundary issues with attendance records.

---

## 9. Technical Debt, Risks, Weaknesses

- **Port 8001 exposed directly** — security risk. Ideal solution is proper reverse proxy. This is the biggest architectural weakness in production.

- **root user running the service** — `User=root` in workflowapp.service. Should be a dedicated service user. Accepted for now but is a security risk.

- **No email system** — welcome emails, password reset, alerts all require email but no email service is integrated. Manual process only.

- **bcrypt==4.0.1 pinned** — if this dependency causes issues with future Python versions, needs attention.

- **No 2FA** — admin and super_admin accounts have no second factor. Planned as future config option but not implemented.

- **localStorage token storage** — less secure than httpOnly cookies. XSS vulnerability. Mitigated by XSS sanitization but still a known weakness.

- **Rate limiting on login only** — other sensitive routes (create user, generate token) have no rate limiting.

- **No CSRF protection** — was planned in the security review but never confirmed as implemented. Should verify this with Joel.

- **WebSocket connections not tested on production** — chat may not work through wss://teams.aidbro.com:8001 due to how OpenLiteSpeed handles WebSocket upgrades on proxied or direct connections.

- **gunicorn.conf.py outside git** — if server is rebuilt from scratch, this file must be manually recreated. It's documented but could be lost.

- **agent/config.json contains credentials** — if committed accidentally, exposes machine tokens. Should verify it's in .gitignore.

---

## 10. Common Mistakes a Future AI Assistant Should Avoid

1. **Never suggest Nginx configuration** — the server uses OpenLiteSpeed via CyberPanel. Nginx commands won't work.

2. **Never suggest changing port 8000** — it's taken by an existing website on the VPS.

3. **Never suggest httpOnly cookies for cross-origin auth** — this was tried extensively and failed. The project uses localStorage + Bearer token. Don't revisit this.

4. **Never add SSL lines to gunicorn.conf.py in the repo** — that file is in .gitignore. SSL config is managed directly on the server. Adding it to the repo causes git conflicts on deployment.

5. **Never use token_hex(64) for SECRET_KEY** — bcrypt passlib limitation is 72 bytes. Use token_hex(32) which gives 64 characters safely.

6. **Don't suggest screen lock detection** — was tried with multiple approaches (win32api, ctypes OpenInputDesktop, Windows Registry, WTSRegisterSessionNotification) and all failed reliably. The decision to remove it was final.

7. **Don't overwhelm with too many changes at once** — Joel had a negative experience with this in a previous project. Always one feature at a time.

8. **Don't skip the curl testing step** — always test backend routes with curl before building frontend UI.

9. **Don't forget to include git commit + push commands** — Joel won't do it unless explicitly told to.

10. **Don't assume Codex output is correct** — always review it. Codex frequently adds extra routes, uses wrong variable names, or forgets imports.

11. **Don't use `/etc/` paths in Codex prompts** — Codex can't create files there on local machine. Use project root paths and note that they need to be copied to server.

12. **Don't suggest Mac agent support** — Windows only, Mac deferred explicitly.

13. **Don't forget to add "What this does" explanation after each Codex prompt** — Joel explicitly requested this.

---

## 11. Advice for Future AI Assistant

- **Joel is capable and grows fast** — treat him as an intermediate developer who can understand concepts when explained clearly, not a beginner who needs hand-holding on every line.

- **The planning phase was thorough** — the system was planned across 8 sections with manager review and approval. Don't suggest changes to fundamental architecture without good reason.

- **Always check if something is already built** — the system is large and complex. Before suggesting building something, check the outstanding work list.

- **The CI/CD pipeline is working** — any changes should go through git push, not direct server editing (except for .env and gunicorn.conf.py which are server-only files).

- **The context prompt for Codex is important** — if Joel starts a new Codex session, he must paste the master context prompt first or Codex will make wrong assumptions.

- **Verify the formatDate fix was pushed** — this was the last known bug. Start a new conversation by confirming this was resolved.

---

## 12. Important Observations

- **The OpenLiteSpeed proxy problem cost significant time** — at least 6-8 different approaches were tried. The final solution (direct SSL on port 8001) is unconventional but works. Don't attempt to "fix" this by going back to proxy unless there's a compelling specific reason.

- **Joel's manager is actively involved** — several decisions were taken to the manager (salary formula, backup strategy, leave types). The manager approved the overall system design. Future significant changes should be framed as needing manager review.

- **The system has genuine commercial potential** — it was designed as a product from day one. Decisions like multi-tenancy and config layer were made with this in mind. Don't let technical debt accumulate that would harm the product vision.

- **The conversation was very long** — patterns and decisions made early may seem arbitrary without context. Trust the decisions that were made after consideration rather than trying to redo them.

---

## BOOTSTRAP PROMPT

---

> I am continuing development of **WorkFlow** — a staff monitoring and communication SaaS platform built with FastAPI (Python) + PostgreSQL + React + a Python background agent. The system is live at `https://teams.aidbro.com` on a Hostinger VPS (Ubuntu 24.04, CyberPanel/OpenLiteSpeed). I am a solo developer using Codex to write code based on detailed prompts you provide.
>
> **Critical context:**
> - Backend runs on port 8001 with direct SSL (NOT proxied through OpenLiteSpeed — proxy attempts all failed)
> - Auth uses localStorage + Bearer token (NOT httpOnly cookies — CORS issues prevented this)
> - Frontend calls API at `https://teams.aidbro.com:8001`
> - `backend/gunicorn.conf.py` is in `.gitignore` — managed directly on server with SSL cert paths
> - SECRET_KEY must be under 72 bytes — use `secrets.token_hex(32)`
> - CI/CD via GitHub Actions — pushing to main auto-deploys
> - Screen lock detection was removed after multiple failed attempts — don't suggest it
> - Agent reports only "active" or "idle" — break/meeting/offline are web-controlled
> - 4 role layers: platform_admin → super_admin → admin → staff
> - Every DB record has company_id for multi-tenancy
>
> **Current status — two things need immediate attention:**
> 1. `formatDate is not defined` bug in AdminDashboard.jsx line 1687 (StaffManagementPanel) — fix by adding formatDate helper function to the component
> 2. Two commits are pending push: "Add break and meeting status controls" and the agent token UI fix
>
> **After fixing these, the next priorities are:**
> 1. WFH daily check-in prompt at login (no implementation exists yet)
> 2. Package agent as .exe with PyInstaller and install_agent.bat
> 3. Test WebSocket through production domain (wss://teams.aidbro.com:8001)
> 4. First login consent checkbox
> 5. View Profile button in admin dashboard (backend exists, needs UI)
>
> **My workflow:** You write detailed Codex prompts → I paste into Codex → I paste the output back for your review → you verify and give next prompt. Always add a brief "What this does" explanation after each prompt. Always include git commit/push instructions at the end of each feature. One feature at a time — I had a bad experience building everything at once in a previous project.
>
> The project has a complete memory document from the previous conversation. Please confirm you understand the current status and tell me what to do first.