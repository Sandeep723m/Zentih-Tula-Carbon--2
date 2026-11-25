# Tula Carbon

Multi-tenant enterprise carbon accounting & sustainability SaaS.

| App | Stack | Port | Health |
|---|---|---|---|
| `frontend/` | React + Vite + TS, React Router, custom CSS, Recharts | 5173 | – |
| `backend/` | Express 5 + TS, Prisma 7 (PostgreSQL), zod | 4000 | `GET /api/health` |
| `python-service/` | FastAPI + Uvicorn + Pydantic (Python 3.12) | 8000 | `GET /health` |

Browser → Express (public API) → PostgreSQL / internal Python service. The browser never calls Python or the DB directly.

## Run locally

```bash
# backend
cd backend && cp .env.example .env && npm install && npm run dev

# python service (internal, binds to 127.0.0.1)
cd python-service && python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# frontend
cd frontend && cp .env.example .env && npm install && npm run dev
```

No database is needed to start anything. When PostgreSQL is ready, set `DATABASE_URL` in `backend/.env` and run `npm run prisma:migrate`.

Create the first platform Super Admin (idempotent; development credentials `admin@tulacarbon.com` / `admin@123`, which must be changed at first sign-in). In production set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` instead:

```bash
cd backend && npm run platform:bootstrap
```

The Super Admin creates organisations, their subscriptions and first Tenant Admins in the platform area (`/platform`).

## Tests & builds

```bash
cd backend && npm test && npm run build
cd python-service && .venv/bin/pytest
cd frontend && npm run build
```
