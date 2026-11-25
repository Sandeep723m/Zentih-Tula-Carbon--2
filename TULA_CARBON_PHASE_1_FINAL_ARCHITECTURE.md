# Tula Carbon – Phase 1 Final Architecture

Status: **architecture decisions D1–D10 approved. Phase 2 has not started and needs its own explicit approval.** Nothing in this document has been implemented. Approvals A1 (Git commit) and A2 (live database inspection) are **not** granted.

Revision 2:
- Resolved Q2–Q5.
- Recorded D1–D10 as approved.
- Tightened Git safety.
- Added the decision register (§16) and the Phase 2 scope (§19).

**Labels used throughout:**

| Label | Meaning |
|---|---|
| **[Verified]** | Read in the current code, schema or files on this machine |
| **[Recommended]** | Proposed design. Not built, not tested |
| **[Assumption]** | Believed true but not checked |
| **[Pending approval]** | Needs a business decision (§16) |

Every design statement in this document is a recommendation. Only items marked [Verified] describe the application as it is today.

---

## 1. Executive summary

- **[Verified] Today's application structure**
  - Today the application has Organisation → Facility. There is no Site entity.
  - Records are owned by facilities.
  - Calculations run per organisation per reporting period, on approved records only.
  - Each result stores its own inputs and a copy of the factor it used.
  - Organisation-level period lock is the only final close.
  - 255/255 backend tests pass and the frontend builds.
- **[Recommended] Target structure**
  - Add Sites with **effective-dated facility placement**. A facility may stay unassigned.
  - Store the resolved `siteId` on every **CalculationResult** at run time, so historical site reports never move.
  - Organisation, Site and Facility workspaces all read the same records and results, filtered differently, so nothing is duplicated.
- **[Recommended] Data Entry assignments**
  - Data Entry assignments by facility (directly, or through a site or the whole organisation) × scope or GHG category.
  - The server enforces assignments **per organisation, only after the Tenant Admin confirms them**. There is no global deadline.
- **[Recommended] Calculation governance tightening (formulas unchanged)**
  - Scope 2 grid comes from the approved boundary snapshot.
  - A source's facility, category and activity type freeze once the source has records.
  - Explicit boundary effective dates.
- **[Verified] Two gaps found**
  - Data Entry users can currently read every record in the organisation.
  - Tenant Admins can approve their own activity records and fuel properties.

## 2. Current architecture findings

| # | Finding | Label |
|---|---|---|
| F1 | Stack: Express 5 + TypeScript, Prisma 7, React + Vite. Postgres locally; MySQL/MariaDB on the live host, where the schema changes are applied by hand-written SQL | Verified |
| F2 | Hierarchy: `Organization` → `Facility` → `EmissionSource` → `ActivityRecord`. No Site model | Verified |
| F3 | `ActivityRecord.facilityId` must equal its source's `facilityId` (`assertValidLinks`) | Verified |
| F4 | Calculation: `runPeriodCalculation` per organisation per period. Approved records only. Results carry `facilityId`, `inputs`, `factorValue`, `tCO2e` (unrounded) and `inclusionPct` | Verified |
| F5 | Boundary used by a run: the approved `OrgBoundary` with the highest version where `effectiveFrom ≤ period.startDate`. The share comes from `boundary.snapshot`. The run stores `boundaryId` | Verified |
| F6 | Scope 2 grid is read **live** from `Facility.gridLocation`, not from the snapshot. The snapshot's grid copy is unused | Verified |
| F7 | Boundary routes are Super Admin only. `newBoundaryVersion` copies the previous `effectiveFrom`. The `boundary.saved` audit entry has no before/after values | Verified |
| F8 | `updateSource` allows changing `facilityId`, `category` and `activityCode` even when the source has records | Verified |
| F9 | Data Entry holds `activity.read`, so it can list and open **all** records in the organisation. It can edit only its own Draft or Returned records | Verified |
| F10 | Data Entry does **not** hold `report.read`, `insight.use` or `renewables.read`. It has no reports, analytics or CSV export today. It does hold `quality.read`, `reconcile.read`, `factor.write` and `fuel.write` | Verified |
| F11 | A Tenant Admin may approve an activity record they created or updated (activities.controller, review handler). A Tenant Admin may also approve a fuel property they entered (fuelProperties.controller:96). A Reviewer may approve neither of their own | Verified |
| F12 | Nobody can confirm a calculation warning on their own record, Tenant Admin included (calculations.controller:149) | Verified |
| F13 | A locked period can be reopened with a reason. Its next run picks the boundary by the F5 rule again | Verified |
| F14 | Verifier scoping (`recordScope` / `grantedPeriods` in services/verifierScope.ts) is a working pattern for row-level scoping | Verified |

## 3. Final Organisation → Site → Facility architecture

```
Organization
 ├─< Site                      NEW  id, organizationId, code (unique per org), name, country?, isActive, timestamps
 ├─< Facility                  EXISTING  + siteId NULLABLE (= current placement, mirror of the open history row)
 │     ├─< FacilitySiteHistory NEW  facilityId, siteId, validFrom, validTo NULL=open, reason, createdById, createdAt
 │     └─< EmissionSource      EXISTING  facility/category/activityCode frozen once records exist (D4)
 │           └─< ActivityRecord  UNCHANGED (no site column)
 ├─< DataEntryAssignment       NEW  see §7
 ├─  Organization.assignmentsEnforced  NEW boolean, default false
 ├─< OrgBoundary               EXISTING  Tenant Admin owned; effective-date rule §10
 └─< CalculationRun            UNCHANGED
       └─< CalculationResult   EXISTING  + siteId, siteCode, siteName, facilityCode, facilityName (all NULLABLE,
                                           copied at run time; §12)
```

- **[Recommended] Site lifecycle:** Sites are deactivated, never deleted.
- **[Recommended] Facilities without a site:** a facility can exist with no site (`Facility.siteId = null`, no history row). This is the starting state for every existing facility after migration.
- **[Recommended] Example (Zenith Testing):**
  - Hyderabad Site holds Manufacturing Plant (HYD), Warehouse (HYD) and Office Building.
  - Bangalore Site holds Manufacturing Plant (BLR) and Warehouse (BLR).
  - Facilities with the same name at different sites are different facility rows with different codes. A *moved* facility keeps its row and changes site through history (§4).

## 4. Historical Site relationship design

### 4.1 Data rules [Recommended]

| Rule | How |
|---|---|
| R1. A facility may have no site | No history rows. `Facility.siteId = null` |
| R2. Assign an unassigned facility | Insert `{siteId, validFrom = chosen date, validTo = null}`. Set `Facility.siteId`. One transaction, audited |
| R3. Move between sites | Close the open row (`validTo = effectiveDate − 1 day`) and insert a new open row starting on `effectiveDate`. One transaction, audited with before/after |
| R4. No overlaps | Validated in the service inside the transaction. The service rejects any range that intersects an existing one. At most one open row per facility |
| R5. History is never deleted or edited | No delete endpoint. Corrections are a new move with a reason. A database trigger is optional on MySQL |
| R6. Moves cannot reach protected periods | `effectiveDate` must be after the end of the latest **protected** period. A protected period is one that is LOCKED **or** has any Verifier grant (Q4, §10.1) |
| R7. Only Tenant Admin | New permission `site.manage`, held by TENANT_ADMIN only |
| R8. Time before the first assignment | Dates before a facility's first `validFrom` resolve to **no site** ("Unassigned") |
| R9. Un-assigning | Allowed: close the open row. Facility.siteId becomes null. Later dates resolve to Unassigned |

### 4.2 How each record and result obtains its site [Recommended]

- **ActivityRecord:** stores **no** site. Its site is *derived* as the history row where `validFrom ≤ record.startDate ≤ coalesce(validTo, ∞)`, or Unassigned. Live views (record lists, the Facility→Site filter) use this lookup.
- **CalculationResult:** at run time the engine resolves the same lookup for each record and **writes `siteId` onto the result row**.
  - Storing one site on the *run* is **not** sufficient: a run covers a whole period in which a facility can change site.
  - Storing it on the *boundary snapshot* is **not** sufficient: site moves are not boundary approvals.
- **Stored results never change.** Reports read the stored `CalculationResult.siteId`.

### 4.3 Scenario: Manufacturing Plant moves from Hyderabad to Bangalore [Recommended design; becomes a test, §18]

**Setup:**
- Period FY2026 (Jan–Dec), open.
- History rows:
  - `{HYD, 2026-01-01, 2026-01-31}`
  - `{BLR, 2026-02-01, null}`
- Records:
  - January electricity, start date 2026-01-01, 10 t.
  - February electricity, start date 2026-02-01, 12 t.

**In March the period is recalculated:**
1. Record Jan: lookup at 2026-01-01 → HYD. The result is written with `siteId = HYD`.
2. Record Feb: lookup at 2026-02-01 → BLR. The result is written with `siteId = BLR`.
3. The February move does not change row 1, so January stays with Hyderabad on every re-run.

**Totals** (each result has exactly one facility and at most one site, so nothing is counted twice):
- HYD = 10, BLR = 12, Unassigned = 0.
- Organisation 22 = Σ sites (10 + 12 + 0).
- Site HYD 10 = Σ HYD facility results.

### 4.4 Records that span a move date [Recommended]

The site follows the record's **start date**. On create, edit and submit, if `startDate < moveDate ≤ endDate` for the record's facility:
- **Draft or submit:** blocking error *"This record covers dates at two sites (moved on 1 Feb). Split it into two records at the move date."* The UI offers a split helper that creates two drafts with quantities pro-rated by days. The user must confirm or edit the quantities; the system does not silently assume a pro-rata.
- **Draft or Returned records:** the record must be split before it can be submitted. The rule above is a hard block.
- **Submitted or Approved records that span a move** (the move was registered inside an open period) [Recommended, per Q3]:
  1. When the move is saved, the system **lists** every Submitted or Approved record that spans the move date, and the move dialog shows that list.
  2. Each listed record is marked "spans a site move" and appears on the data quality page.
  3. It becomes a **blocking** item on the period-close checklist. The period cannot be locked while any such record is unresolved.
  4. **Correction path (auditable, all existing mechanisms):**
     - A Reviewer or Tenant Admin returns the record with a reason.
     - The submitter splits it into two records at the move date.
     - Both records go through normal review and approval.
     - The original record's history and review trail are kept.
  5. **Never** silently reassign an approved record to a different site. Until it is corrected, the record's result keeps the site from its start date, and the record stays flagged.
- **Protected periods:** a move date can be set only after the end of the latest protected period (R6), so locked or verified records never need splitting.

### 4.5 How unassigned facilities appear [Recommended]

- **Organisation workspace:** facilities with no site are grouped under **"Unassigned facilities"**. In site breakdowns this group is a pseudo-site row, so totals still reconcile.
- **Site selector:** the list shows the real sites plus "Unassigned facilities". The Unassigned group gets no site dashboard, only a list.
- **Organisation Setup → Sites step:** shows a banner "N facilities are not placed in a site", with a bulk "Assign to site" action (choose site and effective date).
- **Facility page:** shows a "Site: Not assigned · Assign" link. It also shows the full placement history, read-only.

## 5. Organisation, Site and Facility workspaces

### 5.1 One dataset, three filters [Recommended]

| Level | Records shown | Results shown |
|---|---|---|
| Organisation | all records in the org | all results of the latest run per period |
| Site S | records whose *derived* site (by start date) = S | results where `siteId = S` |
| Facility F | records where `facilityId = F` | results where `facilityId = F` |

- All three levels use the same tables, the same run and the same rounding (round once, at display).
- No site or facility copies of records or results exist.
- The context is held in the URL (`/o/...`, `/s/:siteId/...`, `/f/:facilityId/...`). Every API call sends the context, and the server validates it against the organisation and the user's assignments.

### 5.2 What each workspace contains [Recommended]

| Area | Organisation | Site | Facility |
|---|---|---|---|
| Dashboard | Org KPIs, site breakdown | Site KPIs, facility breakdown | Facility KPIs, sources |
| Activity records | consolidated list | site list | list + **data entry** |
| Evidence & documents | all | site's records | facility's records + upload |
| Review visibility | full queue | queue filtered to site | queue filtered to facility |
| Calculations | **run, confirm warnings** (org-wide) | site results (read) | facility results (read) |
| Emissions / analytics | consolidated + site/facility breakdowns | site + facility breakdown | facility, by source/category |
| Reports / CSV | org report | site report | facility report |
| Period close | **lock / reopen (only final close)** | readiness status only | readiness status only |

- **[Verified]** Calculation runs are organisation-wide today.
- **[Recommended]** Runs stay organisation-wide. Site and Facility workspaces show their slice of the latest run and the readiness for their slice. They cannot lock, unlock or run independently.
- **[Recommended]** Site and Facility reports carry the label "Part of [Organisation] [Period], status Provisional/Final". "Final" is shown only when the organisation period is locked.

## 6. Organisation Setup workflow [Recommended]

The 8 steps are as in the first report. Completion of each step is worked out from existing data, so existing customers re-enter nothing.

1. Organisation details
2. **Sites** (optional; can be skipped; unassigned facilities are allowed)
3. Facilities (existing facilities are shown complete; place them in sites)
4. Boundary (Tenant Admin edits and approves; versioned, §10)
5. Emission sources (existing sources shown, plus the review list from §9)
6. Users & **Data Entry assignments** (proposed from history, confirmed, then enforcement switched on, §7)
7. Reporting periods
8. Ready check

## 7. Data Entry assignment model

### 7.1 Assignment shape [Recommended]

```
DataEntryAssignment { id, organizationId, userId,
                      level: ORGANISATION | SITE | FACILITY, siteId?, facilityId?,
                      scope: S1 | S2 | REMOVALS | null, ghgCategory?: <one of §9 categories> | null,
                      createdById, createdAt, revokedAt?, revokedById? }
```

- **Coverage by level:**
  - An ORGANISATION assignment covers every facility.
  - A SITE assignment covers facilities whose **current** site is S. The derived current set is re-evaluated on every request, so a moved facility follows its new site.
  - A FACILITY assignment covers one facility.
- **Coverage by category:** `scope` alone covers every category in that scope. `ghgCategory` narrows to one. Both null means all Scope 1 + 2 categories. REMOVALS is never implied; it must be granted explicitly (D2).
- **Keeping site and facility consistent:** a FACILITY assignment is stored by facility. Its site is always derived, never stored, so the two cannot disagree. A SITE assignment cannot name a facility.
- **Shared assignments:** many users may share an assignment.
- **No hard deletes:** revoking sets `revokedAt`, so the history is kept.

### 7.2 Effective permission [Recommended]

`covers(user, facilityId, category)` = any unrevoked assignment matches.

| Action | Allowed when (enforcement ON) |
|---|---|
| See facility / site in selectors and lists | facility covered by ≥1 assignment; site shown if ≥1 of its facilities covered |
| See source | its facility + category covered |
| Create record | source covered and period open (existing checks kept) |
| Edit / delete / submit / upload evidence | **own** record (`createdById = user`) **and** covered **and** status Draft/Returned |
| Read own record + its evidence | always (also after reassignment → read-only "My earlier submissions") |
| Read other users' records | **no** (D3); returns **404**, not 403, so IDs cannot be probed |
| Unassigned facility, any record | 404 |

When enforcement is OFF, today's behaviour applies unchanged [Verified F9].

### 7.3 Endpoint enforcement inventory

All of these are reachable by Data Entry today [Verified]. The rule column is [Recommended].

| Endpoint | Rule |
|---|---|
| `GET /facilities`, `/emission-sources`, `/organizations/current` | filter to covered |
| `GET /reporting-periods` | unchanged (no facility data) |
| `GET /activities`, `/activities/summary`, `/activities/check`, `/activities/:id` | own records only; summary counts own only |
| `POST/PATCH/DELETE /activities`, `/activities/:id/submit` | §7.2 write rule |
| `POST /activities/:id/evidence`, `GET /evidence/:id/download`, `DELETE /evidence/:id` | via the parent record's rule |
| `/documents*` (intake, category, reject, link, file, retry) | own uploads only; link only to own covered records |
| `GET /data-quality` | findings on own records only |
| `/reconciliations*` | own records only |
| `GET /fuel-properties` | **Facility-scoped** [Recommended, Q2]. List only for covered facilities. `FuelProperty` has a required `facilityId` [Verified] |
| `POST/PATCH /fuel-properties*`, evidence upload | the facility must be covered, and the record must be the user's own Draft or Returned record. Approval stays with Tenant Admin/Reviewer under today's rules (D1 label for Tenant Admin self-approval) |
| `GET/POST /emission-factors` (organisation drafts, evidence, submit) | **Unchanged** [Recommended, Q2]. Organisation-wide reference data, governed by factor rules 1–10. Role permissions stay as they are. `factor.approve` stays REVIEWER-only and never applies to one's own factor |
| `GET/POST /unit-requests` | **Unchanged** [Recommended, Q2]. `UnitRequest` has no facility [Verified]. It is an organisation or platform request reviewed outside Data Entry |
| Rule for all three | Assignment scoping can only **narrow** what a user can see or do. It never grants a permission, skips a review step or approval, or removes the evidence and no-self-approval checks |
| Reports, analytics, insights, renewables, CSV export | **not reachable by Data Entry today** [Verified F10]. Must stay unreachable; if a facility dashboard is added for Data Entry it uses own-records summary only |

- **[Recommended] One helper does all the scoping:** a single server helper (`dataEntryScope(req)`, modelled on `recordScope` in verifierScope.ts [Verified F14]) returns the Prisma `where` clause.
- Every route above calls it.
- A test iterates over every route with a second user's record ID and expects 404.

### 7.4 Switching on enforcement [Recommended; Pending approval D8]

1. **Release:** `assignmentsEnforced = false` for every organisation. Behaviour is unchanged.
2. **Proposed assignments:** the system proposes FACILITY × category assignments from each Data Entry user's own record history, and shows them in Setup step 6. Users with no history get no proposal.
3. **Review:** the Tenant Admin reviews, edits and confirms the proposals.
4. **Activation:** the Tenant Admin switches on enforcement for that organisation. The switch is audited and can be turned off again.
5. **No automatic or global deadline.**

### 7.5 Unchanged [Recommended]

- Reviewer and Verifier permissions stay exactly as they are.
- Tenant Admin permissions are unchanged, except for two additions:
  - boundary ownership (moved from Super Admin);
  - `site.manage` and `assignment.manage`.
- Super Admin stays platform-level, with no tenant activity data and no tenant factors.

## 8. Role and permission matrix

| Capability | Super Admin | Tenant Admin | Data Entry | Reviewer | Verifier |
|---|---|---|---|---|---|
| Provision organisations | ✓ | – | – | – | – |
| Tenant activity data / tenant factors | **–** | ✓ | assigned, own (§7) | ✓ | granted periods, read |
| Sites, facility placement & moves | – | ✓ new | – | – | – |
| Boundary edit / approve / new version | – (moved) | ✓ new | – | read | read |
| Assignments manage / enforce switch | – | ✓ new | – | – | – |
| Create / submit records | – | ✓ | assigned | – | – |
| Approve records | – | ✓ (own: D1) | – | ✓ (not own) | – |
| Run calculation / confirm warnings | – | ✓ (not own warnings) | – | ✓ (not own) | – |
| Lock / reopen period (org only) | – | ✓ | – | – | – |
| Reports / analytics / export | – | ✓ | – | ✓ | granted |

Today's values are [Verified] from permissions.ts. Rows marked "new" or "moved" are [Recommended].

## 9. GHG category mapping

**Source of truth [Verified]:** `EmissionSource.category` (6 values) plus `ActivityType` (workbook category and `formulaCode`), derived by `formulaOf` and `sourceCategoryOf`. The workbook has 128 activity types, of which 104 are selectable. The HTML reference's categories were **not** copied.

| Source category | Activity types | Formula | Scope | GHG category | Status |
|---|---|---|---|---|---|
| FUEL_COMBUSTION | 53 stationary (incl. waste fuels) | C-01 | 1 | Stationary combustion | Verified |
| FUEL_COMBUSTION | 11 biogenic stationary | C-02 | 1 (biogenic CO₂ memo) | Stationary combustion | Verified |
| FUEL_COMBUSTION | 13 mobile | C-03 | 1 | Mobile combustion | Verified |
| FUEL_COMBUSTION | none set | – | 1 | **needs Tenant Admin confirmation** | Verified gap |
| FUGITIVE_GAS | 15 refrigerants/SF₆/NF₃/CO₂ | C-05 | 1 | Fugitive emissions | Verified |
| PROCESS | 10 industrial/waste | C-04 | 1 | Process emissions | Verified |
| PURCHASED_ELECTRICITY | A-GRID, A-GRID-OTH | C-06 / C-07 | 2 | Purchased electricity | Verified |
| PURCHASED_ENERGY | A-STEAM, A-HEAT, A-COOL | C-21 | 2 | Purchased heat, steam and cooling | Verified |
| REMOVAL | A-CO2-REC | C-08 | **none** | Carbon removals (outside S1/S2) | Verified |
| not selectable | A-PPA; 6 agriculture types | – | – | excluded | Verified |

- **Without an activity type:** FUGITIVE_GAS, PROCESS, PURCHASED_* and REMOVAL sources map to a single category even without an activity type [Verified]. Only FUEL_COMBUSTION without an activity type is ambiguous.
- **Scope 3 is excluded.**
- **Classifying existing sources [Recommended]:**
  1. **Confident:** the activity type is set and the name doesn't contradict it. All 13 showcase sources are confident [Verified].
  2. **Needs confirmation:** FUEL_COMBUSTION with no activity type.
  3. **Contradicting name:** the name contains fleet/vehicle/truck/car words but the activity is stationary (or the reverse). The likely case is D-12 "Disel for owned fleet" [Assumption].
  4. **Live sources:** unknown until the read-only inventory (§13).
- **Groups 2 and 3** go on a Tenant Admin review list. A source on the review list is excluded from category-level assignment until it is confirmed. It is still calculated exactly as today, so no figures change.
- **Carbon removals** are assignable as their own category (D2). They are never added to Scope 1/2 totals.

### Source freezing [Recommended; Pending approval D4]

| Field | After the first record exists |
|---|---|
| `facilityId`, `category`, `activityCode` | **Immutable.** The API returns 409 with a plain message |
| name, description, isActive, meter/reference fields | editable (audited) |

- **Corrections:** "Replace source" creates a new source (copying name and fields, with the new facility/category/activity) and deactivates the old one, so no new records go to it. Old records stay linked to the old source.
- **Reproducibility:** past results already store `inputs.activityCode`, the factor ID and value, and `facilityId` [Verified], so locked results are unaffected. Open-period re-runs stay consistent because the source can no longer change underneath them.
- **Already-wrong sources** (the review list): the Tenant Admin replaces the source. Existing records in **open** periods can be moved to the replacement only through return → edit → re-approve. That path is audited and keeps the review trail.

## 10. Boundary management and versioning

**Ownership:** the Tenant Admin edits, approves and creates versions (confirmed decision). The routes move from Super Admin to `boundary.manage` (TENANT_ADMIN).

**The seven proposed rules, checked against the code:**

| Rule | Conflict with current code? | Safe design |
|---|---|---|
| 1. One version per period by start date | None. This is today's F5 rule [Verified] | keep |
| 2. effectiveFrom = a period start date | `newBoundaryVersion` copies the old date [Verified F7] | require explicit date; validate it equals an existing or next period's `startDate` |
| 3. Not on or before the latest **protected** period end (locked, or any Verifier grant) | No check today | reject in API; exception path §10.1 |
| 4. No automatic overwrite of runs | None; runs keep `boundaryId` [Verified] | show "Boundary changed since last run" via existing run-comparison `boundaryChanged` |
| 5. Reopened periods keep their boundary | **Conflict:** a re-run of a reopened period re-selects by F5 and would silently adopt a newer version [Verified F13] | add `ReportingPeriod.pinnedBoundaryId`, set at lock from the final run. The engine uses the pinned boundary when present. "Re-apply" (Tenant Admin, reason ≥ 10 chars, audited) changes the pin |
| 6. Before/after in audit | `boundary.saved` has none [Verified F7] | store field-level diff in audit metadata |
| 7. Approved versions immutable | edits already blocked for approved [Verified]; no delete route | keep; add test |

- **Rules 3 and 5 together:** a new version can only start after every locked period. A reopened period is covered by rule 5, through its pin.
- **Wording:** in the UI, "effective date" always means the start of a reporting period.

### 10.1 Verifier-accessible periods (Q4)

- **[Verified] How verifier access works today:**
  - Verifier access is a `VerifierGrant` (one user, one period).
  - Revoking access (`DELETE /verifier-grants/:id`, permission `verifier.manage`) **hard-deletes** the grant and writes the audit entry `verifier.access_revoked`, which keeps the full grant as its `before` value.
  - There is no "closed" or "completed" state for a verification. Revoking is the only way to end access.
- **[Recommended] Protected periods:** a period is protected if it is LOCKED or has any Verifier grant. Retrospective site moves and boundary versions whose dates reach a protected period are refused.
- **[Recommended] Exceptional change** (Tenant Admin only). For example, correcting a site move date inside a verified, unlocked period:
  1. The Tenant Admin must first **revoke** the verifier's access, using the existing audited revoke. The system will not apply a change while a grant is live.
  2. The change itself needs a reason of at least 10 characters. It is written to the audit log as `site.move_exception` or `boundary.reapplied_exception`, with before and after values.
  3. **Earlier verified information is kept:** existing calculation runs, results and their snapshots are never edited or deleted. The change only affects the next run. The run comparison shows the difference against the run the verifier saw.
  4. Access can be granted again afterwards (audited) for re-verification.
- **[Recommended] Locked periods:** the existing audited reopen comes first (F13), followed by the same exception steps.

## 11. Calculation input governance

| Question | Answer | Label |
|---|---|---|
| Can an unapproved boundary draft affect calculations? | **Yes, for Scope 2 grid.** `saveBoundary` writes the live `Facility.gridLocation`, and the engine reads it live (F6). Shares are not affected (they come from the approved snapshot) | Verified |
| How should the grid be chosen? | `snapshot[facility].gridLocation` of the boundary used by the run. Fall back to the live value only if the run has no boundary or the facility is missing from the snapshot, and flag the result as "grid from facility record" | Recommended (D5) |
| Do old results keep their inputs? | Yes: `inputs` (grid, regionUsed, activityCode, NCV/density and their sources, fuel property version…), the factor ID and value, gases, `tCO2e`, `inclusionPct`; plus `boundaryId`, `gwpSet` and `engineVersion` on the run | Verified |
| How are changes between runs identified? | The existing comparison flags boundary/GWP/engine changes [Verified]. Extend it per result: grid, siteId, activityCode, factor ID, fuel property version | Recommended |
| How are site IDs stored? | `CalculationResult.siteId`, resolved per record at run time (§4.2) | Recommended |
| Locked periods | never recalculated | Verified |

**[Recommended] Unchanged:**
- formulas C-01 to C-21;
- factor governance rules 1–10;
- GWP selection, fuel properties, factor snapshots, engine version;
- audit history.

## 12. Reporting and aggregation logic [Recommended]

- **Per result:** `counted = tCO2e × inclusionPct / 100`. Gross and counted are kept separate [Verified, today].
- **Group by:** organisation (all results), `siteId` (null → "Unassigned"), `facilityId`, scope, GHG category. Removals are always a separate line.
- **Invariants:**
  - Σ facility = Σ site (including Unassigned) = organisation = `run.totals`.
  - Each result appears exactly once at every level.
  - Rounding happens once, at display.
- **Names in historical reports** [Recommended, Q5]:
  - Every result stores `siteId`, `siteCode`, `siteName`, `facilityCode` and `facilityName` **as they were at calculation time**, next to the existing `facilityId`.
  - Historical reports show these stored values. Renaming a site or facility later does not change them.
  - Live views (record lists, setup) show the current names.
  - Grouping always uses the stable IDs, never the names.
- **Existing runs** have `siteId = null` everywhere. The site breakdown shows "Site not recorded for runs before [release]", and the organisation and facility totals remain correct (D9).

## 13. Migration approach for existing data [Recommended]

| Step | Effect on existing data |
|---|---|
| Add `Site`, `FacilitySiteHistory`, `DataEntryAssignment` tables; nullable `Facility.siteId`, `CalculationResult.siteId/siteCode/siteName/facilityCode/facilityName`, `ReportingPeriod.pinnedBoundaryId`; `Organization.assignmentsEnforced=false` | additive only; no rows rewritten |
| Facilities | all stay unassigned until the Tenant Admin places them |
| Pin boundaries for already-locked periods | set `pinnedBoundaryId` from each locked period's final run `boundaryId` (copy of existing value) |
| Existing results | untouched (`siteId` null) |
| Source review list | computed read-only; no source changed |
| Live MySQL | hand-written additive SQL + `mysql-schema.mjs`, as today [Verified]; tested on a copy first |

**No customer re-enters data.**

**Live database: still unknown.** No connection was made, and no credentials were requested.
- Number of organisations, facilities, sources and records per organisation.
- Live sources with no activity type, or a contradicting name.
- Which periods are locked or reopened, and which have Verifier grants.
- Whether every active facility has a grid location in its approved snapshot.
- Whether live boundaries were approved before the snapshot included the grid.
- The live engine version, whether triggers (D-28) are applied, and whether the bootstrap password (D-29) and TEST_SWITCH are still in place.
- Server MySQL/MariaDB version (for overlap checks and triggers).

**Later, with separate approval:** a read-only inventory using `SELECT`-only queries run by you or under a read-only account, producing counts and the source review list only.

## 14. Git and deployment safety

**No Git commit is approved.** Approval A1 is separate, and this document does not grant it.

**[Verified] Current state:**
- There are no commits; every file is untracked.
- The existing `.gitignore` files cover:
  - `.env` and `.env.*` (except `.env.example`);
  - `node_modules`, `dist`, `backend/generated`, `backend/prisma-mysql`;
  - `backend/storage` (uploaded evidence);
  - logs.
- All `.env.example` files contain placeholders only.
- The secret scan found no API keys or database passwords in source files.

**Must be excluded (D10, approved):**

| Files | Reason | Label |
|---|---|---|
| `tulacarbon-deploy.zip`, all `demo-kit/*.zip`, `deploy-sql/old-oct-2026/*.zip` | generated deployment archives / document bundles | Verified |
| `frontend/dist-prod/` and any other build output | generated; **not** covered by the current ignore | Verified |
| `demo-kit/STEP-2-import-seed.sql`, `demo-kit/ZENITH-TESTING-SEED.sql`, `deploy-sql/4-showcase-data.sql`, `deploy-sql/new-demo-accounts.sql`, `deploy-sql/old-oct-2026/2-seed.sql` | contain user **password hashes** | Verified |
| `deploy-sql/demo-features-seed.sql`, `showcase-seed.sql`, `new-seed.sql`, `move-demo-into-webanatomy.sql`, `tulacarbon-full-mysql.sql` | data dumps containing **personal data** (email addresses) and records | Verified emails present |
| `Bugs-1.0.xlsx`, `Bug-Status-Report.xlsx`, `TC-DOM-002a … .xlsx`, `docs/Tula-Carbon-Calculation-Reference.pdf` | confidential client / Tyche documents | Approved D10 |
| `docs/sample-bills/`, `demo-kit/Dummy Bills/`, `registers-for-manual-entry/` and any other bill, invoice or register | **not verified as synthetic**. Being called a "sample" does not make a file safe | Approved D10 |
| `tula_carbon_super_admin…html` | stays **in the project root, unchanged**, for local reference; excluded from Git | Approved D10 |
| `backend/storage/`, real `.env` files | customer uploads / secrets | Verified ignored |

**Candidates for inclusion.** Each one still has to be inspected before any commit:
- application source, tests, Prisma schema and migrations, scripts;
- package and lock files, `.env.example`, `README.md`, `docs/*.md`;
- schema-only SQL: `1-schema.sql`, upgrade scripts, `3-reference-data.sql`, `5-triggers.sql`, `update-*.sql`, `LIVE-schema-update-nov-2026.sql`, `new-changes.sql`. Each must be checked for `INSERT` statements into user, membership or organisation tables before inclusion;
- `zenith-reference/` and `python-service/`, subject to the same inspection.

**Required before any future commit (only after A1):**
1. Add the exclusions above to `.gitignore`.
2. Produce a **complete proposed-file inventory** (`git add --dry-run .`) and share it for review.
3. **Inspect every file** on that inventory: secrets, hashes, emails and phone numbers, customer names, binary documents.
4. Run the secret scan on the staged set: `git diff --cached --name-only | xargs grep -lE "scrypt\$|enc1:|sk-|AIza|@[a-z0-9-]+\.[a-z]"`, and resolve every hit.
5. Commit only after you approve the inventory.

**Not done:** no file was deleted, moved, staged or committed.

## 15. Risks and unresolved questions

**Resolved in this revision:**

| # | Resolution | Section |
|---|---|---|
| Q2 | Fuel properties are scoped to the facility. Organisation factors and unit requests keep today's role permissions and factor governance. Scoping only narrows access | §7.3 |
| Q3 | Draft or Returned records must be split before submission. Approved records that span a move are listed, block period close, and are corrected through return → split → re-approve. No silent reassignment | §4.4 |
| Q4 | A period with a verifier grant is protected. An exception requires revoking the grant (existing, audited), a Tenant Admin, a reason, an audit entry, and keeps the earlier runs | §10.1 |
| Q5 | Results store site and facility IDs, codes and names as they were at calculation time | §12 |

**Still open (technical, not business):**

| # | Item | Label |
|---|---|---|
| T-Q1 | Live data shape unknown (§13); needs A2 | Unresolved |
| T-Q2 | Whether revoking a verifier grant should become a soft "closed" state instead of a hard delete. Today the audit `before` value keeps the grant [Verified]; a soft state would make "was this period ever verified" queryable without reading the audit log. Recommended: add `revokedAt`, keep the hard delete out | Recommended, needs your nod at Phase 2 planning |
| T-Q3 | Which existing records span a future move cannot be known until the moves are entered; volume unknown | Unresolved |
| R1 | Site assignments follow the facility's current site; the move dialog must show who gains or loses access | Recommended |
| R2 | Switching on enforcement hides other users' records; mitigated by proposals and read-only own history | Recommended |
| R3 | MySQL has no exclusion constraints; overlap prevention relies on the service and its transaction (an optional trigger can be added) | Verified limitation |
| R4 | Live facility grid may differ from the approved snapshot grid. D5 could then change open-period Scope 2 on the next run | Needs live verification (A2) |
| R5 | Boundaries approved before the snapshot held a grid would have no grid to read | Needs live verification (A2) |

## 16. Decision register

| ID | Final decision | Status | Implementation implications |
|---|---|---|---|
| D1 | Keep Tenant Admin self-approval of activity records and fuel properties, clearly labelled "self-approved". Emission-factor approval governance is unchanged | Approved architecture decision | Add a self-approved flag/label on review, record and verifier views; no permission change; `factor.approve` untouched |
| D2 | Carbon removals are a separate assignable category, outside Scope 1 and 2 | Approved architecture decision | `REMOVALS` scope in assignments, never implied; removals excluded from S1/S2 totals at every level (T20) |
| D3 | Data Entry users see only their own records | Approved architecture decision | `dataEntryScope` filters by `createdById`; other users' records return 404 (T10) |
| D4 | Freeze a source's facility, category and activity type once records exist; name and descriptive fields stay editable | Approved architecture decision | 409 on frozen-field change; "Replace source" flow; source review list |
| D5 | Scope 2 grid comes from the approved boundary snapshot | **Pending technical verification** (needs A2: snapshot grid present, live vs snapshot differences) | Engine input lookup only; fallback flagged; formulas unchanged |
| D6 | Boundary effective-date rules and locked/protected-period protection (§10, §10.1) | Approved architecture decision | explicit effectiveFrom validation; `ReportingPeriod.pinnedBoundaryId`; audit diffs; exception path |
| D7 | Effective-dated Site-to-Facility relationships (§4) | Approved architecture decision | `Site`, `FacilitySiteHistory`, result site and name snapshot; spanning-record checks; close-checklist block |
| D8 | Assignment enforcement is switched on per organisation, only after its Tenant Admin confirms the assignments. No automatic or 30-day deadline | Approved architecture decision | `Organization.assignmentsEnforced` default false; proposal screen; audited switch |
| D9 | Older results without site attribution display "Site not recorded" | Approved architecture decision | null `siteId` rendered as that label; no back-fill |
| D10 | Confidential documents, SQL data dumps, unverified sample bills and the HTML reference stay out of Git; the HTML stays unchanged in the project root | Approved architecture decision | `.gitignore` additions at commit time (A1) |
| A1 | Initial Git baseline commit | **Separate approval required. Not granted** | inventory + inspection first (§14) |
| A2 | Read-only inspection of the live MySQL database | **Separate approval required. Not granted** | SELECT-only, read-only account; no data or schema changes; outputs counts and the source review list |

## 17. Recommended implementation phases [Recommended]

| Phase | Content | Depends on |
|---|---|---|
| 2a | Git baseline (A1); test harness for invariants | A1 |
| 2b | Read-only live inventory | A2 |
| 3 | Boundary to Tenant Admin; effective-date rules; pinned boundary; audit diffs | D6 |
| 4 | Source freezing + replacement; source review list | D4 |
| 5 | Sites, FacilitySiteHistory, `CalculationResult.siteId`, Unassigned handling | D7, D9 |
| 6 | Grid from snapshot + per-result run comparison | D5, inventory |
| 7 | Workspaces (Org/Site/Facility) on shared queries | 5 |
| 8 | Assignments, scope helper, proposals, per-org switch | D2, D3, D8 |
| 9 | Organisation Setup wizard | 3–8 |
| each | Hand-written MySQL SQL, tested on a copy; deploy only with separate sign-off | – |

## 18. Acceptance criteria and test cases [Recommended; none written yet]

| # | Test | Pass when |
|---|---|---|
| T1 | Hyderabad→Bangalore scenario (§4.3) | Jan result siteId=HYD, Feb=BLR after March re-run; HYD 10, BLR 12, org 22 |
| T2 | Re-run after move | January site total identical before and after move |
| T3 | Invariants | Σ facility = Σ site (incl. Unassigned) = org = run.totals, for every seeded run |
| T4 | No double counting | each result counted once per level |
| T5 | Unassigned facility | appears under "Unassigned facilities"; totals reconcile |
| T6 | Overlap | overlapping or second open history row rejected |
| T7 | Move into locked period | rejected |
| T8 | History immutability | no API path deletes/edits history rows |
| T9 | Spanning record | submit blocked with split message; split produces two drafts |
| T10 | Data Entry ID probing | other user's record/evidence/document by ID → 404 on every route in §7.3 |
| T11 | Unassigned facility for Data Entry | absent from selectors; record create → 404 |
| T12 | Reassigned user | own past records readable, not editable |
| T13 | Enforcement off | behaviour identical to today (existing tests stay green) |
| T14 | Reviewer/Verifier | existing permission tests unchanged and green |
| T15 | Source freeze | change of facility/category/activity on source with records → 409; name edit OK |
| T16 | Grid snapshot | editing a boundary draft's grid does not change the next run's Scope 2 |
| T17 | Effective date | version with date ≤ locked end rejected; non-period-start date rejected |
| T18 | Reopened period | re-run uses pinned boundary; re-apply needs reason and is audited |
| T19 | Audit | boundary save records before/after |
| T20 | Removals | never in S1/S2 totals at any level |
| T21 | Workspaces close | Site/Facility workspaces expose no lock/reopen/run |
| T22 | Super Admin | still no access to tenant activity data or factors |
| T23 | Formulas | existing calculation tests (C-01…C-21) unchanged and green |
| T24 | Approved record spanning a move | listed at move time; period lock refused until returned, split and re-approved; site never silently changed |
| T25 | Verifier-protected period | move or boundary date reaching it refused while a grant exists; exception needs revoke + reason + audit; earlier runs unchanged |
| T26 | Historical names | rename site/facility after a run; historical report shows the names stored at calculation time |
| T27 | Fuel property scoping | Data Entry cannot list/create fuel properties for an unassigned facility (404) |
| T28 | Factor governance intact | with enforcement on, Data Entry factor drafts still need evidence and a different Reviewer; `factor.approve` unchanged |
| T29 | Self-approved label | Tenant Admin approving own record/fuel property shows "self-approved" in review, record and verifier views |

## 19. Phase 2 scope: allowed and prohibited

**Phase 2 has not started.** It begins only when you give explicit Phase 2 approval.

**Allowed once Phase 2 is approved** (local development only):
- Code and schema changes on the local machine for D1–D4 and D6–D10, following the phases in §17.
- New Prisma schema and migrations applied **only** to the local Postgres development and test schemas.
- Writing the matching hand-written MySQL SQL **as files** for later review. They are not run anywhere.
- Writing the tests in §18 and running them locally. Existing tests must stay green.
- D5 code may be written behind a per-organisation switch that stays off. It may not be switched on until A2 confirms the snapshot grid data.

**Still prohibited until separately approved:**
- Any Git commit, push, branch publication or history change (A1).
- Any connection to the live MySQL database, including read-only (A2). When A2 is approved, it is SELECT-only: no data or schema changes.
- Running SQL or migrations against live or any shared database.
- Deploying, or building deploy archives for, production.
- Modifying, moving or committing the HTML reference file.
- Changing emission factor values, calculation formulas, factor governance rules 1–10, historical results, or Reviewer/Verifier permissions.
- Giving Super Admin access to tenant activity data or tenant factors.
- Any global or time-based enforcement switch-on.
- Deleting customer data, demo data or project files.

---

*Planning document. No source code, schema, SQL, HTML, environment file, data, Git history or production system was changed in preparing it.*
