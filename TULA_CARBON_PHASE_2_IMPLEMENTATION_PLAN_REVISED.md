# Tula Carbon – Phase 2 Implementation Plan (Revised)

> **Revision 4, 2026-11-24.** The current **local** data is dummy/test data and may be reset. The **live** database is **not** assumed disposable and stays untouched (A2 not granted). Approving Q-F and Q-G is **not** G1.
>
> **NO IMPLEMENTATION HAS STARTED.** Only Stage 0 (local baseline and backups) has been done, under G0. **G1 (Stage 1) is NOT GRANTED.** A1 (Git commit) and A2 (live MySQL inspection) are **NOT GRANTED**. This document replaces `TULA_CARBON_PHASE_2_IMPLEMENTATION_PLAN.md` for review. The original file is left unchanged.

Read together with `TULA_CARBON_PHASE_1_FINAL_ARCHITECTURE.md`, referred to below as **ARCH**.

| Label | Meaning |
|---|---|
| **[Verified]** | Existing behaviour, read in local code or schema |
| **[Confirmed]** | Approved business or architecture decision (D1–D10, Q-A to Q-E, items 6–7) |
| **[Proposed]** | Implementation detail proposed here, not built |
| **[A2]** | Needs read-only inspection of the live MySQL database |
| **[UNRESOLVED – REQUIRES VERIFICATION]** | Cannot be settled from local code or schema |
| **[Decision needed]** | A new choice for you, raised by this review |

---

## 0. Change log

### Revision 4 (2026-11-24): local data is disposable; simplified

**Clarification [Confirmed]:**
- The current local data is dummy/test data and need not be preserved.
- **The live database is not assumed disposable.** It is never connected to, inspected, reset or migrated without separate approval (A2, Deploy).

| # | Change | Where |
|---|---|---|
| R4-1 | **Local databases may be reset and reseeded** (`prisma migrate reset` plus the existing seed scripts). No local data preservation, integrity-checksum or recovery steps | §9 Stage 1, §13, §15, §18 |
| R4-2 | **Two migrations instead of four.** P2-A (Stage 1) = old M1 + M2 + M4 flag. P2-B (Stage 3) = old M3. The labels M1–M4 elsewhere in this document refer to these parts | §11 |
| R4-3 | **GHG category backfill script removed from Stage 1.** New and edited sources get `ghgCategory` from `ghgCategoryOf` when saved, and local data is reseeded. Whether live needs a backfill is decided only after A2 | §4.6, T36, T45 |
| R4-4 | **MySQL upgrade SQL deferred** from Stage 1 to a **pre-deployment stage** after A2. It is written against the real live version. Local compatibility is already verified (R3-4) | §9, §11, §16 |
| R4-5 | **October lock-history recovery simplified.** Locally, those records are discarded by reset. One general guard remains, for any real data: if a period was locked but its final run can't be resolved from lock history, the run is refused until a Tenant Admin explicitly re-applies a boundary. No October-specific detection or audit-log archaeology unless A2 shows real live data | §4.8, T57, T59 |
| R4-6 | **M3 controlled-rollback archive procedure** kept only as a pre-production requirement, not built for local data | §15 |
| R4-7 | All business requirements, confirmed decisions and production safeguards unchanged | §2, §2a |

### Revision 3

### Revision 3 (2026-11-24): Q-F and Q-G decided, pre-G1 verification

| # | Change | Where |
|---|---|---|
| R3-1 | **Q-F approved with clarification.** Write coverage is resolved per draft, by the draft's start date, against **ACTIVE** assignments only. Pre-move drafts use the old site's assignment; drafts starting on or after the move use the new site's. Revoked assignments never grant access. Spanning records must be split before submission | §7.2, T31, T56 |
| R3-2 | **Q-G approved.** M3 moved to Stage 3. Stage 1 changes no controller. A schema guard stops the verifier code running without M3 | §9, §11, §16, T58 |
| R3-3 | **Lock history verified** in code and migrations. Gaps found: (a) periods locked before the lock-history migration have no lock event; (b) `PeriodLockEvent.runId` has no foreign key. Boundary resolution now **never guesses**: such periods are blocked until the Tenant Admin explicitly re-applies a boundary | §4.8, T18, T57, T59 |
| R3-4 | **Active-key uniqueness verified by experiment** on PostgreSQL 17 and MySQL 9.7 (throwaway instances, removed afterwards): repeated NULLs, duplicate rejection, concurrent inserts, revoke and re-grant in one transaction, concurrent revoke vs grant. MySQL CHECK enforcement also verified. The live version is still A2 | §4.2, §4.9 |
| R3-5 | **Rollback separated.** Code rollback and schema or data rollback are different operations. M1 and M2 are **never dropped** once used | §15 |
| R3-6 | Decision register added; all earlier decisions and T1–T55 kept. T56–T59 added | §2a, §14 |

### Revision 2

| # | Correction | Where |
|---|---|---|
| C1 | T30 now matches Q-C: a re-grant creates a new row and the revoked row is unchanged | §14 |
| C2 | T33 now matches Q-D: enforcement is allowed after the impact screen and explicit acknowledgement; zero access, no fallback | §7.3, §14 |
| C3 | The "every change is additive and nullable" claim is removed. `siteAttribution` is NOT NULL with a default; M3 replaces a unique index | §1, §4.7, §4.9, §11, §12 |
| C4 | Rollback rewritten. M3 is **not safely reversible** once new grant rows exist; it uses a forward fix or a controlled rollback | §15 |
| C5 | Three-state site attribution applied in reporting, compatibility, migration and tests | §4.7, §8, §12, §14 |
| C6 | Super Admin boundary rule is unconditional | §7.1, §18 |
| C7 | One approval-gate table; G1 appears once, NOT GRANTED | §19 |

**New technical findings in this review [Verified]:**

- **F-1, reopen clears the final run.** `reopenPeriod` sets `ReportingPeriod.finalRunId = null` (periodClose.controller.ts:129). The final run survives only in `PeriodLockEvent` (`action = LOCKED/REOPENED`, `runId`).
  - The earlier engine rule "reopened period uses `finalRun.boundaryId`" **would not work**.
  - Corrected rule, using existing data and no new column: §4.8.
- **F-2, locking an empty result set doesn't stop concurrent inserts.** It is not a reliable guard on Postgres or MySQL. The active-grant and open-placement rules now use **a database-enforced unique "active key" column**, plus a parent-row lock (§4.2, §4.9).
- **F-3, site-based assignments vs effective dating.** Site assignments now resolve through effective-dated placement, not `Facility.siteId` (§7.2). This raises one new decision (Q-F).

---

## 1. Executive summary

- **The work:** delivers Sites with effective-dated facility placement, three workspaces, one Organisation Setup section, Tenant Admin boundary ownership, server-enforced Data Entry assignments, and a site and name snapshot on each calculation result.
- **Compatibility, stated precisely** [Proposed, corrected]:
  - **New tables:** Site, FacilitySiteHistory, DataEntryAssignment, PeriodBoundaryReapplication.
  - **New nullable columns** on Facility, Organization, EmissionSource, CalculationResult and VerifierGrant.
  - **One NOT NULL column with a default:** `CalculationResult.siteAttribution`, default `LEGACY_UNKNOWN`. Existing rows take the default; no UPDATE statement is written.
  - **One non-additive change:** M3 **drops** the unique index `VerifierGrant(userId, reportingPeriodId)` and replaces it with a non-unique index and a unique `activeKey`. Old application code that relies on that unique index keeps working while there is at most one row per (user, period). After the new code creates a second row (a re-grant), old code can't be restored without a controlled procedure (§15).
  - **No existing row values change** in any migration, apart from defaults on new columns.
- **Unchanged:** formulas, factor selection, NCV/density, GWP, factor governance, review workflows, Reviewer and Verifier permissions.
- **Stage order:** 0 ✔ → 1 → 7a → 3 → 2 → 4 → 6 → 5 → 7b, with testing (8) at every gate. Unchanged from the approved order.

## 2. Confirmed decisions [Confirmed]

- **Hierarchy and ownership:**
  - Organisation → Site → Facility.
  - Tenant Admin owns and confirms the boundary.
  - Super Admin: platform duties plus a read-only boundary support view only (Q-B).
- **Data Entry:**
  - Restrictions apply to Data Entry users only.
  - Users see their own records only (D3); their own past submissions stay read-only.
  - Existing users get **proposed** assignments.
  - Enforcement is per organisation, after Tenant Admin confirmation, with no deadline (D8, Q-D).
- **Scope:** Scope 1 and 2 only, no Scope 3. Removals are separate and explicitly assignable (D2).
- **Preserved:** formulas, factor governance, historical results, runs, factor snapshots, audit, evidence and locks.
- **Sources:** classification fields frozen once records exist; corrections use a replacement source (D4).
- **Site placement and attribution:**
  - Placement is effective-dated (D7).
  - Old results are LEGACY_UNKNOWN; no site placement is invented (D9, Q-A).
- **Calculation and periods:**
  - Grid from the approved snapshot: built switched off until A2 (D5).
  - Boundary effective dates and protected periods (D6).
  - Re-applying a boundary goes in an append-only table; no new period column (item 7).
- **Verifier grants:** soft revoke; a re-grant is a new row (Q-C).
- **Category backfill:** dry run and execution are separate; execution needs approval (item 6).
- **Files and environments:**
  - Rollback archive outside the project, no secrets or customer documents, encrypted local-only dump (Q-E).
  - HTML reference unchanged and excluded from Git (D10).
  - No live access or deployment without separate approval.

## 2a. Decision register

| ID | Decision | Status | Where applied |
|---|---|---|---|
| D1 | Tenant Admin self-approval of records and fuel properties kept, labelled "self-approved"; factor approval unchanged | Confirmed | T29 |
| D2 | Removals a separate category, assignable only explicitly | Confirmed | §7.2, T20, T54 |
| D3 | Data Entry sees own records only | Confirmed | §7.2, T10 |
| D4 | Source facility/category/activity frozen once records exist; replacement source | Confirmed | §5, T15 |
| D5 | Scope 2 grid from approved snapshot | Confirmed; **switching on needs A2** | Stage 7b, T16 |
| D6 | Boundary effective dates; protected periods | Confirmed | §4.8, T17, T25 |
| D7 | Effective-dated site placement | Confirmed | §4.2, T1–T9 |
| D8 | Enforcement per organisation after confirmation; no deadline | Confirmed | §7.3 |
| D9 | Old results "Site not recorded" | Confirmed (as LEGACY_UNKNOWN) | §4.7, T42 |
| D10 | Confidential files, dumps, HTML out of Git; HTML unchanged | Confirmed | ARCH §14 |
| Q-A | RECORDED / UNASSIGNED / LEGACY_UNKNOWN, never merged | Confirmed | §4.7, T42, T48 |
| Q-B | Super Admin: no boundary writes; read-only view; no tenant data | Confirmed | §7.1, T22, T46 |
| Q-C | Re-grant = new row; revoked row unchanged | Confirmed | §4.9, T30, T43, T47 |
| Q-D | Enforcement after impact screen + acknowledgement; zero access, no fallback | Confirmed | §7.3, T33 |
| Q-E | Rollback archive outside project, encrypted local dump | Confirmed; done in Stage 0 | §9 Stage 0 |
| Item 6 | Backfill dry run and execution separate | Confirmed; **applies only if a live backfill is needed (A2)** | §4.6, T36, T45 |
| Item 7 | No new period column; append-only reapplication | Confirmed | §4.8, T44 |
| Q-F | Write coverage by the draft's start date; ACTIVE assignments only; own drafts only; spanning records split | **Approved with clarification (Rev 3)** | §7.2, T31, T56 |
| Q-G | M3 in Stage 3; schema guard | **Approved (Rev 3)** | §9, §11, T58 |
| Legacy locks | Locally discarded by reset. One general guard: unresolvable lock history means the run is refused until explicit re-application; never guessed | Proposed (Rev 4) | §4.8, T57, T59 |
| Rev 4 | Local data disposable; live not assumed disposable; two migrations; no Stage 1 backfill or deploy SQL | **Confirmed clarification / Proposed simplification** | §0, §11 |
| G1 | Start Stage 1 | **NOT GRANTED** | §19 |
| A1 / A2 / Backfill / D5-on / Deploy | separate approvals | **NOT GRANTED** | §19 |

## 3. Existing code areas affected [Verified]

| Area | Files |
|---|---|
| Schema | `backend/prisma/schema.prisma`, `backend/prisma/migrations/*` (latest `20261111120000_factor_governance`), `backend/scripts/mysql-schema.mjs` |
| Permissions | `backend/src/auth/permissions.ts`, `requirePermission` middleware |
| Row scoping pattern | `backend/src/services/verifierScope.ts` |
| Routes | `backend/src/routes/index.ts` (boundary routes L213–218 behind `sa`) |
| Period close | `periodClose.controller.ts`: lock sets `finalRunId` (L109) and writes `PeriodLockEvent LOCKED` with `runId`; reopen **clears** `finalRunId` (L129) and writes `REOPENED` with the old `runId` |
| Verifier grants | `verification.controller.ts`: create relies on unique `(userId, reportingPeriodId)`; delete hard-deletes the grant and audits it with `before` (L41–49) |
| Engine | `calc/service.ts` (boundary selection ~L128, result write ~L168), `calc/referenceData.ts` |
| Facility filter today | `?facilityId=` in activities, reports, emissionSources, dataQuality, reconciliation, auditWorkspace, documents, insights, calculations, fuelProperties |
| Analytics / audit workspace | use `finalRunId` for locked periods (analytics.controller.ts:42–45, auditWorkspace.controller.ts:20–22) |
| Frontend | `components/nav.ts`, `routes/AppRoutes.tsx`, `AppLayout.tsx`, `OrgPicker.tsx`, `pages/AdminPages.tsx`, `UsersPage.tsx`, `BoundarySetupPage.tsx` |
| Tests | `backend/tests/*.test.ts` (22 files, 255 tests; baseline 255/255 on 2026-11-24) |
| Concurrency precedent | members.controller.ts:30 already notes `SELECT … FOR UPDATE` as the pattern for race-sensitive checks |

## 4. Proposed database changes [Proposed]

### 4.1 `Site` (M1)

| Field | Type | Null | Constraint |
|---|---|---|---|
| id | uuid PK | no | |
| organizationId | FK → Organization (Cascade, as Facility) | no | |
| code | varchar(20) | no | `^[A-Z0-9][A-Z0-9-]{2,19}$`; UNIQUE (organizationId, code) |
| name | varchar(120) | no | must not start with `= + - @` |
| country | varchar | yes | |
| isActive | bool default true | no | deactivate only, never delete |
| createdAt, updatedAt | timestamp | no | |

Index `(organizationId, isActive)`. Starts as an empty table.

### 4.2 `FacilitySiteHistory` (M1)

| Field | Type | Null | Constraint |
|---|---|---|---|
| id | uuid PK | no | |
| organizationId | FK | no | must equal facility.org and site.org (service check) |
| facilityId | FK → Facility (Restrict) | no | |
| siteId | FK → Site (Restrict) | no | |
| validFrom | date | no | |
| validTo | date | yes | null = open (current) |
| openKey | varchar(36) | yes | = facilityId while open, null once closed; **UNIQUE** |
| reason | varchar(500) | no | |
| createdById | FK → User | no | |
| createdAt | timestamp | no | |
| closedById, closedAt | FK / timestamp | yes | |

- **One open row per facility, enforced by the database:** UNIQUE `openKey`. Both Postgres and MySQL/MariaDB allow many NULLs in a unique index, so this needs **no generated column and no partial index**. It removes the earlier dependence on A2.
- **No overlaps:** the service checks, in one transaction that first runs `SELECT … FOR UPDATE` on the **Facility row**. The Facility row always exists, so concurrent moves of the same facility are serialised on both engines. The overlap check then runs with no race.
- **`validTo ≥ validFrom`:** a CHECK on both engines.
  - **[Verified locally]** Enforced on PostgreSQL 17 and on MySQL 9.7.1 (throwaway instance, 2026-11-24): an inserted row with `validTo < validFrom` was rejected.
  - MySQL enforces CHECK from 8.0.16; MariaDB parses CHECK from 10.2.
  - **The live engine and version are [A2].** The service check is always present, whatever the engine does.
- **Index:** `(facilityId, validFrom)`.
- **No deletes:** no route deletes rows. The optional MySQL immutability trigger is a separate file with separate approval.
- **Starts empty.** Existing facilities get **no rows**.

### 4.3 `Facility.siteId` (M1)

- **Type:** nullable FK → Site.
- **Meaning:** a convenience mirror of the open history row's site, written in the same transaction as each history change.
- **Used only for** "current site" displays.
- **Never used** to resolve historical records, results, write permission or assignment coverage. Those use the history table by date (§7.2, §8).
- **Index:** `(organizationId, siteId)`. All existing values are null.

**Unassigned facility:** `Facility.siteId` is null and there is no history row covering the date. It is shown under "Unassigned facilities". Dates before a facility's first `validFrom` resolve to unassigned.

### 4.4 `DataEntryAssignment` (M1)

| Field | Type | Null | Constraint |
|---|---|---|---|
| id | uuid PK | no | |
| organizationId | FK | no | |
| userId | FK → User | no | must have an active DATA_ENTRY membership in the org |
| level | enum ORGANISATION / SITE / FACILITY | no | |
| siteId | FK → Site | yes | required iff level = SITE, else null |
| facilityId | FK → Facility | yes | required iff level = FACILITY, else null |
| scope | enum S1 / S2 / REMOVALS | yes | |
| ghgCategory | enum GhgCategory | yes | if set, must belong to `scope` (or define it when scope is null) |
| status | enum PROPOSED / ACTIVE / REVOKED | no | |
| createdById, createdAt | | no | |
| confirmedById, confirmedAt | | yes | |
| revokedById, revokedAt | | yes | |

Indexes: `(organizationId, userId, status)`, `(facilityId)`, `(siteId)`. The exact semantics are in §7.2.

### 4.5 `Organization` enforcement fields (M1)

- `assignmentsEnforced` bool, not null, default false.
- `assignmentsEnforcedAt`, `assignmentsEnforcedById`, both nullable.
- Every existing organisation gets false, so behaviour is unchanged.

### 4.6 GHG category (M1 schema; backfill separate)

- **Enum `GhgCategory`:** S1_STATIONARY, S1_MOBILE, S1_FUGITIVE, S1_PROCESS, S2_ELECTRICITY, S2_HEAT_STEAM_COOLING, REMOVALS.
- **Scope of each category:** S1_* → S1; S2_* → S2; REMOVALS → REMOVALS.
- **New nullable columns:** `EmissionSource.ghgCategory`, `ghgCategoryConfirmedById`, `ghgCategoryConfirmedAt`.
- **Derivation:** `ghgCategoryOf(source.category, activityType.category)`, a pure function in `referenceData.ts` [Verified mapping, ARCH §9].
- **Setting the category [Rev 4]:** when a source is created or its activity type is confirmed, `ghgCategory = ghgCategoryOf(...)`. It is null when ambiguous (FUEL_COMBUSTION with no activity type) and is then confirmed by the Tenant Admin. Contradictory names are flagged on the review list, computed at read time.
- **Local data:** reseeded, so **no backfill is needed in Stage 1**.
- **Live data:** **[A2]** If A2 shows real live sources, a backfill with a separate dry run and execution (item 6 rule: dry run first, execution only on separate approval, CONFIDENT sources only) is written in the pre-deployment stage. If live is also disposable, none is needed.
- **No guessing:** ambiguous sources stay null.

### 4.7 `CalculationResult` snapshot columns (M2)

| Field | Type | Null | Purpose |
|---|---|---|---|
| siteId | uuid, **no FK** | yes | site resolved for the record's start date |
| siteCode, siteName | varchar | yes | as at calculation time |
| facilityCode, facilityName | varchar | yes | as at calculation time |
| **siteAttribution** | enum RECORDED / UNASSIGNED / LEGACY_UNKNOWN | **NO, default LEGACY_UNKNOWN** | how the site was known |
| gridSource | varchar(20) | yes | SNAPSHOT / FACILITY |

**Indexes:** `(runId, siteAttribution, siteId)`, `(runId, facilityId)`.

**Attribution states [Confirmed Q-A]:**

| State | Written by | siteId / code / name | Report row |
|---|---|---|---|
| RECORDED | engine (Stage 7a onward), placement row covers the record's start date | set | the stored site name |
| UNASSIGNED | engine (Stage 7a onward), no placement covers the date | null | "Unassigned facilities" |
| LEGACY_UNKNOWN | **only** the column default on rows that existed before M2 | null | "Site not recorded (calculated before site tracking)" |

- **The engine never writes LEGACY_UNKNOWN.** A test asserts this (T42).
- **Reports always show UNASSIGNED and LEGACY_UNKNOWN as separate rows.** They are never merged, relabelled or summed together.
- **Totals:** org = Σ RECORDED per site + UNASSIGNED + LEGACY_UNKNOWN.
- **The gap between M2 and Stage 7a:** results written by **unchanged old code** after M2 is applied would also receive LEGACY_UNKNOWN. That is truthful, because they were calculated without site tracking. To keep the gap minimal, the plan applies M2 and ships the Stage 7a engine together (§11). On live, both ship in the same deployment.
- **Compatibility:** old code doesn't know the column; inserts get the default, so it is compatible.

### 4.8 Reporting period protection (M3) – corrected for F-1

- **No new column on ReportingPeriod** [Confirmed item 7].
- **New append-only table `PeriodBoundaryReapplication`:**

| Field | Type | Null | Constraint |
|---|---|---|---|
| id | uuid PK | no | |
| organizationId | FK | no | |
| reportingPeriodId | FK (Restrict) | no | |
| boundaryId | FK → OrgBoundary (Restrict) | no | APPROVED, same org |
| previousBoundaryId | FK → OrgBoundary | yes | the boundary in force before |
| reason | varchar(1000) | no | ≥ 10 chars |
| actorUserId | FK → User | no | Tenant Admin |
| createdAt | timestamp | no | |

Index `(reportingPeriodId, createdAt)`. No update or delete path, and every row is also audited.

**Boundary resolution for a run.** One function, `boundaryForPeriod(periodId)`, used by the engine:

**Verified lock-history facts (R3-3):**

| Fact | Source |
|---|---|
| Every lock through the current code writes `PeriodLockEvent{action: LOCKED, runId: <final run>}` in the same transaction that sets `finalRunId` | periodClose.controller.ts:107–113 |
| Every reopen writes `PeriodLockEvent{action: REOPENED, runId: <previous finalRunId>, reason}` and sets `finalRunId = null` | periodClose.controller.ts:129–131 |
| The application has no route that updates or deletes `PeriodLockEvent` or `CalculationRun`. Only `scripts/wipe-test-data.ts` and `deploy-sql/0-DELETE-ALL-DATA-KEEP-TABLES.sql` delete them | grep of src/ and scripts/ |
| `PeriodLockEvent`, `finalRunId` and `lockedAt` were introduced in migration `20261029090000_review_close_verify`. `PeriodStatus` (OPEN/LOCKED) existed earlier, in `20261015100000_org_admin` | migrations |
| The October live schema (`deploy-sql/old-oct-2026/1-schema.sql`) had `status enum('OPEN','LOCKED')` but **no** `finalRunId`, `lockedAt` or `PeriodLockEvent` | deploy-sql |
| `PeriodLockEvent.runId` has **no foreign key**, so a dangling `runId` is possible in principle | migration 20261029 |

**Conclusion:**
- For any period locked through the current code, the latest LOCKED event identifies the exact final run, and the run carries its `boundaryId`. **This is reliable.**
- Periods locked under the October version have **no** lock history and no `finalRunId`. Their original boundary **cannot be determined from the database** and must never be guessed.

**Resolution order** (`boundaryForPeriod(periodId)`):

1. If a `PeriodBoundaryReapplication` row exists for the period, use the **newest** row's `boundaryId`. An explicit Tenant Admin choice always wins.
2. Otherwise, if the period has a LOCKED event:
   - take the newest LOCKED event's `runId`;
   - load that `CalculationRun` (same org and period);
   - use its `boundaryId`, which may be null and is then kept as "no boundary".
   - **If the run doesn't exist**, the boundary is **UNKNOWN**, so go to step 4.
3. Otherwise, if the period **was locked but has no resolvable LOCKED event** (`status = LOCKED`, or any REOPENED event), the boundary is **UNKNOWN**, so go to step 4. This single general guard covers missing history from any cause; it is not October-specific.
4. **UNKNOWN → the calculation run is refused** with: "This period was locked before lock history was kept, so its original boundary is not recorded. A Tenant Admin must choose the boundary explicitly." The only way forward is an explicit re-application with a reason. **Nothing is inferred.**
5. Otherwise, the period has never been locked: use today's rule, the approved `OrgBoundary` with the highest version where `effectiveFrom ≤ period.startDate` [Verified].

**Rev 4 [Confirmed]:**
- **Local data:** October-era periods are dummy data and are **discarded by the local reset**.
- **Future real data:** every lock goes through the current code, which always writes the LOCKED event with its run, so the history is always reliable. The rule-3 guard stays as a safety net (dangling `runId`, imported data).
- **Live data:** only if A2 shows **real** customer periods from the October version does the pre-deployment stage add a check of the live audit log for locked-then-reopened periods. If live is disposable, nothing extra is needed. **A boundary is never guessed for real data.**

**Edge cases:**
- **Locked once, but its run had no boundary** (`boundaryId` null) [Verified possible]: rule 2 gives "no boundary". The re-run keeps "no boundary" unless the Tenant Admin explicitly re-applies one. This is consistent with "keep what was locked".
- **Locked periods that predate `PeriodLockEvent`:** handled by rules 3–4. They are blocked and never guessed. How many exist on live is **[A2]**.

**Re-applying:**
- Allowed only on an OPEN period that has been locked before: it has a LOCKED event, **or** rule 3 marks it as locked without history.
- The original locked run, its results and its lock events are **never modified**.
- A new run is a new row. Locking again sets `finalRunId` and writes a new LOCKED event, as today.

**Starts empty.**

### 4.9 Verifier soft revocation (M3) – corrected for F-2

- **New columns:** `VerifierGrant.revokedAt` and `revokedById`, nullable, plus **`activeKey`** varchar, nullable, **UNIQUE**.
- **`activeKey` on insert:** set to `userId + ':' + reportingPeriodId`.
- **On revoke** (same statement): set `activeKey = NULL`, `revokedAt` and `revokedById`.
- **One active grant per (user, period) is enforced by the database.** A concurrent second insert fails on the unique key on both Postgres and MySQL, because many NULLs are allowed. The service maps that failure to 409 "This verifier already has access to this period".
- **Defence in depth:** grant creation first runs `SELECT … FOR UPDATE` on the **ReportingPeriod row**, which is a stable parent row that always exists.
- **[Verified by experiment, R3-4]** On throwaway PostgreSQL 17.11 and MySQL 9.7.1 instances (InnoDB, REPEATABLE-READ), both removed afterwards:

| Case | PostgreSQL | MySQL |
|---|---|---|
| Several rows with `activeKey` NULL (revoked) | allowed | allowed |
| Second row with the same non-null key | rejected (unique violation) | rejected (Duplicate entry) |
| Revoke (key → NULL) and re-grant (same key) in one transaction | succeeds; 1 active, history kept | succeeds; 1 active, history kept |
| Two concurrent inserts of the same key | second waits for the first commit, then is rejected; 1 row | same |
| Concurrent revoke (uncommitted) vs a new grant | grant waits, then succeeds after the revoke commits; 1 active | same |

- **Not verified:** MariaDB, and the exact live engine and version **[A2]**. T40 and T47 must also run against a container matching the live version once A2 reveals it.
- **Index change (not additive):**
  - DROP UNIQUE `(userId, reportingPeriodId)` [Verified existing].
  - ADD INDEX `(userId, reportingPeriodId)`.
  - ADD UNIQUE `(activeKey)`.
- **Migration data step:** fill `activeKey` for all existing rows, since every existing row is active (hard delete means no revoked rows exist).
  - This is an UPDATE of a **new** column only. Existing values are untouched.
  - It is done inside M3 before the unique constraint is added. Existing uniqueness guarantees there are no duplicates.
- **Re-grant [Confirmed Q-C]:** always a new row. Revoked rows are never updated again.
- **Reads:** `verifierScope`, `grantedPeriods` and lists filter on `revokedAt IS NULL`. History views show every row.
- **Historical hard-deleted grants** exist only in `verifier.access_revoked` audit entries and are not reconstructed.
- **Protected period** = `status = LOCKED` OR an active grant exists.

### 4.10 Boundary audit

No schema change. The `boundary.saved` audit gains `before` and `after` values (the AuditLog has `before`/`after` Json [Verified]).

## 5. Proposed API changes [Proposed]

### 5.1 New

| Method / path | Permission | Purpose |
|---|---|---|
| `GET/POST /sites`, `PATCH /sites/:id`, `POST /sites/:id/deactivate` | read `org.read`, write `site.manage` | sites |
| `GET /facilities/:id/site-history` | `org.read` | placement history |
| `POST /facilities/:id/place` `{siteId, effectiveFrom, reason}` | `site.manage` | first placement or move |
| `POST /facilities/:id/unplace` `{effectiveFrom, reason}` | `site.manage` | close open row |
| `GET /facilities/:id/move-impact?date=` | `site.manage` | spanning records, assignment effects, protected-period check |
| `GET/POST /assignments`, `POST /assignments/:id/revoke` | `assignment.manage` | manage |
| `GET /assignments/proposals`, `POST /assignments/proposals/confirm` | `assignment.manage` | migration proposals |
| `GET /assignments/enforcement-impact` | `assignment.manage` | Q-D impact screen data |
| `POST /organizations/current/assignment-enforcement` `{enabled, acknowledged, reason}` | `assignment.manage` | per-org switch |
| `GET /setup/status` | `org.read` | 8-step completion |
| `GET /emission-sources/review-list`, `POST /emission-sources/:id/confirm-category`, `POST /emission-sources/:id/replace` | `org.manage` | classification, D4 |
| `GET/PUT /boundary`, `POST /boundary/approve`, `POST /boundary/new-version`, `GET /boundary/history` | `boundary.manage` | tenant boundary |
| `POST /reporting-periods/:id/reapply-boundary` `{boundaryId, reason}` | `period.manage` | §4.8 |

### 5.2 Changed

| Route | Change |
|---|---|
| Context-aware GETs (§6.3) | accept `siteId` (incl. `unassigned`, `legacy`) with existing `facilityId` |
| `/platform/organizations/:id/boundary*` | PUT / approve / new-version **removed** [Confirmed Q-B]; GET boundary + history kept read-only |
| `PATCH /emission-sources/:id` | 409 on facility/category/activityCode once records exist |
| `DELETE /verifier-grants/:id` | soft revoke (activeKey → null) |
| `POST /verifier-grants` | new row; 409 if active grant exists |
| Data Entry-reachable routes | `dataEntryScope` when org enforced |
| `/reporting-periods/:id/checklist`, `/lock` | blocking item: submitted/approved records spanning a site move |
| `/activities` create/update/submit | spanning-move validation |
| `/fuel-properties*` | facility scoping |

**Unchanged:** factor routes, `factor.approve`, review routes, verifier portal, queries, platform factor and activity-type routes.

## 6. Proposed frontend changes [Proposed]

### 6.1 Navigation

- The "Administration" group is replaced by **Organisation Setup** (`/setup/:step`).
- The old routes stay registered and redirect.
- The sidebar entries are removed only when Stage 2 is accepted.

### 6.2 Setup steps

| Step | Reuse | New |
|---|---|---|
| 1 Profile | OrganizationProfilePage | — |
| 2 Boundary | BoundarySetupPage on tenant API | effective-date picker, protected-period messages |
| 3 Periods | ReportingPeriodsPage | reapply-boundary action on reopened periods |
| 4 Sites & Facilities | FacilitiesPage | sites, place/move/unplace with impact preview, unassigned banner, history |
| 5 Sources | EmissionSourcesPage | review list, confirm category, replace source |
| 6 Users & Assignments | UsersPage | assignment editor, proposals, impact screen, enforcement switch |
| 7 Tenant Settings | TenantSettingsPage | — |
| 8 Review & Confirm | — | summary from `/setup/status` |

- **Save and resume:** each step saves through its own API; completion is worked out from data.
- **Completion rules:** as in the original plan, except Step 6. Step 6 is complete when enforcement is on, or when it is off and every Data Entry user has at least one ACTIVE assignment.

### 6.3 Global context header

- **`ContextBar`:** organisation, location (All · Site · Facility · Unassigned facilities · Site not recorded, the last shown only on result views) and period.
- **State:** the URL query, through `useWorkspaceContext()`. localStorage holds the viewer's last choice only.
- **Data Entry users** see only the sites and facilities they cover today (§7.2).
- **Pages that use the context:**
  - ActivityPages, ActivityEntryPage;
  - DocumentsPage, DataQualityPage, ReconciliationPage;
  - CalculationsPage (results);
  - AnalyticsPage, ReportsPage, AuditWorkspacePage;
  - CarbonIntelligencePage, RenewablesPage;
  - FuelPropertiesPage;
  - PeriodClosePage (organisation only).

### 6.4 Workspaces

- **Org:** a breakdown by site, with separate Unassigned and Site-not-recorded rows.
- **Site:** a breakdown by facility.
- **Facility:** a breakdown by source, plus data entry.
- **Organisation-only:** run, confirm warnings, lock, reopen, re-apply boundary. These are hidden at lower levels and rejected by the server.

## 7. Permission and security [Proposed]

### 7.1 Permissions

| New permission | Roles |
|---|---|
| `site.manage` | TENANT_ADMIN |
| `assignment.manage` | TENANT_ADMIN |
| `boundary.manage` | TENANT_ADMIN |
| `boundary.read` | TENANT_ADMIN, REVIEWER, VERIFIER (granted periods) |

**Super Admin [Confirmed Q-B]:**
- **Cannot** save, approve or create boundary versions.
- **Keeps** a read-only boundary and history view under the existing `sa` guard, with the same fields Super Admin can read today.
- **Gains no access** to tenant activity records, evidence, documents, calculation results or tenant emission factors.

Tenant isolation is not weakened. T22 and T46 prove it.

Reviewer, Verifier and Data Entry permissions are unchanged.

### 7.2 Data Entry assignment semantics (exact) [Proposed]

**Validation on create:**

| Rule | Reject when |
|---|---|
| Level and target | SITE without siteId or with facilityId; FACILITY without facilityId or with siteId; ORGANISATION with either |
| Same organisation | site/facility/user not in the org; site or facility inactive |
| Role | user has no active DATA_ENTRY membership |
| Category within scope | `ghgCategory` set and its scope ≠ `scope` (e.g. scope S1 + S2_ELECTRICITY; scope S1 + REMOVALS) |
| Duplicate | an ACTIVE or PROPOSED row with identical (user, level, siteId, facilityId, scope, ghgCategory) exists. Service check under a `SELECT … FOR UPDATE` on the **User's Membership row** (stable parent) |

**What an assignment covers:** a set of categories at a set of facilities.

| scope | ghgCategory | Categories covered |
|---|---|---|
| null | null | all six S1_* and S2_* categories, **never REMOVALS** |
| S1 | null | S1_STATIONARY, S1_MOBILE, S1_FUGITIVE, S1_PROCESS |
| S2 | null | S2_ELECTRICITY, S2_HEAT_STEAM_COOLING |
| REMOVALS | null or REMOVALS | REMOVALS only |
| null | X | X only (scope implied by X; REMOVALS allowed only if X = REMOVALS explicitly) |
| S1/S2 | X in that scope | X only |

| level | Facilities covered, **evaluated at date d** |
|---|---|
| ORGANISATION | every active facility of the org |
| SITE S | facilities whose **FacilitySiteHistory row covering d** has siteId = S |
| FACILITY F | F |

- **Status:** only `ACTIVE` counts. `PROPOSED` and `REVOKED` grant nothing.
- **No rows:** with no ACTIVE rows, coverage is empty. There is no fallback.
- **Sources with a null ghgCategory** (on the review list) are covered **only** by FACILITY-level assignments with scope null and category null. No other assignment reaches them, so ambiguity can't widen access. They become generally assignable once the Tenant Admin confirms a category.
- **Same scope and category at several levels:** a user may hold them; coverage is the union. Union can never exceed ORGANISATION × all S1/S2.

**Which date d is used [Proposed; decision Q-F below]:**

| Use | d |
|---|---|
| Facility and site selectors, source lists, "can I create here" | **today** |
| Create, edit or submit of a record | the record's **startDate** |
| Reading own records | not date-dependent: own records are always readable (read-only when not writable) |

**Behaviour on a move** (Manufacturing Plant moves HYD→BLR, effective 1 Feb):
- **HYD-assigned user:**
  - from 1 Feb, Manufacturing Plant disappears from their selectors;
  - they can't create or edit records with startDate ≥ 1 Feb;
  - their own January drafts stay editable, because January was at HYD.
- **BLR-assigned user:**
  - from 1 Feb, Manufacturing Plant appears;
  - they can enter records with startDate ≥ 1 Feb, but not January ones.
- **Everyone:** own past submissions stay readable.
- **Results:** stored results keep their attribution.
- **Audit:** the move audit stores the placement change and the list of users whose coverage changed (the impact preview, saved).

**Q-F [Confirmed, with clarification]:** a Data Entry user may edit a draft only when **all** of the following are true at the time of the request:
1. the draft is **their own** (`createdById`), and its status is Draft or Returned;
2. they hold an assignment with status **ACTIVE**. REVOKED and PROPOSED assignments grant nothing;
3. that assignment covers the draft's **facility**, resolved for the draft's **startDate** (FACILITY: same facility; SITE: the placement covering startDate has that site; ORGANISATION: any facility);
4. that assignment covers the draft's source **category** (§7.2 category table).

So drafts starting **before** the move date are covered by an **old-site** assignment, and drafts starting **on or after** it by a **new-site** assignment. Records whose dates span the move date can't be submitted until they are split or corrected (§4.4 of ARCH, T9).

**Read rule (D3):** `createdById = current user`, independent of coverage. Any other record, evidence, document, fuel property or finding returns **404**.

**Write rule:** own ∧ covered at the record's startDate for the source's category ∧ status Draft or Returned ∧ the period is open (existing check).

| Endpoint group | Read | Write |
|---|---|---|
| `/facilities`, `/emission-sources`, `/organizations/current` | covered today | – |
| `/activities*` (list, summary, check, :id) | own | own ∧ covered ∧ Draft/Returned |
| evidence (`/activities/:id/evidence`, `/evidence/:id*`) | via parent record | via parent record |
| `/documents*` | own uploads | own; link only to own covered record |
| `/data-quality` | findings on own records | – |
| `/reconciliations*` | own records | own records |
| `/fuel-properties*` | facility covered today | facility covered ∧ own Draft |
| `/emission-factors`, `/unit-requests` | unchanged | unchanged |
| reports / analytics / insights / renewables / export | not reachable today [Verified] | – |

Scoping only narrows access. Review, evidence, no-self-confirmation and factor governance run unchanged.

### 7.3 Migration of existing Data Entry users

1. **Release:** enforcement is off everywhere, so behaviour is unchanged.
2. **Proposals:** the server creates **PROPOSED** FACILITY-level rows from each user's own records, one per (facility, source ghgCategory). A null category produces scope null and category null at that facility, flagged.
3. **Confirmation:** the Tenant Admin edits and confirms the proposals, which become **ACTIVE**.
4. **Switching on [Confirmed Q-D]:** `GET /assignments/enforcement-impact` lists every Data Entry user with:
   - current access (all organisation records, read);
   - PROPOSED rows;
   - ACTIVE rows;
   - covered facilities × categories after enforcement;
   - a **"No access after enforcement"** flag.
   The switch needs `acknowledged: true` and a reason.
   - Users with no ACTIVE rows get **zero** access.
   - Unconfirmed PROPOSED rows grant nothing.
   - The audit stores the impact list (before and after for each user).
5. **Switching off** again is allowed and audited.

### 7.4 Organisation-only actions

Run, confirm warning, lock, reopen and re-apply boundary reject any site or facility context.

## 8. Calculation and reporting [Proposed]

- **Engine (Stage 7a):**
  1. Preload the history rows for all facilities in the run.
  2. For each record, find the row covering `startDate`. Write RECORDED with the site's id, code and name, or UNASSIGNED with nulls.
  3. Write `facilityCode` and `facilityName`.
  4. Boundary via `boundaryForPeriod` (§4.8).
  5. Grid: snapshot when the per-org D5 flag is on (Stage 7b), otherwise live. Record `gridSource`.
- **Unchanged:** formulas, factor selection, NCV/density, GWP, inclusion maths.
- **Aggregation over the selected run:**

| Level | Grouping |
|---|---|
| Org | all results |
| Site | RECORDED grouped by siteId; UNASSIGNED row; LEGACY_UNKNOWN row |
| Facility | facilityId |

- **Totals:**
  - gross = Σ tCO2e;
  - counted = Σ tCO2e × inclusionPct / 100;
  - `biogenicTCO2` is a memo line only;
  - the C-08 removals line is separate.
- **Invariants:**
  - Σ facility = Σ (RECORDED sites + UNASSIGNED + LEGACY_UNKNOWN) = org = run.totals.
  - They are checked in tests and after each run. A mismatch is logged and audited, and the run is marked as needing review.
- **Stability:**
  - Locked periods never re-run.
  - A report reads only the run's stored columns.
  - Placement, name and assignment changes never rewrite stored results.
  - A re-run is a new run. The comparison lists changed grid, site, activity, factor and fuel-property version for each record.

## 9. Stage plan

Every stage ends with an **acceptance report** (template in §18). **A stage never proceeds automatically because its tests pass.** Each next stage needs its own approval.

### Stage 0 – Safety and baseline ✔ (completed under G0, 2026-11-24)

| Item | Result |
|---|---|
| Git | branch main, no commits, 17 untracked top-level entries |
| Tests / build | 255/255; backend and frontend typecheck OK; frontend build OK |
| Rollback archive | `~/TulaCarbon-Backups/stage0-2026-11-24/source-archive.tar.gz` (mode 600, folder 700), 475 entries, no secrets/customer docs/dumps |
| Local DB backup | `local-dev-db.dump.enc`, AES-256, key in macOS Keychain; restore-verified into a throwaway DB (counts match), throwaway dropped |
| Baseline note | `BASELINE.md` in the same folder |

### Stage 1 – Schema (M1, M2, M3) and pure helpers

| Item | Plan |
|---|---|
| Objective | Create migration **P2-A** (§11) and apply it to a **reset** local dev database and the test schema; `ghgCategoryOf` |
| Dependencies | G1 |
| Files | `backend/prisma/schema.prisma`; new `backend/prisma/migrations/<ts>_phase2_foundation/migration.sql`; `backend/src/calc/referenceData.ts` (`ghgCategoryOf`); `backend/tests/helpers.ts`; new `backend/tests/schema-phase2.test.ts`. **No** deploy-sql file, **no** backfill script, **no** controller |
| DB | local dev DB **reset and reseeded** (`prisma migrate reset` + existing `reference-seed.ts` / `zenith-test-seed.ts`); test schema reset by the harness. Live: untouched |
| API / FE | none (except the note) |
| Note | **[Confirmed Q-G]** M3 is **not** part of Stage 1; it moves to Stage 3. Stage 1 changes **no controller**: `verification.controller.ts` is removed from the Stage 1 file list |
| Tests | 255 existing green on the new schema; T6 (openKey unique, schema level); `ghgCategoryOf` over all 128 activity types; seed scripts run cleanly; `siteAttribution` default present |
| Data integrity | not applicable to dummy local data (Rev 4). Checked instead: migration applies cleanly from empty, and reseed succeeds |
| Rollback | local only: revert the code from the Stage 0 archive and `prisma migrate reset`. The Stage 0 encrypted dump remains available but is not required. No live effect |
| Acceptance | §18 |

### Stage 7a – Engine attribution

| Item | Plan |
|---|---|
| Objective | Engine writes RECORDED/UNASSIGNED, names, gridSource (live), boundary via `boundaryForPeriod` |
| Dependencies | Stage 1 (M1, M2). Stage 7a implements `boundaryForPeriod` rules 2–5. Rule 1 (reapplication) is added in Stage 3 with M3 |
| Files | `calc/service.ts`; new `services/siteResolver.ts`, `services/boundaryForPeriod.ts`; `tests/calculation.test.ts`; new `tests/sites-history.test.ts` |
| Tests | T1–T5, T23, T26, T37, T38, T42, T48, T49, T50; totals identical before/after on seed |
| Rollback | revert code → new results get LEGACY_UNKNOWN from the default (truthful); no data loss |

### Stage 3 – Site and facility management, verifier soft revoke (+ M3 if moved)

| Item | Plan |
|---|---|
| Objective | Sites, place/move/unplace with impact preview, protected periods, spanning-record checks and close blocker, verifier soft revoke + re-grant, reapply boundary API |
| Dependencies | 1, 7a |
| Files | new `controllers/sites.controller.ts`, `services/protectedPeriods.ts`; `facilities.controller.ts`; `activities.controller.ts`; `periodClose.controller.ts`; `verification.controller.ts`; `services/verifierScope.ts`; `reportingPeriods.controller.ts`; `routes/index.ts`; `permissions.ts`; FE FacilitiesPage + dialogs; `types/api.ts`; **P2-B migration** `<ts>_phase2_verifier_periods/`; new `services/schemaGuard.ts`. No deploy-sql file (pre-deployment stage) |
| Schema guard (Q-G) | At server start, `schemaGuard` checks that `VerifierGrant.activeKey`, `revokedAt` and `PeriodBoundaryReapplication` exist. If not, the server **refuses to start**: "Database schema is older than this application (M3 missing)". So the Stage 3 verifier code cannot run before M3. The deploy runbook (§16) also applies M3 before the code is switched |
| Tests | T6–T9, T24, T25, T30, T39, T43, T44, T47, T51, T52, T57, T58, T59 |
| Rollback | code revert is safe for sites; **verifier part follows §15 M3 procedure** |

### Stage 2 – Organisation Setup and tenant boundary

| Item | Plan |
|---|---|
| Dependencies | 3 |
| Files | new `pages/SetupPage.tsx`, `controllers/setup.controller.ts`; `nav.ts`; `AppRoutes.tsx`; `BoundarySetupPage.tsx`; `AdminPages.tsx`; `UsersPage.tsx`; `boundary.controller.ts`; `emissionSources.controller.ts`; `routes/index.ts` |
| Tests | T15, T17–T19, T22, T34, T46 |
| Rollback | code revert; old routes still exist; no schema |

### Stage 4 – Assignments and enforcement

| Item | Plan |
|---|---|
| Dependencies | 1, 2, 3 |
| Files | new `services/dataEntryScope.ts`, `controllers/assignments.controller.ts`; activities, evidence, documents, dataQuality, reconciliation, fuelProperties, facilities, emissionSources, organizations controllers; `routes/index.ts`; `permissions.ts`; FE UsersPage; new `tests/assignments.test.ts`, `tests/data-entry-scope.test.ts` |
| Tests | T10–T14, T27, T28, T31–T33, T41, T53, T54, T55 |
| Rollback | per-org switch off (instant); code revert safe (assignment rows inert) |

### Stage 6 – Context header

| Dependencies | 3, 4 |
|---|---|
| Files | new `components/ContextBar.tsx`, `hooks/useWorkspaceContext.ts`, `middleware/context.ts`; AppLayout, OrgPicker, all §6.3 pages, controllers in §3 |
| Tests | T35; per-page context propagation; no page-level facility selects remain |
| Rollback | code revert |

### Stage 5 – Workspaces

| Dependencies | 6, 7a |
|---|---|
| Files | ActivityPages, AnalyticsPage, ReportsPage, CalculationsPage, PeriodClosePage; `analytics.controller.ts`, `reports.controller.ts`, new `services/aggregate.ts` |
| Tests | T3, T4, T20, T21, T49; per-level CSV reconciles |
| Rollback | code revert |

### Stage 7b – Grid snapshot flag and run comparison

| Dependencies | 7a; **A2 before any org flag is switched on** |
|---|---|
| Files | `calc/service.ts`, `calculations.controller.ts`, CalculationsPage (the flag column already exists from P2-A) |
| Tests | T16; comparison output |
| Rollback | flag off; code revert |

## 10. File-level change inventory

The per-stage file lists in §9 are authoritative.

**Not touched in any stage:**
- the HTML reference;
- `.env*`;
- existing `deploy-sql/*.sql` (only new files are added);
- factor values;
- `calc/methods/*` formulas;
- `deploy-sql/0-DELETE-ALL-DATA-KEEP-TABLES.sql`, which is never run.

## 11. Definitive migration sequence [Proposed]

**Rev 4 authoritative sequence (supersedes the table above):**

| Migration | Contents | Created and applied locally | First written by | Live |
|---|---|---|---|---|
| **P2-A `phase2_foundation`** | Site; FacilitySiteHistory (+ unique openKey, CHECK validTo ≥ validFrom); Facility.siteId; DataEntryAssignment; Organization.assignmentsEnforced(+At/ById); **Organization.gridFromSnapshot NOT NULL DEFAULT false**; GhgCategory enum; EmissionSource.ghgCategory(+ConfirmedById/At); CalculationResult siteId, siteCode, siteName, facilityCode, facilityName, **siteAttribution NOT NULL DEFAULT LEGACY_UNKNOWN**, gridSource; indexes | Stage 1 (local DB reset) | 7a (results), 3 (sites), 4 (assignments), 7b (flag) | pre-deployment stage, after A2 |
| **P2-B `phase2_verifier_periods`** | PeriodBoundaryReapplication; VerifierGrant revokedAt, revokedById, activeKey (+ fill for existing rows, UNIQUE); DROP UNIQUE (userId, reportingPeriodId) + plain index | Stage 3 [Confirmed Q-G], with the schema guard | Stage 3 | pre-deployment stage, after A2, before Stage 3 code |
| Backfill | none in Phase 2 locally | – | – | only if A2 shows real live sources; separate approval |
| MySQL upgrade SQL | not written during build stages | – | – | written in the pre-deployment stage against the live version from A2; tested on a matching local MySQL |

`LEGACY_UNKNOWN` is kept (Q-A). After a local reset no local row has it, but it is the truthful default for any pre-existing **live** result, and it costs one enum value.

**[Confirmed Q-G]** P2-B (old M3) is created and applied in **Stage 3**, together with the code that depends on it, and the schema guard enforces that order. The approved stage order is unchanged.

| Migration | Contents | Created in | Applied locally in | First written by | Depended on by | Required for acceptance of |
|---|---|---|---|---|---|---|
| M1 `sites_assignments` | Site; FacilitySiteHistory (+openKey unique); Facility.siteId; DataEntryAssignment; Organization.assignmentsEnforced*; GhgCategory enum; EmissionSource.ghgCategory* | Stage 1 | Stage 1 | Stage 3 (sites/history), Stage 4 (assignments, enforced flag), backfill only on approval (ghgCategory) | 7a, 3, 2, 4, 6, 5 | Stage 1 |
| M2 `result_snapshots` | CalculationResult siteId, siteCode, siteName, facilityCode, facilityName, **siteAttribution NOT NULL DEFAULT LEGACY_UNKNOWN**, gridSource; indexes | Stage 1 | Stage 1 | Stage 7a | 7a, 5, 7b | Stage 1 |
| M3 `period_protection` | PeriodBoundaryReapplication; VerifierGrant revokedAt, revokedById, activeKey (+fill existing, + UNIQUE); **DROP UNIQUE (userId, reportingPeriodId)**, ADD INDEX | **Stage 3 [Confirmed Q-G]** | Stage 3 | Stage 3 | 3; `boundaryForPeriod` rule 1 | Stage 3 |
| M4 `grid_flag` | Organization.gridFromSnapshot bool NOT NULL DEFAULT false | Stage 7b | Stage 7b | Stage 7b (flag stays false) | 7b | Stage 7b |
| Triggers (optional) | MySQL history immutability | separate file | never without separate approval | – | – | – |
| Backfill (data) | ghgCategory for CONFIDENT sources | script in Stage 1 | **dry run only**; execute only on separate approval | – | Stage 4 proposals quality (not required) | – |

**MySQL:** each migration has a matching **new** file in `deploy-sql/`, written but not run. Each file is checked in a local MySQL/MariaDB container (T40). Matching the engine version needs A2.

## 12. Backward compatibility [Proposed, corrected]

| Situation | Compatible? |
|---|---|
| Old code on M1 | yes: new tables unused, new columns nullable |
| Old code on M2 | yes: `siteAttribution` default fills inserts; old code's results become LEGACY_UNKNOWN (truthful) |
| Old code on M3, **before** any revoke/re-grant by new code | **Partially.** Reads work. But old `createGrant` relies on the dropped unique index and doesn't set `activeKey`, so the database would no longer block a duplicate grant. **Old code must not run on M3** (R6) |
| Old code on M3, **after** new code soft-revoked or re-granted | **no**: old code ignores `revokedAt`, so a revoked verifier regains access, and duplicate rows break old assumptions |
| New code, enforcement off, no sites | behaves as today (T13) |
| Existing results | LEGACY_UNKNOWN → "Site not recorded"; facility shown with current name and a "name at calculation not recorded" hint; **never** shown as Unassigned |
| Old URLs | redirect to Setup steps |

**Conclusion:** M1 and M2 are backward-compatible. **M3 is not backward-compatible** once the new code has used it, so M3 and its code must be deployed and rolled back together (§15).

## 13. Existing customer-data protection

- **Local (Rev 4):** dummy data. It may be reset and reseeded at any stage, with no preservation steps.
- **Live:** treated as real until A2 shows otherwise.
  - No migration changes an existing value. The only writes are the `siteAttribution` default and P2-B filling the new `activeKey`.
  - No invented placements or assignments.
  - Any backfill needs a dry run and separate approval.
  - A2 is needed for any read; a separate deploy approval and a verified backup are needed for any write.
- **Future real data:** all safeguards apply in full: snapshots, LEGACY_UNKNOWN for pre-existing rows, never-guess boundary rule, append-only history, soft revoke, audit.

## 14. Testing [Proposed]

**Environments:**
- Local Postgres test schema.
- Local MySQL/MariaDB container for T40 and T47. The live engine version is **[A2]**.

**Regression:** all 255 existing tests stay green at every gate. Tests that are intentionally changed are listed in the stage report:
- verifier hard delete becomes soft revoke;
- the unique-violation path on grant creation;
- Super Admin boundary writes;
- source PATCH of frozen fields.

| # | Case | Expected |
|---|---|---|
| T1 | Plant at HYD (1 Jan) → BLR (1 Feb); Jan record 10 t, Feb record 12 t; FY Jan–Dec; run in March | Jan result RECORDED HYD, Feb RECORDED BLR; HYD 10, BLR 12, org 22 |
| T2 | Run in Jan (before move registered) then move registered then March re-run | first run's Jan result unchanged (stored row untouched); March run: Jan HYD, Feb BLR |
| T3 | Invariants | Σ facility = Σ (sites + UNASSIGNED + LEGACY_UNKNOWN) = org = run.totals |
| T4 | No double counting | each result appears once per level |
| T5 | Facility never placed | results UNASSIGNED; shown under "Unassigned facilities"; totals reconcile |
| T6 | Overlapping placement; second open row (incl. two concurrent place requests) | 409; exactly one open row (openKey unique) |
| T7 | Move dated in a locked period | 400 |
| T8 | History immutable | no route updates/deletes rows other than closing |
| T9 | Draft/Returned record spanning move date | submit blocked with split message; split creates two drafts |
| T10 | DE requests another user's record/evidence/document/fuel property/finding by ID | 404 on every route |
| T11 | DE and uncovered facility | absent from lists; create → 404 |
| T12 | DE reassigned away | own past records readable, not editable |
| T13 | Enforcement off | behaviour identical to today; all existing tests green |
| T14 | Reviewer / Verifier | existing permission tests unchanged and green |
| T15 | Source with records: PATCH facility/category/activity | 409; name edit OK |
| T16 | D5 flag on: unapproved draft grid edit | next run unchanged; gridSource = SNAPSHOT |
| T17 | New boundary version dated ≤ latest protected period end, or not a period start | 400 |
| T18 | Lock (run R1, boundary B1) → approve B2 → reopen → re-run | re-run uses B1, found through the LOCKED event's runId (finalRunId is null after reopen); B2 is used only after an explicit re-application |
| T19 | Boundary save | audit before/after present |
| T20 | Removals | never in S1/S2 at any level |
| T21 | Run/lock/reopen/reapply with site or facility context | rejected; controls absent in UI |
| T22 | Super Admin on every tenant data route | 403/404 |
| T23 | Formulas C-01…C-21 | unchanged, green |
| T24 | Approved record spanning a move registered later | listed in move impact; period lock refused until returned, split, re-approved; record's site never silently changed |
| T25 | Move/boundary date reaching a period with an active verifier grant | refused; allowed only after soft revoke + reason; earlier runs unchanged |
| T26 | Rename site and facility after a run | stored report shows original names |
| T27 | DE fuel property for uncovered facility | 404 |
| T28 | DE factor draft with enforcement on | still needs evidence and a different Reviewer; `factor.approve` unchanged |
| T29 | TA approves own record / fuel property | "self-approved" label on review, record and verifier views |
| **T30** | Revoke a grant, then grant the same verifier the same period again | **original row unchanged (revokedAt, revokedById kept, activeKey null); a new row is created with its own grantedBy/createdAt and activeKey set; verifier has access via the new row only; both rows visible in history; both actions audited** |
| T31 | Plant moves HYD→BLR effective 1 Feb | HYD-assigned user: Plant not in selectors from 1 Feb; cannot create/edit records with startDate ≥ 1 Feb; own Jan drafts editable (Q-F); BLR-assigned user: can enter ≥ 1 Feb, not Jan; own past records readable to both |
| T32 | Proposals | from own history only; none for users without history; PROPOSED grants nothing |
| **T33** | Enable enforcement while user U has no ACTIVE assignment | **impact response lists every DE user, flags U "No access after enforcement"; request without `acknowledged: true` → 400; with acknowledgement + reason → enabled; U then gets 404/empty everywhere; audit stores the impact list; no fallback access** |
| T34 | Setup status for a fully configured existing org | all steps complete without input |
| T35 | Foreign-org siteId/facilityId; DE uncovered site | 404 |
| T36 | Backfill dry run | writes nothing |
| T37 | Biogenic | memo at every level, never in totals |
| T38 | Inclusion % | counted identical at org and Σ sites |
| T39 | Unplace then later record | UNASSIGNED |
| T40 | MySQL container | new SQL applies; openKey/activeKey uniqueness behaves as Postgres |
| T41 | Route sweep | every route reachable by DATA_ENTRY enumerated from `routes/index.ts` and covered by a scope test |
| T42 | Pre-M2 results | LEGACY_UNKNOWN, labelled "Site not recorded", separate row from UNASSIGNED; engine never writes LEGACY_UNKNOWN |
| T43 | Second active grant attempt | 409 |
| T44 | Reapply boundary on reopened period | lock events, original run and results unchanged; reapplication row has boundary, previous boundary, reason, actor, time; next run uses it |
| T45 | Backfill dry run report | every source listed with classification and expected count |
| **T46** | Super Admin boundary | PUT/approve/new-version → 403/404; GET boundary/history → 200 with only boundary fields |
| **T47** | Concurrency: two simultaneous grant requests (same user, period), run on Postgres and MySQL | exactly one succeeds, the other 409; one active row |
| **T48** | Same scenario with both UNASSIGNED and LEGACY_UNKNOWN results in one period (old run + new run compared) | two separate rows in site breakdown; never merged |
| **T49** | Facility move after a stored run | stored run's results byte-identical before and after the move |
| **T50** | Locked run with null boundary, reopened, re-run | re-run uses no boundary unless reapplied |
| **T51** | Two concurrent moves of the same facility | serialised by Facility row lock; one succeeds, other 409 or sees new state |
| **T52** | Reapply on a never-locked open period | 400 |
| **T53** | Invalid assignment combinations (scope S1 + S2_ELECTRICITY; SITE without siteId; ORG with facilityId; user not Data Entry) | 400 each |
| **T54** | Assignment scope null, category null | covers six S1/S2 categories, never REMOVALS; REMOVALS source → 404 |
| **T55** | Source with null ghgCategory | covered only by FACILITY assignment with scope and category null |
| **T56** | Q-F: user U has a SITE HYD assignment; Plant moves HYD→BLR on 1 Feb. (a) U edits own Jan draft; (b) U edits own Feb draft; (c) U's HYD assignment is revoked, then U edits own Jan draft; (d) U edits another user's Jan draft; (e) U submits own draft spanning 25 Jan–5 Feb | (a) allowed; (b) 404/403; (c) refused, draft readable only; (d) 404; (e) blocked with split message |
| **T57** | Period with `status = LOCKED`, `lockedAt` null, no lock events (October-era fixture); reopen and run | run refused with the "original boundary not recorded" message; after explicit re-application with reason, run uses the chosen boundary; nothing inferred |
| **T58** | Start Stage 3 code against a schema without M3 | server refuses to start with the schema-guard message |
| **T59** | LOCKED event whose `runId` refers to a missing run | boundary UNKNOWN → run refused until explicit re-application |

## 15. Rollback strategy [Proposed, corrected]

Four distinct operations:

| Operation | What it means | Safe? |
|---|---|---|
| 1. Revert application code (local) | restore files from the Stage 0 archive or, once A1 granted, a commit | Safe for M1/M2-only stages. **Not on its own** once M3 is in use (old code ignores revocation) |
| 2. Revert local test/dev database | restore the Stage 0 encrypted dump into a fresh local DB, or `prisma migrate reset` on the test schema | Safe; local data is test data |
| 3. Roll back a live schema | run down-SQL on live | **Separate approval; see per-migration table** |
| 4. Recover from a failed deployment | restore the pre-deploy live backup taken immediately before (§16) | Safe for data up to backup time; anything written after is lost, so this is used only if the deploy failed before users wrote data |

| Migration | Rewrites existing rows? | Old code compatible? | Rollback safe? | If new code already wrote data | Could rollback destroy history? | Block rollback when |
|---|---|---|---|---|---|---|
| M1 | No | Yes | **Code rollback only.** The schema stays | sites, placements, assignments exist and stay, inert under old code | Dropping would destroy placement and assignment history, so **M1 is never dropped once used** | always, once any M1 table has a row (on live: always, after deployment) |
| M2 | No (default only) | Yes | **Code rollback only.** The schema stays | RECORDED/UNASSIGNED attribution and names stored; old code ignores them | Dropping would destroy historical site attribution, so **M2 is never dropped once used** | always, once any result has `siteAttribution ≠ LEGACY_UNKNOWN` |
| M3 | Fills new `activeKey` only | Only until new code revokes/re-grants | **Not safely reversible in general** | revoked rows and re-grant rows exist | **Yes**: restoring UNIQUE(userId, periodId) fails with duplicates; deleting rows to make it fit would destroy grant history | any row has revokedAt set, or any (user, period) has >1 row |

**M3: forward fix, not reverse** [Proposed]:
- **Preferred:** don't roll M3 back. If the new verifier code misbehaves, fix it forward. The schema stays, and the old behaviour (one active grant) is still guaranteed by `activeKey`.
- **Controlled rollback,** only if unavoidable and separately approved:
  1. Take a backup.
  2. Export every VerifierGrant row and the audit log to an archive table `VerifierGrantArchive`, created by the rollback script. Nothing is deleted from it.
  3. Keep only the **active** row for each (user, period) in VerifierGrant. Move revoked rows to the archive.
  4. Restore UNIQUE `(userId, reportingPeriodId)`.
  5. Drop `revokedAt`, `revokedById` and `activeKey`.
  6. Deploy the old code.

  No grant information is lost; it moves to the archive table. A revoked verifier stays revoked, because the row is no longer in VerifierGrant.
- **Dropping new tables or columns is not, by itself, a complete rollback** for any migration once the new code has written data.

**Rev 4:** for **local** databases, every rollback is simply revert the code, then `prisma migrate reset` and reseed. The rules below apply to **live and future real data** only.

**Summary: code rollback vs schema and data rollback [Confirmed R3-5]:**

| | Code rollback | Schema / data rollback |
|---|---|---|
| Stage 1 (P2-A) | revert code | local only: reset and reseed |
| Stage 7a, 2, 4, 5, 6, 7b | revert code; M1/M2 data stays and is inert | **none**: M1/M2 are never dropped after use |
| Stage 3 (M3) | **cannot revert code alone**: the old verifier code would ignore revocations, and the schema guard of the old code doesn't exist | forward fix preferred; controlled M3 rollback (above) only with separate approval |
| Failed live deployment before users wrote data | redeploy previous build | restore the pre-deploy backup (separate approval) |
| Failed live deployment after users wrote data | redeploy previous build only if its stage allows (rows above) | **no restore** (would lose user data); forward fix |

## 16. Deployment strategy [separate approval]

- **Nothing in this plan deploys.**
- **Pre-deployment stage (new, Rev 4; after all build stages, needs A2 and then Deploy approval):**
  1. Run the A2 inventory (§13, ARCH §13): engine and version; whether live data is real or disposable; live sources (backfill need); October-era locked or reopened periods; verifier grants; grid snapshot completeness; D-28, D-29 and TEST_SWITCH state.
  2. Write the MySQL upgrade SQL for P2-A and P2-B against that version, and test it on a matching local MySQL (T40, T47).
  3. If live data is real: add the backfill (dry run, then approved execution) and, if needed, the audit-log check for October-era periods.
  4. Prepare the P2-B forward-fix and controlled-rollback runbook.
- **When a deployment is approved:**
  1. Take a fresh live backup and verify that it restores (to a non-live database).
  2. Apply M1 and M2 together with the Stage 7a code, so the LEGACY_UNKNOWN gap stays minimal.
  3. Apply M3 **before** switching to the Stage 3 code. The schema guard refuses to start Stage 3 code without M3. The old code must not run on M3 (R6), so the switch is a single maintenance window.
  4. Every organisation starts with enforcement off and the D5 flag off.
- **The deploy zip** includes the MySQL Prisma client generated before `tsc`.
- **Pre-deploy checks:**
  - D-28 triggers, D-29 bootstrap password and TEST_SWITCH resolved;
  - A2 results: MySQL version, CHECK support, LOCKED lock events for live locked or reopened periods, grid snapshot completeness.

## 17. Risks and open items

| # | Item | Status |
|---|---|---|
| R1 | Missed Data Entry route | mitigated by T41 |
| R2 | MySQL CHECK support | **[A2]**; service check always present |
| R3 | D5 shifts open-period Scope 2 | **[A2]**; flag off |
| R4 | M3 not reversible after use | documented; forward-fix policy (§15) |
| R5 | Locked periods without lock history (October version) | **Local:** discarded by reset. **Future data:** always has history. **Live:** general guard refuses the run; extra audit-log check only if A2 shows real data |
| R9 | `PeriodLockEvent.runId` has no FK; the run could be missing | **Handled:** treated as UNKNOWN, never guessed (T59) |
| R10 | Live MySQL/MariaDB version for active-key and CHECK | verified on PG 17.11 and MySQL 9.7.1 locally; **live [A2]** |
| R11 | Whether live data is real or disposable | **Unknown [A2]**. Treated as real until shown otherwise; decides whether a backfill and the October audit-log check are needed |
| R12 | Local reset loses the current dummy data | accepted (Rev 4); Stage 0 encrypted dump still exists if ever needed |
| R6 | Old code inserting grants with null activeKey during a mixed deploy | deploy M3 only with new code; never run old code on M3 |
| R7 | Concurrency: duplicate assignments | service check under Membership row lock; duplicates are harmless (union) but rejected |
| R8 | Grid snapshot completeness on live boundaries | **[A2]** |
| Q-F | Write coverage by the draft's start date, ACTIVE assignments only | **Confirmed** (R3-1) |
| Q-G | M3 in Stage 3 with schema guard | **Confirmed** (R3-2) |

## 18. Stage acceptance report (required for every stage)

Each stage ends with a report containing all of the following. Approval of the next stage is a **separate explicit decision**.

1. Files changed (paths, new/modified)
2. Database and schema changes (migrations created and applied, where)
3. API changes
4. Frontend changes
5. Tests run, with counts and results (existing and new)
6. Existing behaviour preserved (named tests)
7. New behaviour verified (named T-cases)
8. Data integrity checks (row counts and checksums of existing tables before/after; invariant checks)
9. Known limitations
10. Rollback procedure for this stage (which §15 operation applies)
11. Approval needed before the next stage

| Stage | Minimum tests to pass |
|---|---|
| 1 | 255 existing green on the reset schema; T6 (schema level: openKey unique); `ghgCategoryOf` over 128 types; migration applies from empty; seed scripts succeed |
| Pre-deploy | T40 and T47 on MySQL matching live; T36 and T45 only if a live backfill is needed |
| 7a | totals identical before/after on seed; T1–T5, T23, T26, T37, T38, T42, T48, T49, T50 |
| 3 | T6–T9, T24, T25, T30, T39, T40 (M3 SQL), T43, T44, T47, T51, T52, T57, T58, T59 |
| 2 | T15, T17–T19, T22, T34, **T46 (Super Admin boundary writes refused, read-only view only)**; old URLs redirect; Administration entries removed only now |
| 4 | T10–T14, T27, T28, T31–T33, T41, T53–T56 |
| 6 | T35; every §6.3 page uses context |
| 5 | T3, T4, T20, T21, T48; per-level CSVs reconcile |
| 7b | T16; comparison output; flag remains off pending A2 |
| All | full catalogue green on Postgres; T40/T47 green on MySQL |

## 19. Approval gates (single table)

| Gate | Covers | Status |
|---|---|---|
| G0 | Stage 0: local baseline, archive outside project, encrypted local-dev DB backup | **GRANTED and completed 2026-11-24** |
| G1 | Stage 1: migration P2-A, local dev DB reset and reseed, `ghgCategoryOf`, schema tests. No live access, no deploy-sql file, no backfill | **NOT GRANTED** |
| G7a, G3, G2, G4, G6, G5, G7b | each later stage, after the previous stage's acceptance report | **NOT GRANTED** |
| Q-F | write coverage by draft start date, ACTIVE assignments only | **APPROVED with clarification** (not G1) |
| Q-G | M3 in Stage 3, schema guard | **APPROVED** (not G1) |
| Backfill | only if A2 shows real live sources; dry run then execution | **NOT GRANTED** (not needed locally) |
| Pre-deploy | A2 inventory, MySQL upgrade SQL, live runbooks | **NOT GRANTED** |
| D5-on | switching on grid-from-snapshot for any organisation | **NOT GRANTED** (needs A2) |
| A1 | any Git commit or push | **NOT GRANTED** |
| A2 | read-only live MySQL inspection (SELECT-only) | **NOT GRANTED** |
| Deploy | any live schema or application change, live rollback | **NOT GRANTED** |

---

*Planning document. No source code, schema, migration, SQL, HTML, environment file, data, Git history or production system was changed in preparing it.*
