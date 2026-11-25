# Tula Carbon vs Zenith reference: gap analysis and calculation engine

Sources compared: `zenith-reference/` (React prototype, 37 screens, browser-only data), the Tula Carbon
codebase, and `TC-DOM-002a Calculation Engine Workbook v0.1 Scope1-2_filled (1).xlsx`.
Status as of 2026-10-28. **Done** = built and covered by automated tests. **Partial** = built, with the
stated part missing. **Outstanding** = not built.

## 1. Screen-by-screen status

| Zenith flow / screen | Status | Notes |
|---|---|---|
| A01 Login, A02 MFA, A03 Tenant selector | Done | TOTP, lockout, forced password change, per-IP rate limit |
| A04–A09 Org profile, sites, periods, sources, users & roles, settings | Done | Sources now name the workbook activity (fuel, gas, grid) they are calculated as |
| (client HTML) Boundary setup | Done | Super Admin, versioned, frozen snapshots |
| B10 Activity dashboard, B11 Entry form, B16 Attach evidence | Done | Entry form shows each method's extra inputs (density, NCV, energy basis, fuel economy, refrigerant mass balance, instrument MWh) and restricts units (V-16) |
| B23 Submission queue | Done | Review Queue page (submitted records) |
| B24 Review & approve | Done | Approve, or return with a reason; corrected records are resubmitted; reviewers see a calculation preview with its warnings; nobody reviews a record they entered or changed |
| B25 Approval history | Done | Per-record status history (who, when, from → to, comment) plus audit log |
| B26 Period lock review | Done | Period Close page: checklist, lock on the latest run, Tenant Admin reopen with a reason, lock history |
| C12–C15 Bulk import | Outstanding | Whole flow |
| D17–D18 Bill OCR | Outstanding | Needs an OCR service |
| E19–E21 Run calculation, runs, drill-down | Done | Scope 1 and Scope 2 (location and market), per-line and per-facility totals |
| E22 Emission factors | Done | All 242 workbook tab 04 rows with a value; searchable, paged; Super Admin adds versions |
| E27–E29 Report builder, preview, export | Partial | Preview, CSV export and print-to-PDF are built. No server-generated PDF file (the browser's "Save as PDF" is used) and no report templates |
| F30–F33 Verifier login, dashboard, evidence trace, queries | Done | Verifiers see only granted periods and their approved records; trace report → run → result → record → evidence; query threads |
| F34 Notifications | Outstanding | Queries and returns are visible on their pages; nothing is pushed or emailed |
| F35 Audit trail | Partial | Platform audit page is done. A tenant-side audit page is not built; record review history and lock history are shown in place |
| E36 What-if, E37 Benchmarking | Outstanding | No workbook basis yet |

## 2. End-to-end flow (as built)

```
Data entry ─ validation (V-01, V-16, method inputs) ─ submit ─┬─ return (reason) ─ correct ─ resubmit ─┐
                                                              └─ approve ◄────────────────────────────┘
approved records ─ calculation run (immutable) ─ blocked results fixed, warnings confirmed with a reason
─ period checklist ─ lock (latest run = final) ─ final report (CSV / print) ─ verifier grant ─ queries
locked period ─ Tenant Admin reopen (reason, audited) ─ report provisional again; runs and history kept
```

* Only **approved** records are calculated. Drafts, submitted and returned records are not.
* Approval never resolves a warning. A result that needs confirmation keeps needing it after approval.
* **Lock checklist (mandatory).** These must all hold:
  * no drafts;
  * nothing awaiting review;
  * nothing returned;
  * at least one approved record;
  * the latest run is current (no approval or return since it, and it covered every approved record);
  * no blocked results;
  * every warning confirmed.
* **Lock checklist (advisory).** These are shown but do not block the lock:
  * approved records with no calculation method (steam, process);
  * no approved boundary in force at the period start.
* **A locked period refuses** new records, edits, evidence changes, reviews, calculation runs, confirmations and period edits.
* **Concurrency.** Review actions, confirmations, lock and reopen are conditional updates, so two people acting at once cannot both succeed.

## 3. Calculation engine

| Formula (tab 06) | Status | Notes |
|---|---|---|
| C-01 stationary combustion, fossil | Done | with C-13 volume→mass, C-14 GCV→NCV, C-16 units, C-23 energy, C-09 CO2e |
| C-02 stationary combustion, biomass | Done | biogenic CO2 stored as a memo, CH4/N2O (non-fossil CH4 GWP) in Scope 1 |
| C-03 mobile combustion | Done | fuel-based and distance-based (C-15) |
| C-05 fugitive | Done | mass balance (C-18) and screening (C-17); pre-computed blend GWPs (C-19 values in tab 04) |
| C-06 Scope 2 location-based | Done | |
| C-07 Scope 2 market-based (with C-20) | Done | instrument MWh, type and reference per record; V-13 |
| C-04 process (and on-site waste treatment) | Done | cement, lime, limestone/dolomite, steel, aluminium, ammonia, nitric acid, wastewater (with MCF), composting; the record picks the factor where an activity has several; abated fraction (1 − R) |
| C-04 landfill (FOD) | Outstanding | EF-0324 is blank; needs the first-order-decay inputs (Q-06). Records block (V-03) |
| C-04 agriculture | Phase 2 | tab 01 S-17; activity types loaded, not calculable |
| C-08 removals | Done | separate REMOVALS line, never netted (G-06); V-08 and J-05 confirmations |
| C-21 steam, heat, cooling | Done | supplier factor per record (no default, V-19); its own Scope 2 line |
| C-22 Scope 1 + 2 summary (G-07) | Done | shown twice, once per electricity method, on the report and CSV |
| C-10 to C-12 (PCF, intensity) | Outstanding | Outside the Scope 1/2 totals |

**Reference data** comes from the workbook itself:
* `backend/scripts/extract-workbook.py` regenerates `backend/src/calc/workbookData.ts` from tabs 02 and 04, verbatim.
* `referenceData.ts` adds only the mappings: source category, formula, allowed units, and the default NCV quoted in the tab 02 notes.

**Validation and selection rules implemented:**
* Tab 10 validation: V-01, V-03, V-04, V-05, V-06, V-07, V-08, V-09, V-10, V-12, V-13, V-14, V-15, V-16, V-18, V-19, V-20.
* Tab 05 selection rules: 3 to 14 (rule 1, site Tier 3 factors from a lab analysis, and rule 2 for fuels are not built).
* GWP set per run: AR6 by default, AR5 with a reason (J-09). AR5 refrigerant GWPs come from the tab 04 notes ("AR5 value …").

**Worked examples.** The engine reproduces every tab 07 example for the implemented formulae within the workbook's tolerance: WE-01 to WE-17, and WE-18 under both AR6 and AR5 (`backend/tests/workbook-examples.ts`, `calculation.test.ts`). Not implemented: WE-19 to WE-21 (product footprint and intensity).

**Roll-up (tab 09).** Scope 1, Scope 2 location, Scope 2 market and the biogenic memo are separate lines, never added together. Each has a gross total and a total counted under the approved boundary (G-02). Per-gas masses are kept (G-11).

**Reports (tab 08).**
* Stored unrounded; rounded once for display and export: records 3 dp, facilities 2 dp, totals 0 dp above 1,000 t, else 2 dp.
* The CSV also carries each record's stored value, and a note that rounded components may not add up visibly (R-09).

## 4. Decisions needing business or carbon-expert approval

1. **EF-0020 geography.** Column L says "India — NEWNE grid"; its note and WE-14 treat it as the all-India average. It is filed under all-India. Confirm.
2. **Regional grid factors (EF-0339) are blank.** Indian regional grids therefore fall back to all-India and are flagged for confirmation (rule 9). Which regions does CEA v21 publish?
3. **No grid factor after FY2024-25.** Later periods are blocked (V-03) until a Super Admin adds the CEA edition. The instrument factor EF-0340 is valid for FY2024-25 only, so instrument-covered MWh in other years block as well.
4. **Q-01.** EF-0020 and EF-0338 are secondary-source figures; confirm them against CEA.
5a. **Steam, heat and cooling (C-21)** are reported on their own Scope 2 line and included in both Scope 1 + 2 figures. Tab 09 G-03/G-04 sum only C-06/C-07; confirm.
5b. **V-05 compares quantity per day** (records cover a month or a year), within the same source and unit. Confirm.
5c. **AR5 biomass is blocked**: the workbook gives AR5 values only for fossil CH4 and N2O, not non-fossil CH4.
5d. **Wastewater**: the MCF (EF-0322 note) has no default and is entered per record; N2O-N × 44/28 follows the EF-0323 note.
5. **Q-02.** No Indian residual mix (EF-0341 is blank). Market-based uses the grid average for uncovered MWh, and every market-based result needs a confirmation. When a residual mix is published, the factor library needs a way to mark a factor as residual mix (not built).
6. **Boundary weighting of Scope 2 and of the biogenic memo** reuses G-02 (Scope 1 rule). G-03 and G-05 are silent. Confirm.
7. **Density is never defaulted.** Volume entries without a density block (V-09), following tab 03's "if density is missing the calculation should fail". The tab 02 densities are marked indicative and are shown only as guidance. Confirm, or approve using them as defaults.
8. **Default NCVs are used** (from the tab 02 notes, including A-BIOM's "15.6 GJ/t"). Every result on IPCC Tier 1 factors or a default NCV needs confirmation (rule 3, J-04). This makes nearly every Scope 1 result need a confirmation before lock. Confirm that this is the intended workload.
9. **GCV→NCV gas ratio (0.90)** is applied to activities measured in SCM, and to CNG. Liquids and solids use 0.95. LPG is treated as a liquid. Confirm.
10. **Screening leak rate** (C-17) has no default (J-07). The user enters it, and the result needs confirmation.
11. **AR5** is offered per calculation run with a reason; a run (and its report) never mixes sets (V-12).
12. **Separation of duties.** A person cannot review a record they entered or last changed, including Tenant Admins. Small organisations need two people. Confirm.
13. **Reopening a locked period** is Tenant Admin only, needs a reason of at least 10 characters, and is allowed at any time. Should reopening after external verification be restricted further?
14. **Activity combinations not calculated.**
    * The generic A-REFR and A-BIOM rows lack the GWP or CH4/N2O factors needed, so they block (V-03).
    * Fuel sources created before this change have no fuel chosen and block (SRC-01) until a Tenant Admin picks one.
15. **Instrument claims (G-04).** They are counted per record; the engine cannot check that the same certificate is not claimed twice across sites. Each claim needs a confirmation.
16. **Not implemented from tab 10:** V-02 and V-17 (carbon origin comes from the activity type, so no mismatch can occur), V-11 (own emission factors are not accepted yet).
17. **Tab 12 (Open Questions)** is empty, although Q-01, Q-02, Q-05, Q-06 and Q-08 are referenced elsewhere.
