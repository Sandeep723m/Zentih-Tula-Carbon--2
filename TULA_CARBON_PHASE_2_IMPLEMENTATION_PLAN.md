# Tula Carbon – Phase 2 Implementation Plan

Status: **plan only. Nothing is implemented.** Each stage starts only after explicit approval (§19). A1 (Git commit) and A2 (live database inspection) are **not** granted.

Read together with `TULA_CARBON_PHASE_1_FINAL_ARCHITECTURE.md` (the architecture), which is referred to below as **ARCH**.

| Label | Meaning |
|---|---|
| **[Verified]** | Existing behaviour, read in the code/schema on this machine |
| **[Approved]** | Approved architecture decision (ARCH §16, D1–D10) |
| **[Proposed]** | Implementation proposal in this plan, not built |
| **[Pending verification]** | Needs a technical check, usually A2 |

---

## 1. Executive summary

- **The work:** eight stages (0–8) deliver:
  - Sites with effective-dated facility placement;
  - three workspaces;
  - one Organisation Setup section;
  - boundary management owned by the Tenant Admin;
  - Data Entry assignments enforced by the server;
  - site and name snapshots on each result.
- **What stays the same:**
  - Every schema change is **additive**: new tables and nullable columns.
  - No existing row is rewritten.
  - Formulas, factor selection, GWP and factor governance are untouched.
- **Simplification found [Verified]:** `ReportingPeriod.finalRunId` already exists, and each run stores `boundaryId`. A locked or reopened period's boundary is therefore **already derivable** as `finalRun.boundaryId`. ARCH's proposed `pinnedBoundaryId` column is only needed for an *explicit re-apply*. No new period column: an explicit re-apply is recorded in an append-only `PeriodBoundaryReapplication` table (§4.8).
- **Recommended order:** 0 → 1 → 7a (engine snapshot columns) → 3 → 2 → 4 → 6 → 5 → 7b → 8 (continuous).

## 2. Confirmed architecture decisions [Approved]

D1 self-approval kept and labelled · D2 removals separate assignable category · D3 Data Entry own records only · D4 source freezing · D5 grid from approved snapshot (**pending A2 verification**, built switched off) · D6 boundary effective-date + protected periods · D7 effective-dated site placement · D8 per-org enforcement after Tenant Admin confirmation, no deadline · D9 "Site not recorded" for older results · D10 confidential files/dumps/HTML out of Git.

Fixed constraints: Scope 1 and 2 only; Super Admin has no tenant data; organisation close is the only final close; Reviewer/Verifier permissions unchanged.

## 3. Existing code areas affected [Verified unless marked]

| Area | Files |
|---|---|
| Schema | `backend/prisma/schema.prisma`, `backend/prisma/migrations/*` (7 migrations, latest `20261111120000_factor_governance`), `backend/scripts/mysql-schema.mjs` |
| Permissions | `backend/src/auth/permissions.ts`, `backend/src/middleware/*` (`requirePermission`) |
| Row scoping | `backend/src/services/verifierScope.ts` (pattern to copy) |
| Routes | `backend/src/routes/index.ts` (single router; boundary routes at lines 213–218 are Super Admin `sa`) |
| Controllers | `facilities`, `emissionSources`, `activities`, `evidence`, `documents`, `fuelProperties`, `dataQuality`, `reconciliation`, `boundary`, `calculations`, `periodClose`, `reports`, `analytics`, `auditWorkspace`, `insights`, `renewables`, `verification`, `members`, `organizations` |
| Engine | `backend/src/calc/service.ts` (`recordInclude`, boundary selection ~L128, result write ~L168), `calc/referenceData.ts` |
| Facility filter today | `?facilityId=` read in `activities` (L133), `reports` (L81, L148), `emissionSources` (L47), plus `dataQuality`, `reconciliation`, `auditWorkspace`, `documents`, `insights`, `calculations`, `fuelProperties` |
| Frontend nav | `frontend/src/components/nav.ts` (`TENANT_NAV`; "Administration" group has 6 entries) |
| Frontend routes | `frontend/src/routes/AppRoutes.tsx` |
| Frontend layout | `components/AppLayout.tsx`, `Shell.tsx`, `OrgPicker.tsx`, `PeriodHealth.tsx` |
| Admin pages | `pages/AdminPages.tsx` (profile, facilities, periods, sources, settings), `UsersPage.tsx`, `BoundarySetupPage.tsx` (platform route) |
| Tests | `backend/tests/*.test.ts` (22 files, 255 tests), `helpers.ts`, `setup.ts` |
| Live SQL | `deploy-sql/` hand-written upgrade scripts (not edited; new files only, in a later stage) |

## 4. Proposed database changes [Proposed]

All changes are additive. "Migration" means a new Prisma migration for Postgres, plus a **new** MySQL SQL file (design only until approved).

### 4.1 `Site` (new)

| Field | Type | Null | Purpose / constraint |
|---|---|---|---|
| id | uuid PK | no | |
| organizationId | FK → Organization (Cascade like Facility) | no | tenant isolation |
| code | varchar(20) | no | `^[A-Z0-9][A-Z0-9-]{2,19}$`; **unique (organizationId, code)** |
| name | varchar(120) | no | must not start with `= + - @` |
| country | varchar | yes | |
| isActive | bool default true | no | deactivate, never delete |
| createdAt, updatedAt | timestamp | no | |

Index: `(organizationId, isActive)`. Migration: a new empty table.

### 4.2 `FacilitySiteHistory` (new)

| Field | Type | Null | Purpose / constraint |
|---|---|---|---|
| id | uuid PK | no | |
| organizationId | FK | no | scoping; must equal both facility.org and site.org (service check) |
| facilityId | FK → Facility (Restrict) | no | |
| siteId | FK → Site (Restrict) | no | |
| validFrom | date | no | |
| validTo | date | yes | null = current placement |
| reason | varchar(500) | no | |
| createdById | FK → User (Restrict) | no | |
| createdAt | timestamp | no | |
| closedById, closedAt | FK/timestamp | yes | who and when ended the row |

- **Constraints:**
  - `validTo IS NULL OR validTo >= validFrom`, enforced by a CHECK in Postgres and in the service for MySQL.
  - **No overlaps:** enforced in the service inside a transaction that locks the facility row (`SELECT … FOR UPDATE`). Both engines support this.
  - One open row per facility: on Postgres a partial unique index on `(facilityId) WHERE validTo IS NULL`. On MySQL, a generated column `openKey = IF(validTo IS NULL, facilityId, NULL)` with a UNIQUE index **[Pending verification: MariaDB/MySQL version supports generated columns, needs A2]**. The fallback is the service check alone.
- **Index:** `(facilityId, validFrom)`.
- **No deletes:** there is no delete route. An optional MySQL trigger can block DELETE and block UPDATE of anything except `validTo`, `closedById` and `closedAt` (D-28 style).
- **Migration:** an empty table. **Existing facilities get no rows.**

### 4.3 `Facility.siteId` (new, convenience)

- **Type and constraints:** nullable FK → Site (Restrict).
- **Meaning:** the current placement. It is written in the same transaction as every history change and equals the open history row's site, or null.
- **Use:** never used by the engine or by reports. It exists only for lists and selectors.
- **Index:** `(organizationId, siteId)`.
- **Migration:** add the column with every value null.

**Unassigned facilities:** `siteId` is null and there are no history rows. They are listed under "Unassigned facilities". Every date before a facility's first `validFrom` resolves to no site.

### 4.4 `DataEntryAssignment` (new)

| Field | Type | Null | Purpose / constraint |
|---|---|---|---|
| id | uuid PK | no | |
| organizationId | FK | no | |
| userId | FK → User | no | must hold an active DATA_ENTRY membership in the org (service check) |
| level | enum ORGANISATION / SITE / FACILITY | no | |
| siteId | FK → Site | yes | required iff level = SITE |
| facilityId | FK → Facility | yes | required iff level = FACILITY |
| scope | enum S1 / S2 / REMOVALS | yes | null = S1+S2 (never removals) |
| ghgCategory | enum (§4.6) | yes | narrows within scope; must belong to `scope` if both set |
| status | enum PROPOSED / ACTIVE / REVOKED | no | PROPOSED rows come from the migration proposal; only ACTIVE counts |
| createdById, createdAt | | no | |
| confirmedById, confirmedAt | | yes | set when PROPOSED → ACTIVE |
| revokedById, revokedAt | | yes | |

- **Indexes:** `(organizationId, userId, status)`, `(facilityId)`, `(siteId)`.
- **Duplicates:** an ACTIVE row with the same (user, level, site, facility, scope, category) is rejected by the service. A MySQL unique index can't cover nulls reliably.

### 4.5 `Organization.assignmentsEnforced` (new)

- Boolean, not null, default **false**.
- Plus `assignmentsEnforcedAt` and `assignmentsEnforcedById`, both nullable.
- **Migration:** every organisation gets false, so behaviour is unchanged.

### 4.6 GHG category

- **Enum `GhgCategory`:** `S1_STATIONARY`, `S1_MOBILE`, `S1_FUGITIVE`, `S1_PROCESS`, `S2_ELECTRICITY`, `S2_HEAT_STEAM_COOLING`, `REMOVALS`.
- **`EmissionSource.ghgCategory`:** nullable. It is set for sources mapped with confidence. It stays null for ambiguous sources, which go on the review list.
- **`EmissionSource.ghgCategoryConfirmedById`, `…At`:** nullable.
- **Derivation (shared code):** from `category` and `ActivityType.category` [Verified mapping, ARCH §9]. A FUEL_COMBUSTION source with no activity type stays null.
- **Not stored on records:** a record's category is always its source's.
- **Backfill: two separate operations [Approved item 6]. It is never part of a schema migration.**
  1. **Dry run** (`ghg-category-backfill.ts --dry-run`, the default). It writes nothing and outputs a report listing every source with:
     - source category, activity type and name;
     - proposed category;
     - classification: CONFIDENT, AMBIGUOUS_NO_ACTIVITY or NAME_CONTRADICTS_ACTIVITY;
     - the expected update count.
  2. **Execution** (`--execute`) only after your separate explicit approval. It writes `ghgCategory` for CONFIDENT sources only, and changes no other field.
- **Ambiguous and contradictory sources** are never guessed. They stay null and go to the Tenant Admin review list.
- **No effect on calculations.**

### 4.7 `CalculationResult` snapshot columns (new, all nullable)

| Field | Type | Purpose |
|---|---|---|
| siteId | uuid, no FK (historical value must survive) | site resolved at record start date |
| siteCode, siteName | varchar | as at run time |
| facilityCode, facilityName | varchar | as at run time (facilityId exists [Verified]) |
| siteAttribution | enum `SiteAttribution` { RECORDED, UNASSIGNED, LEGACY_UNKNOWN }, **not null, default LEGACY_UNKNOWN** | how the site was known (Q-A, decided) |
| gridSource | varchar(20) | `SNAPSHOT` / `FACILITY` (D5 audit trail) |

- **Indexes:** `(runId, siteId)`, `(runId, facilityId)`.

**Site attribution [Approved Q-A]:**

| Value | Set when | siteId / siteCode / siteName | Report label |
|---|---|---|---|
| RECORDED | engine found a placement row covering the record's start date | all set | the stored site name |
| UNASSIGNED | engine ran after Site tracking, facility had no placement on that date | null | "Unassigned facilities" |
| LEGACY_UNKNOWN | result existed before the migration (column default fills every existing row) | null | "Site not recorded (calculated before site tracking)" |

- **New code always writes RECORDED or UNASSIGNED.** The engine never writes LEGACY_UNKNOWN; a test asserts this.
- **Reports keep UNASSIGNED and LEGACY_UNKNOWN as two separate rows** and never merge them. Totals still reconcile: org = Σ RECORDED sites + UNASSIGNED + LEGACY_UNKNOWN.
- **Migration:** the column is added with a default, so existing rows read LEGACY_UNKNOWN without an UPDATE statement.

### 4.8 Reporting period protection

**No new column on ReportingPeriod** [Approved item 7]. The existing chain is kept: `ReportingPeriod.finalRunId` → `CalculationRun.boundaryId` [Verified].

**New append-only table `PeriodBoundaryReapplication`.** Each row records one explicit Tenant Admin re-apply.

| Field | Type | Null | Constraint |
|---|---|---|---|
| id | uuid PK | no | |
| organizationId | FK | no | |
| reportingPeriodId | FK → ReportingPeriod (Restrict) | no | |
| boundaryId | FK → OrgBoundary (Restrict) | no | must be APPROVED, same org |
| previousBoundaryId | FK → OrgBoundary | yes | the boundary in force before this row |
| reason | varchar(1000) | no | ≥ 10 characters |
| actorUserId | FK → User | no | TENANT_ADMIN |
| createdAt | timestamp | no | |

- Index: `(reportingPeriodId, createdAt)`.
- Rows are never updated or deleted. An audit entry is also written.
- **Engine rule:**
  1. If the period has a reapplication row, use the newest row's `boundaryId`.
  2. Otherwise, if the period has `finalRunId`, use `finalRun.boundaryId`.
  3. Otherwise, use the existing selection rule.
- **Allowed only on a reopened period.** The original locked run, its results and `finalRunId` are **never overwritten**. A new run is a new row, and locking again sets `finalRunId` the way it does today.
- **Migration:** an empty table, no backfill.

### 4.9 Verifier soft revocation

- **Add `VerifierGrant.revokedAt` and `revokedById`**, both nullable.
- **`deleteGrant` becomes "set revokedAt"** [Proposed]. Today it hard-deletes the grant [Verified].
- **All grant reads filter `revokedAt IS NULL`:** `verifierScope`, `grantedPeriods`, lists.
- **Re-granting [Approved Q-C]:** a re-grant **creates a new row**. Revoked rows are never changed again, so the full grant and revocation history is kept.
- **Unique index:** the existing unique `(userId, reportingPeriodId)` [Verified] is **replaced** by a non-unique index on the same columns.
- **At most one active grant** per (user, period): enforced by the service inside a transaction that locks the existing rows. MySQL can't express a partial unique index portably.
- **Migration:** existing rows keep `revokedAt` null, so they stay active. Earlier hard-deleted grants survive only in the `verifier.access_revoked` audit entries [Verified], and are not reconstructed.
- **Protected-period test:** `status = LOCKED OR EXISTS active grant`. An exception needs no active grant. Past grants remain visible.

### 4.10 Boundary audit

No schema change. The `boundary.saved` audit gains `before` and `after` values. The audit table already has `before` and `after` [Verified: used by `verifier.access_revoked`].

## 5. Proposed API changes [Proposed]

### 5.1 New

| Method / path | Permission | Purpose |
|---|---|---|
| `GET/POST /sites`, `PATCH /sites/:id`, `POST /sites/:id/deactivate` | read `org.read`; write `site.manage` (TA) | site CRUD |
| `GET /facilities/:id/site-history` | `org.read` | placement history |
| `POST /facilities/:id/place` `{siteId, effectiveFrom, reason}` | `site.manage` | assign / move (R2/R3) |
| `POST /facilities/:id/unplace` `{effectiveFrom, reason}` | `site.manage` | close open row |
| `GET /facilities/:id/move-impact?date=` | `site.manage` | spanning records, affected assignments, protected-period check |
| `GET/POST /assignments`, `POST /assignments/:id/revoke` | `assignment.manage` (TA) | manage |
| `GET /assignments/proposals`, `POST /assignments/proposals/confirm` | `assignment.manage` | migration proposals |
| `POST /organizations/current/assignment-enforcement` `{enabled, reason}` | `assignment.manage` | per-org switch, audited |
| `GET /setup/status` | `org.read` | completion of the 8 Setup steps from live data |
| `GET /emission-sources/review-list` | `org.manage` | ambiguous/contradicting sources |
| `POST /emission-sources/:id/confirm-category` | `org.manage` | set ghgCategory |
| `POST /emission-sources/:id/replace` | `org.manage` | D4 replacement |
| `GET/PUT /boundary`, `POST /boundary/approve`, `POST /boundary/new-version`, `GET /boundary/history` | `boundary.manage` (TA) | tenant boundary (handlers reused from `boundary.controller.ts`, org from session) |
| `POST /reporting-periods/:id/reapply-boundary` `{boundaryId, reason}` | `period.manage` | D6 rule 5 |

### 5.2 Changed

| Route | Change |
|---|---|
| All context-aware GETs (§6.3) | accept `siteId` (incl. `unassigned`) alongside existing `facilityId`; one shared parser |
| `/platform/organizations/:id/boundary*` | **[Approved Q-B]** PUT/approve/new-version **removed**. `GET` boundary and history kept as read-only support. Response = boundary settings, versions, snapshot facility list (id, code, name, country, grid, shares, scope flags) only |
| `PATCH /emission-sources/:id` | 409 on facility/category/activityCode once records exist |
| `DELETE /verifier-grants/:id` | soft revoke |
| `POST /verifier-grants` | always a new row; refused if an active grant already exists |
| All Data Entry-reachable routes (§7.2) | `dataEntryScope` when org enforced |
| `/reporting-periods/:id/checklist`, `/lock` | new blocking item: approved records spanning a site move |
| `/activities` create/update/submit | spanning-move validation |
| `/fuel-properties*` | facility scoping |

**Unchanged:** all factor routes, `factor.approve`, review routes, verifier portal, query routes, platform factor and activity-type routes.

## 6. Proposed frontend changes [Proposed]

### 6.1 Navigation (`nav.ts`)

- The "Administration" group (6 entries) is replaced by one **Organisation Setup** entry (`/setup`), with 8 steps as sub-routes `/setup/:step`.
- The old routes (`/organization`, `/facilities`, `/reporting-periods`, `/emission-sources`, `/users`, `/settings`) **stay registered** and redirect to the matching step. The sidebar entries are removed only after Setup passes acceptance (Stage 2 gate).

### 6.2 Setup pages

A new `pages/SetupPage.tsx` provides the step shell, progress and status. **It reuses the existing components:**

| Step | Reuse | New |
|---|---|---|
| 1 Profile | `OrganizationProfilePage` form (AdminPages) | — |
| 2 Boundary | `BoundarySetupPage` (move from platform route, tenant API) | effective-date picker, protected-period messages |
| 3 Periods | `ReportingPeriodsPage` | — |
| 4 Sites & Facilities | `FacilitiesPage` | site list, place/move dialog with impact preview, unassigned banner, history panel |
| 5 Sources | `EmissionSourcesPage` | review list, confirm category, replace source, frozen-field hints |
| 6 Users & Assignments | `UsersPage` | assignment editor, proposals review, enforcement switch |
| 7 Tenant Settings | `TenantSettingsPage` | — |
| 8 Review & Confirm | — | read-only summary from `/setup/status` |

- **Save and resume:** each step saves through its own existing API, with no wizard draft state. Completion is calculated from data, so an existing organisation opens with its completed steps already ticked.
- **Step completion rules:**
  - Profile: name and country set.
  - Boundary: an approved version exists.
  - Periods: at least one period.
  - Sites & Facilities: at least one active facility. Placement in sites is optional; unassigned facilities show as a warning, not as incomplete.
  - Sources: at least one source and an empty review list.
  - Users & Assignments: every Data Entry user has at least one ACTIVE assignment, or enforcement is off.
  - Settings: always complete.
  - Review: complete when every other step is complete.

### 6.3 Global context header

**New `ContextBar`** in `AppLayout`, built from the existing `OrgPicker` plus a new `LocationPicker` and `PeriodPicker`.

- **State lives in the URL query** (`?site=`, `?facility=`, `?period=`) through one hook, `useWorkspaceContext()`. It is also mirrored to localStorage, per viewer convenience only.
- **Location options:**
  - All;
  - each site, with its facilities nested;
  - Unassigned facilities.
  - Data Entry users see only their covered facilities and sites.
- **Period** is independent of location.
- **API calls:** a shared helper appends the context to calls. Pages drop their own facility dropdowns.

**Pages that consume context** (today some have their own filters [Verified list in §3]):
- ActivityPages (dashboard, list, review queue), ActivityEntryPage (default facility);
- DocumentsPage, DataQualityPage, ReconciliationPage;
- CalculationsPage (results view);
- AnalyticsPage, ReportsPage, AuditWorkspacePage;
- CarbonIntelligencePage, RenewablesPage;
- PeriodClosePage (org only), FuelPropertiesPage.

### 6.4 Workspaces

- The same pages render a workspace header that depends on the context level:
  - Organisation: KPIs and a site breakdown;
  - Site: KPIs and a facility breakdown;
  - Facility: KPIs and a source breakdown, plus an "Add data" button.
- **Organisation-only controls** are hidden at Site and Facility level, and the server rejects them anyway (§7.4):
  - Run calculation, confirm warnings;
  - Lock, reopen, re-apply boundary.
- **Site and Facility levels** show read-only period readiness instead.

## 7. Permission and security changes [Proposed]

### 7.1 Permissions (`permissions.ts`)

| New permission | Roles |
|---|---|
| `site.manage` | TENANT_ADMIN |
| `assignment.manage` | TENANT_ADMIN |
| `boundary.manage` | TENANT_ADMIN |
| `boundary.read` | TENANT_ADMIN, REVIEWER, VERIFIER (verifier: granted periods) |

- **No existing permission changes** for Reviewer, Verifier or Data Entry.
- **Super Admin loses the boundary write routes** [Approved Q-B].
- **Tenant isolation is not weakened:**
  - The remaining read-only boundary view is the same data Super Admin can already read today [Verified: SA boundary GET routes exist].
  - It exposes no activity records, evidence, documents, calculation results or tenant emission factors.
  - It stays behind the existing `sa` platform guard.
  - A test asserts that Super Admin still gets 403 or 404 on every tenant data route (T22).

### 7.2 `dataEntryScope` (new `backend/src/services/dataEntryScope.ts`)

- **When it applies:** only when `role === DATA_ENTRY && org.assignmentsEnforced`. In every other case it is a no-op, returning `{}`.
- **`coveredFacilityCategories(userId, orgId)`:**
  - reads the ACTIVE assignments on every request (no cache);
  - expands ORGANISATION to every facility, and SITE to facilities whose **current** `Facility.siteId` = S;
  - returns a set of `(facilityId, ghgCategory)` pairs.
- **`recordWhere`:** `{ createdById: user, OR [(facilityId, source.ghgCategory) pairs] }` for writes. Reads use `{ createdById: user }` only, which covers the read-only "earlier submissions".
- **Access to another user's record ID, or to anything outside scope:** 404.

| Endpoint group [Verified reachable by DE] | Read | Write |
|---|---|---|
| `/facilities`, `/emission-sources`, `/organizations/current` | covered only | n/a (DE has no write) |
| `/activities*` incl. summary, check | own | own ∧ covered ∧ Draft/Returned |
| `/activities/:id/evidence`, `/evidence/:id*` | via parent record | via parent record |
| `/documents*` | own uploads | own; link only to own covered record |
| `/data-quality` | findings on own records | n/a |
| `/reconciliations*` | own records | own records |
| `/fuel-properties*` | covered facilities | covered ∧ own Draft |
| `/emission-factors`, `/unit-requests` | unchanged | unchanged (factor rules 1–10) |
| reports, analytics, insights, renewables, exports | not reachable [Verified F10] | – |

- **Scoping only narrows access.** Review, evidence, no-self-confirmation and factor rules run after it, unchanged.
- **Removals** are covered only by an explicit REMOVALS scope (D2).

### 7.3 Migration for existing Data Entry users

1. Release: enforcement off everywhere, so nothing changes for anyone.
2. Tenant Admin opens Setup step 6. The server proposes PROPOSED rows (FACILITY × ghgCategory) from each user's own records. Sources with a null category produce a proposal at FACILITY level with no category, flagged for review.
3. The Tenant Admin edits and confirms. The rows become ACTIVE.
4. **Switching enforcement on [Approved Q-D].** Before the switch, the Tenant Admin sees a confirmation screen listing **every** Data Entry user with:
   - their current access (today: all organisation records, read);
   - their proposed assignments;
   - their confirmed ACTIVE assignments;
   - a highlighted **"No access after enforcement"** marker for users with no ACTIVE assignment.

   The screen ends with a clear warning, and activation needs an explicit confirmation. Users with zero assignments get **zero** facility access; there is no unrestricted fallback. The audit entry stores the full list of affected users and their access before and after.
5. Enforcement can be switched off again (audited).

### 7.4 Organisation-only actions

- **Actions:** run calculation, confirm warning, lock, reopen, re-apply boundary.
- **Server behaviour:** the server ignores or rejects any `siteId`/`facilityId` context on these routes. The UI hides them at lower levels. Nothing new on the server can close a period partially.

## 8. Calculation and reporting implications [Proposed]

- **Engine (`calc/service.ts`):**
  - Load each facility's history rows once per run.
  - Resolve each record's site by `startDate`.
  - Write the §4.7 snapshot columns.
  - Pick the grid: snapshot when the D5 flag is on, otherwise live, and record `gridSource`.
  - Boundary choice follows §4.8.
  - **Formulas, factor selection, NCV/density logic, GWP and inclusion maths are untouched.**
- **Aggregation:** one query per level over the latest run's results.
  - Org = all; Site = `siteId` (non-RECORDED split by `siteAttribution` into UNASSIGNED and LEGACY_UNKNOWN, never merged); Facility = `facilityId`.
  - Gross = Σ tCO2e; counted = Σ tCO2e × inclusionPct/100.
  - `biogenicTCO2` is a memo line, never in totals [Verified column].
  - Removals (C-08 line) are a separate line, never in Scope 1/2.
- **No double counting:** each result row has one facility and one site value.
  - Invariant check: Σ facility = Σ site = org = `run.totals`.
  - It runs in tests, and as a server assertion after each run that logs and audits a mismatch.
- **Historical stability:**
  - Locked periods never re-run [Verified].
  - Reports on a run read only stored columns (IDs, names, grid, factor).
  - Placement or name changes never rewrite results.
  - Re-runs of an open period are new runs, and the run comparison lists the changed inputs (grid, site, activityCode, factor ID, fuel property version).
- **Boundary after lock:** new versions are dated after protected periods. A reopened period uses `finalRun.boundaryId` unless it is explicitly re-applied.
- **Verifier-protected periods:**
  - Moves and boundary dates that reach them are refused while a grant is active.
  - Exception: revoke the grant (soft), then a reason, then an audit entry.
  - Earlier runs are never touched.

## 9. Stage-by-stage implementation sequence

### Stage 0 – Safety and baseline

| Item | Plan |
|---|---|
| Objective | Reproducible local baseline and a rollback point, without any commit |
| Dependencies | none |
| Steps | record `git branch`/`git status` (branch `main`, no commits [Verified]); run `cd backend && npm test` (255/255 last run [Verified]); frontend `tsc --noEmit` + build to scratch dir; `git check-ignore` every folder in ARCH §14; scan for secrets/hashes/emails; list `deploy-sql/0-DELETE-ALL-DATA-KEEP-TABLES.sql` as **never run, never commit** |
| Rollback point | **[Approved Q-E]** Because A1 is not granted, the rollback point is a source archive in a private folder **outside the project** (`~/TulaCarbon-Backups/`, mode 700).<br>**Excluded from the archive:** `.env` files, `backend/storage`, customer and client documents (xlsx, pdf, bills, document zips), SQL data dumps, deploy archives and build output. These files stay untouched in place.<br>**Local development database:** `pg_dump` of the dev database only (no live dump). It is **encrypted** (AES-256) before it is stored. The key is held in the macOS Keychain, not next to the file. The plain dump is never written to disk.<br>**Verification:** decrypt into a pipe and list its contents with `pg_restore --list`, then compare row counts by restoring into a **throwaway** local database that is dropped afterwards. The original database is never touched.<br>If A1 is granted later, the baseline commit adds to this rollback point |
| Files changed | none (archive written outside the project) |
| DB / API / FE | none |
| Tests | full existing suite green |
| Risks | archive accidentally includes secrets → exclude `.env*`, `storage/` |
| Acceptance | test counts, build status and file inventory recorded in a baseline note |

### Stage 1 – Database and migration design → build

| Item | Plan |
|---|---|
| Objective | All §4 schema additions, Postgres migration, MySQL SQL file, backfill scripts (dry-run) |
| Dependencies | Stage 0; approval to implement |
| Files | `backend/prisma/schema.prisma`; new `backend/prisma/migrations/2026MMDD_sites_assignments/migration.sql`; `backend/scripts/mysql-schema.mjs` (regenerate only); **new** `deploy-sql/2026MMDD_sites_assignments.sql` (file only); new `backend/scripts/ghg-category-backfill.ts` (dry-run default); `backend/src/calc/referenceData.ts` (add `ghgCategoryOf`, pure function); `backend/tests/helpers.ts` (fixtures) |
| DB | §4.1–4.9 |
| API / FE | none |
| Tests | migration applies on empty and seeded test schema; all 255 existing tests green; `ghgCategoryOf` table test over all 128 activity types; overlap/open-row constraint tests (T6) |
| Risks | MySQL generated-column support unknown (A2); Prisma enum on MySQL vs Postgres differences |
| Rollback | `prisma migrate reset` locally; additive columns ignored by old code |
| Acceptance | `prisma validate`, migration up on test schema, regression green, MySQL SQL reviewed (not run) |

### Stage 7a – Engine snapshot columns (pulled forward)

| Item | Plan |
|---|---|
| Objective | Results start carrying site/name snapshots and `gridSource` before any UI depends on them |
| Dependencies | Stage 1 |
| Files | `backend/src/calc/service.ts`; new `backend/src/services/siteResolver.ts`; `tests/calculation.test.ts`, new `tests/sites-history.test.ts` |
| DB | writes to §4.7 columns; reads §4.2, §4.8 |
| API | `reports`/`analytics` unchanged yet |
| Tests | T1–T4, T26; all C-01…C-21 tests unchanged (T23) |
| Risks | per-record lookup cost → preload history per facility per run |
| Rollback | snapshot columns nullable; reverting the code leaves them null |
| Acceptance | identical tCO2e totals before/after on the seeded dataset; new columns populated |

### Stage 3 – Site and facility management

| Item | Plan |
|---|---|
| Objective | Sites CRUD, place/move/unplace, history, impact preview, protected-period checks, spanning-record detection |
| Dependencies | 1, 7a |
| Files | new `controllers/sites.controller.ts`; `controllers/facilities.controller.ts`; new `services/protectedPeriods.ts`; `controllers/activities.controller.ts` (spanning validation); `controllers/periodClose.controller.ts` (checklist item); `controllers/verification.controller.ts` (soft revoke); `routes/index.ts`; `permissions.ts`; FE `AdminPages.tsx` (FacilitiesPage) + new dialogs; `types/api.ts` |
| DB | uses §4.1–4.3, §4.9 |
| API | §5.1 sites/facility routes; verifier soft revoke |
| Tests | T5–T9, T24, T25, soft-revoke + re-grant, names T26 |
| Risks | moves inside open periods surprise users → impact preview mandatory |
| Rollback | feature hidden behind no sites existing; routes removable; tables unused |
| Acceptance | §18 Stage 3 |

### Stage 2 – Organisation Setup

| Item | Plan |
|---|---|
| Objective | One `/setup` section with 8 steps reusing existing pages; tenant boundary routes; old routes redirect |
| Dependencies | 3 (step 4), boundary routes |
| Files | new `pages/SetupPage.tsx`; `components/nav.ts`; `routes/AppRoutes.tsx`; `pages/BoundarySetupPage.tsx` (API base switch); `pages/AdminPages.tsx`; `UsersPage.tsx`; backend new `controllers/setup.controller.ts`; `boundary.controller.ts` (org from session, effective-date rules, audit diff); `emissionSources.controller.ts` (freeze, review list, replace); `reportingPeriods.controller.ts` (reapply) |
| API | §5.1 setup, boundary, sources |
| Tests | T15, T17–T19; setup status for an existing fully configured org = all ticked; SA boundary write after hand-over → 403 |
| Risks | Super Admin workflows relying on boundary write (Q-B) |
| Rollback | nav reverts to Administration group; old routes still exist |
| Acceptance | §18 Stage 2 |

### Stage 4 – Assignments and enforcement

| Item | Plan |
|---|---|
| Objective | Assignment CRUD, proposals, per-org switch, `dataEntryScope` on every DE route |
| Dependencies | 1, 2 (step 6 UI), 3 (site expansion) |
| Files | new `services/dataEntryScope.ts`; new `controllers/assignments.controller.ts`; `activities`, `evidence`, `documents`, `dataQuality`, `reconciliation`, `fuelProperties`, `facilities`, `emissionSources`, `organizations` controllers; `routes/index.ts`; `permissions.ts`; FE `UsersPage.tsx`; new `tests/assignments.test.ts`, `tests/data-entry-scope.test.ts` |
| Tests | T10–T14, T27, T28; route-sweep test |
| Risks | a missed route leaks data → route-sweep test enumerates every route in `index.ts` reachable by DATA_ENTRY and fails on any 200 for a foreign ID |
| Rollback | enforcement switch off per org (instant, no deploy); code path no-op when off |
| Acceptance | §18 Stage 4 |

### Stage 6 – Global context header

| Item | Plan |
|---|---|
| Objective | One context bar; every applicable page and API respects it |
| Dependencies | 3, 4 |
| Files | new `components/ContextBar.tsx`, `hooks/useWorkspaceContext.ts`; `AppLayout.tsx`; `OrgPicker.tsx`; all pages in §6.3; backend new `middleware/context.ts` (parse/validate `siteId`/`facilityId`/`periodId`, enforce org + DE coverage) used by the controllers in §3 |
| Tests | context propagation test per page group; API rejects a foreign `siteId` (404) |
| Risks | pages keeping their own filter → grep check in CI for page-level facility selects |
| Rollback | context bar falls back to "All", pages still work |
| Acceptance | §18 Stage 6 |

### Stage 5 – Three workspaces

| Item | Plan |
|---|---|
| Objective | Org/Site/Facility dashboards, breakdowns, reports on shared queries |
| Dependencies | 6, 7a |
| Files | `ActivityPages.tsx` (dashboard), `AnalyticsPage.tsx`, `ReportsPage.tsx`, `CalculationsPage.tsx`, `PeriodClosePage.tsx`; backend `analytics.controller.ts`, `reports.controller.ts`, new `services/aggregate.ts` |
| Tests | T3, T4, T20, T21; CSV per level reconciles with org |
| Risks | slow queries on large runs → `(runId, siteId)` / `(runId, facilityId)` indexes |
| Rollback | org-level views unchanged; site/facility views hideable |
| Acceptance | §18 Stage 5 |

### Stage 7b – Grid snapshot and run comparison

| Item | Plan |
|---|---|
| Objective | D5 behind per-org flag (off); run comparison per result |
| Dependencies | 7a; **A2 verification before switching on** |
| Files | `calc/service.ts`, `calculations.controller.ts` (compare), `CalculationsPage.tsx` |
| Tests | T16; comparison lists grid/site/activity/factor/fuel-property changes |
| Risks | open-period Scope 2 shifts when switched on (R4) |
| Rollback | flag off |
| Acceptance | §18 Stage 7 |

### Stage 8 – Testing (continuous)

See §14. Runs at every stage gate.

## 10. File-level change inventory [Proposed]

| File | Stage | Change |
|---|---|---|
| backend/prisma/schema.prisma | 1 | §4 additions |
| backend/prisma/migrations/<new>/migration.sql | 1 | new |
| backend/scripts/mysql-schema.mjs | 1 | run only, no edit expected |
| deploy-sql/<new dated file>.sql | 1 | **new file**; no existing SQL edited |
| backend/scripts/ghg-category-backfill.ts | 1 | new |
| backend/src/calc/referenceData.ts | 1 | `ghgCategoryOf` |
| backend/src/calc/service.ts | 7a, 7b | snapshot, site, grid, boundary rule |
| backend/src/services/siteResolver.ts | 7a | new |
| backend/src/services/protectedPeriods.ts | 3 | new |
| backend/src/services/dataEntryScope.ts | 4 | new |
| backend/src/services/aggregate.ts | 5 | new |
| backend/src/services/verifierScope.ts | 3 | filter revoked grants |
| backend/src/middleware/context.ts | 6 | new |
| backend/src/auth/permissions.ts | 2–4 | 4 new permissions |
| backend/src/routes/index.ts | 2–6 | new routes; SA boundary writes removed (Q-B) |
| controllers: sites, assignments, setup (new); facilities, emissionSources, activities, evidence, documents, dataQuality, reconciliation, fuelProperties, boundary, calculations, periodClose, reportingPeriods, reports, analytics, verification, organizations | 2–7 | per stage |
| frontend: components/nav.ts, AppLayout.tsx, OrgPicker.tsx, ContextBar.tsx (new), hooks/useWorkspaceContext.ts (new), routes/AppRoutes.tsx, pages/SetupPage.tsx (new), AdminPages.tsx, UsersPage.tsx, BoundarySetupPage.tsx, ActivityPages.tsx, ActivityEntryPage.tsx, DocumentsPage.tsx, DataQualityPage.tsx, ReconciliationPage.tsx, CalculationsPage.tsx, AnalyticsPage.tsx, ReportsPage.tsx, AuditWorkspacePage.tsx, PeriodClosePage.tsx, FuelPropertiesPage.tsx, CarbonIntelligencePage.tsx, RenewablesPage.tsx, types/api.ts | 2–6 | per stage |
| backend/tests: new sites-history, assignments, data-entry-scope, setup, workspaces, verifier-revoke; existing helpers.ts, boundary, calculation, security, workflow | 1–8 | |

**Not touched:** the HTML reference, `.env*`, existing `deploy-sql/*.sql`, factor values, `calc/methods/*` formulas.

## 11. Database migration sequence [Proposed]

1. M1 `sites_assignments`: Site, FacilitySiteHistory, Facility.siteId, DataEntryAssignment, Organization.assignmentsEnforced*, GhgCategory enum, EmissionSource.ghgCategory*.
2. M2 `result_snapshots`: CalculationResult snapshot columns, `siteAttribution` (default LEGACY_UNKNOWN), `gridSource`, plus indexes.
3. M3 `period_protection`: PeriodBoundaryReapplication, VerifierGrant.revokedAt/ById, grant index change.
4. Optional MySQL triggers (history immutability): a separate file, applied only with D-28-style approval.
5. Backfill (data, never inside a migration): `ghg-category-backfill.ts --dry-run` produces a report. `--execute` runs **only on your separate approval**, and writes CONFIDENT sources only. There is **no** site or assignment backfill.

M3 also contains: the `PeriodBoundaryReapplication` table; `VerifierGrant.revokedAt/revokedById`; replacing the unique `(userId, reportingPeriodId)` with a plain index. M2 adds `siteAttribution` with default LEGACY_UNKNOWN.

Each migration is additive and independently reversible: drop the new table or column, and no existing data is lost. On live, MySQL files are applied in order 1 → 3, only after a separate deployment approval and a backup.

## 12. Backward compatibility [Proposed]

- **Old code against the new schema:** works. New columns are nullable and new tables are unused.
- **New code with enforcement off and no sites:** behaves as today. The test suite proves this (T13).
- **Existing API query `facilityId`:** still accepted everywhere.
- **Old frontend URLs:** redirect to the Setup steps.
- **Existing results:** readable. Site shows "Site not recorded" (D9), and facility names fall back to the current name with a "(name at calculation not recorded)" hint.
- **Super Admin boundary pages:** read-only after the hand-over (Q-B).

## 13. Existing customer-data protection [Proposed]

- No UPDATE or DELETE of existing activity records, results, runs, audit rows, evidence, factors or period locks in any migration.
- The only data backfill (ghgCategory) writes one new nullable column, is dry-run first, and needs separate approval.
- No invented site placements or assignments.
- Live: nothing is run without A2 for reading, and without a separate deploy approval and a verified backup for writing.
- `0-DELETE-ALL-DATA-KEEP-TABLES.sql` [Verified exists] is never part of any step.

## 14. Testing strategy [Proposed]

**Environments:**
- Local Postgres, isolated `test` schema (existing harness [Verified]).
- **MySQL compatibility:** a local MySQL/MariaDB container. The generated MySQL schema plus the new SQL file are applied, then a smoke subset runs (migration up, history overlap, open-row unique, assignment queries). The engine version must match live (A2).

**Regression:** all 255 existing tests must stay green at every stage gate. Tests change only when they asserted behaviour that was intentionally changed: verifier hard delete, Super Admin boundary writes, source PATCH of frozen fields. Each such change is listed in the stage report.

**Test catalogue.** T1–T29 come from ARCH §18; T30+ are new.

| # | Case | Expected |
|---|---|---|
| T1 | Jan HYD / Feb BLR, March re-run | Jan result siteId=HYD, Feb=BLR; HYD 10, BLR 12, org 22 |
| T2 | Re-run after move | Jan site total unchanged |
| T3 | Invariants | Σ facility = Σ site (+unassigned +not recorded) = org = run.totals |
| T4 | No double counting | each result once per level |
| T5 | Unassigned facility | listed under Unassigned; `siteAttribution=UNASSIGNED`; totals reconcile |
| T6 | Overlap / 2nd open row | rejected (409) |
| T7 | Move into locked period | rejected |
| T8 | History immutable | no route edits/deletes rows |
| T9 | Draft spanning move | submit blocked; split → two drafts |
| T10 | DE probes other user's record/evidence/document | 404 on every DE route |
| T11 | DE unassigned facility | absent from lists; create → 404 |
| T12 | Reassigned DE | own past records readable, not editable |
| T13 | Enforcement off | identical behaviour; existing tests green |
| T14 | Reviewer/Verifier | permission tests unchanged |
| T15 | Source freeze | frozen field PATCH → 409; name edit OK |
| T16 | Grid snapshot (flag on) | draft grid edit doesn't change next run; `gridSource=SNAPSHOT` |
| T17 | Effective date | ≤ protected end or non-period-start → 400 |
| T18 | Reopened period | re-run uses finalRun.boundaryId; reapply needs reason, audited |
| T19 | Boundary audit | before/after stored |
| T20 | Removals | never in S1/S2 at any level |
| T21 | Org-only actions | run/lock/reopen with site/facility context rejected; not shown in UI |
| T22 | Super Admin | no tenant activity data/factors |
| T23 | Formulas | C-01…C-21 tests unchanged, green |
| T24 | Approved record spans move | listed at move; lock refused until returned/split/re-approved |
| T25 | Verifier-protected period | move/boundary refused with active grant; exception after soft revoke + reason; old runs unchanged |
| T26 | Rename after run | historical report shows stored names |
| T27 | Fuel property scoping | DE unassigned facility → 404 |
| T28 | Factor governance | DE factor draft still needs evidence + other Reviewer |
| T29 | Self-approved label | shown on review, record and verifier views |
| T30 | Soft revoke | grant row kept with revokedAt; verifier loses access; re-grant reactivates, audited |
| T31 | Site assignment follows move | facility moved HYD→BLR: HYD-assigned user loses write, BLR-assigned gains; own past records stay readable |
| T32 | Proposals | generated from own history only; none for users without history; nothing ACTIVE until confirmed |
| T33 | Enforcement switch | refused while a DE user has no ACTIVE assignment unless acknowledged; audited both ways |
| T34 | Setup status | existing fully configured org shows all steps complete without input |
| T35 | Context API | foreign-org `siteId`/`facilityId` → 404; DE uncovered site → 404 |
| T36 | Category backfill dry run | reports only; writes nothing; real run touches only `ghgCategory` |
| T37 | Biogenic | `biogenicTCO2` memo at every level, never in totals |
| T38 | Inclusion % | counted = Σ tCO2e × pct/100 identical at org vs Σ sites |
| T39 | Unplace | closing open row → later records resolve Unassigned |
| T40 | MySQL smoke | new SQL applies on MySQL container; overlap/open-row checks behave as Postgres |
| T41 | Route sweep | every route reachable by DATA_ENTRY is listed and covered by scope tests |
| T42 | Existing results | LEGACY_UNKNOWN → "Site not recorded"; never shown or summed as Unassigned; engine never writes LEGACY_UNKNOWN |
| T43 | Re-grant | revoked row unchanged; new row created; second active grant refused |
| T44 | Reapply boundary | locked run and finalRunId unchanged; reapplication row has reason, actor, time; next run uses it |
| T45 | Backfill dry run | writes nothing; lists every source with classification and expected count |

## 15. Rollback strategy [Proposed]

| Level | Mechanism |
|---|---|
| Per org, runtime | enforcement switch off; D5 flag off |
| Code | revert to Stage 0 local archive (or baseline commit once A1 granted) |
| Schema (local) | `prisma migrate reset` / drop new tables/columns |
| Schema (live) | additive only, so old code runs on new schema; drop scripts prepared per migration, run only with approval after backup |
| Data | no existing data altered; backfill column can be nulled |

## 16. Deployment strategy [Proposed; separate approval]

- **Nothing in this plan deploys.** Deployment is a separate approval per release.
- **When approved:**
  1. Take a live backup.
  2. Apply the additive MySQL files in order.
  3. Deploy the backend (old frontend still works).
  4. Deploy the frontend.
  5. Every organisation starts with enforcement off and D5 off.
- **The deploy zip** must contain the MySQL Prisma client generated before `tsc` (known requirement).
- **Pre-deploy checklist:**
  - outstanding live items D-28 triggers, D-29 bootstrap password, TEST_SWITCH off;
  - A2 results for D5 and the MySQL version.

## 17. Risks and unresolved questions

| # | Item | Label |
|---|---|---|
| R1 | Missed Data Entry route leaks records | mitigated by T41 route sweep |
| R2 | MySQL version lacks generated columns / CHECK | Pending verification (A2) |
| R3 | D5 shifts open-period Scope 2 | Pending verification (A2); flag off until checked |
| R4 | Snapshot names nullable for old results | Approved (D9) |
| R5 | Users surprised by Site-assignment change on move | impact preview (Stage 3) |
| R6 | Large orgs: per-run history lookup | preload per run |
| Q-A | Site attribution | **Decided:** RECORDED / UNASSIGNED / LEGACY_UNKNOWN enum (§4.7) |
| Q-B | Super Admin boundary | **Decided:** writes removed; read-only support view, no tenant data (§5.2, §7.1) |
| Q-C | Verifier re-grant | **Decided:** new row per grant; revoked rows kept (§4.9) |
| Q-D | Enforcement with unassigned users | **Decided:** allowed after full impact screen and confirmation; zero access, no fallback (§7.3) |
| Q-E | Rollback archive | **Decided:** outside project, no secrets/customer docs, encrypted local-dev dump only (Stage 0) |
| Item 6 | Category backfill | **Decided:** dry run and execution separate; execution needs approval (§4.6) |
| Item 7 | Locked period boundary | **Decided:** no new period column; append-only reapplication table (§4.8) |

## 18. Acceptance criteria per stage

| Stage | Must pass before the next stage |
|---|---|
| 0 | baseline note: 255/255, frontend typecheck + build, ignore checks, secret scan clean, local archive + local DB dump made |
| 1 | migration up on test schema; MySQL SQL reviewed; 255 green; T6, T36, `ghgCategoryOf` over 128 types; T40 |
| 7a | totals identical before/after on seed; T1–T4, T23, T26, T37, T38, T42 |
| 3 | T5–T9, T24, T25, T30, T39; existing green |
| 2 | T15, T17–T19, T34; SA boundary writes 403 (if Q-B); old URLs redirect; Administration sidebar removed only now |
| 4 | T10–T14, T27, T28, T31–T33, T41; existing green |
| 6 | T35; every §6.3 page uses context; no page-level facility filter remains |
| 5 | T3, T4, T20, T21; per-level CSVs reconcile |
| 7b | T16; comparison output; flag remains off pending A2 |
| 8 | full catalogue green on Postgres; T40 green on MySQL |

## 19. Explicit approval gates

| Gate | Needed for | Status |
|---|---|---|
| G0 | Stage 0 only (local baseline, archive outside project, encrypted local-dev DB backup) | **Granted 2026-11-24** |
| G1 | Start Stage 1 code/schema changes locally | **Not granted** |
| G-stage | Each following stage after its acceptance report | **Not granted** |
| A1 | Any Git commit / push | **Not granted** |
| A2 | Read-only live MySQL inspection (SELECT-only) | **Not granted** |
| D5-on | Switch on grid-from-snapshot for any org | **Not granted**; needs A2 |
| Backfill | Run ghgCategory backfill for real | **Not granted** |
| Deploy | Any live schema/app change | **Not granted** |
| Q-A…Q-E | §17 technical questions | **Decided 2026-11-24** |
| G1 | Stage 1 | **Not granted** |

---

*Planning document. No source code, schema, SQL, HTML, environment file, data, Git history or production system was changed in preparing it.*
