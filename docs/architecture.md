# Tula Carbon architecture

## Layers

```
frontend/src                       React + Vite, served by the backend in production (one domain)
  pages/          one screen each; no page imports another page
  components/     shared UI: Page (Header, States), Dialog, FieldsForm, Pager, CalcResultStatus
  hooks/          useLoad (GET + reload)
  services/       apiClient (fetch, cookies), format (display rounding, workbook tab 08)
  types/api.ts    shapes the API returns

backend/src
  app.ts          middleware order: security headers → CORS → same-origin writes → JSON → routes → errors
  routes/         every route names its permission (requirePermission / requireSuperAdmin)
  controllers/    HTTP in, JSON out; validation with zod schemas
  auth/           sessions (hashed tokens), crypto (scrypt, TOTP), permissions (single role → permission table)
  middleware/     security (headers, CSRF origin check, rate limit), validate, errorHandler
  calc/           calculation engine (below)
  services/       audit log, organisation access rules
  storage/        evidence files, outside any web folder

backend/prisma    PostgreSQL schema + migrations (source of truth); MySQL schema generated from it
```

## Security model

| Concern | How |
|---|---|
| Passwords | scrypt; forced change on first sign-in; lockout after 5 failures |
| Second factor | TOTP, replay-protected; required for every account |
| Sessions | random token in an httpOnly, SameSite=Lax cookie (Secure in production); only its SHA-256 is stored |
| Authorisation | server-side, per route, from `auth/permissions.ts`; membership and org status re-read on every request |
| Tenant isolation | every tenant query is filtered by the session's organisation; foreign IDs behave as "not found" |
| Verifiers | `services/verifierScope.ts`: only periods granted to them (`VerifierGrant`), and in them only approved records; their record, evidence and report views are audited |
| Segregation of duties | nobody approves or returns a record they entered or last changed; status changes are conditional updates (no double approval) |
| Period lock | a locked period refuses record, evidence, review, calculation and confirmation changes; reopening is Tenant Admin only, with a reason, and logged |
| CSRF | SameSite cookie, plus state-changing requests refused when Origin / Sec-Fetch-Site says another site |
| Brute force | per-account lockout, plus per-IP limit on sign-in, two-step and password change (`AUTH_RATE_LIMIT`) |
| Browser | CSP (scripts same-origin only), frame-ancestors none, nosniff, HSTS in production, no-store on API |
| Uploads | extension allow-list checked against file signatures; downloads sandboxed with their own CSP |
| Audit | append-only `AuditLog`, enforced by a database trigger |
| Safe defaults | unset `NODE_ENV` = production; dev shortcuts need `NODE_ENV=development` **and** `DEV_AUTH_SHORTCUTS=true` |
| Known risk | `DEMO_MODE=true` gives anyone a passwordless Super Admin; the server warns at startup. Showcase only |

Ceilings: the rate limiter counts in process memory (per process); calculation runs execute inside the request.

## Calculation engine (`backend/src/calc`)

```
core/decimal.ts      exact decimal arithmetic (60 significant digits, no rounding before display)
core/types.ts        Method, Reference, RecordInput, Outcome, Issue (tab 10 BLOCK / WARN)
core/units.ts        tab 03 conversions, V-01 / V-16
core/factors.ts      tab 05 factor selection: rules 4, 8, 9, 14; GWP set; V-03, V-04, V-18
core/boundary.ts     share counted under the approved boundary (tab 09)
methods/combustion.ts        C-01, C-02, C-03 (with C-09, C-13, C-14, C-15, C-23)
methods/c05-fugitive.ts      C-05 (C-17 screening, C-18 mass balance)
methods/c06-scope2-location.ts, c07-scope2-market.ts   Scope 2 (C-07 with C-20)
registry.ts          formula → methods (grid electricity runs C-06 and C-07); merged parameter schemas; ENGINE_VERSION
workbookData.ts      GENERATED from the workbook (tabs 02 and 04) by scripts/extract-workbook.py
referenceData.ts     how the app uses those rows (category, formula, units, default NCV) + units, grid regions
service.ts           runs a reporting period (approved records only) and stores the run; preview for reviewers
```

The engine is pure: the service loads reference data once, the method computes, the service stores
inputs, factors, selection rules, issues, per-gas masses and the unrounded result for every record and
method. Each result carries its tab 09 line (SCOPE1, SCOPE2_LOCATION, SCOPE2_MARKET); the run stores a
gross and a boundary-counted total per line plus the biogenic memo. An emission source names the tab 02
activity it is calculated as (`EmissionSource.activityCode`); that picks the formula, units and factors.

## Workflow modules

| Module | Backend | Frontend |
|---|---|---|
| Review | `activities.controller.ts` (`approveActivity`, `returnActivity`), `ActivityReview` history | Review Queue, record page review panel |
| Period close | `periodClose.controller.ts` (checklist, lock, reopen), `PeriodLockEvent` | Period Close |
| Reports | `reports.controller.ts` (JSON preview, CSV export; final = locked run) | Reports (print → PDF) |
| Verification | `verification.controller.ts` (grants, queries), `services/verifierScope.ts` | Verification Queries, Users & Roles → Verifier access |

### Adding a calculation (e.g. C-01 stationary combustion)

1. **Reference data**: if the workbook changed, rerun `scripts/extract-workbook.py`; map the new
   activities' formula, units and source category in `referenceData.ts`. Run `npm run reference:seed`.
2. **Method** (`methods/<id>.ts`): implement `Method`. Declare its extra inputs in `parameters` (strict zod
   object) and `fields` (labels for the form): the API validates them on activity records and the entry
   form shows them, with no other change. Reuse `core/units` and `core/factors`; add to `ReportingLine`
   if it feeds a new tab 09 line.
3. **Register** it in `registry.ts` (`BY_FORMULA`).
4. **Tests**: add its tab 07 rows to `tests/workbook-examples.ts`; add its tab 10 rules to `calculation.test.ts`.

## Commands (backend)

| Command | Purpose |
|---|---|
| `npm run dev` | local server |
| `npm test` | full suite (PostgreSQL by default; `TEST_DATABASE_URL=mysql://…` for MySQL) |
| `npm run typecheck` | type-checks source, scripts and tests |
| `npm run reference:seed` | load or refresh workbook reference data (safe to repeat) |
| `npm run prisma:migrate` | apply PostgreSQL migrations |
| `npm run mysql:setup` | build the MySQL schema (cPanel showcase) |
