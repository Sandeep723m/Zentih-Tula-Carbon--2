# TC-ARC-006 implementation status

Response to TC-ARC-006 v0.1 (Emission Factor Governance and Approval Workflow), 11 November 2026.

## A-3: is the factor table shared across tenants?

Yes. All emission factors are in one table. Each row is either a platform row (no owner) or a tenant row tied to exactly one organisation. The two tiers are separated in the application, at every point where a factor is read or written:

- **Listing, history, evidence and version views:**
  - A tenant sees the published platform library and its own rows only.
  - Another tenant's row returns "not found".
- **Calculations:** these load the platform library and the organisation's own approved rows only.
- **Super Admin:** sees only the platform library and has no read or write path to tenant rows. This is enforced and tested.
- **No promotion:** no code path copies or promotes a tenant row into the platform library.

This is row-level isolation, not the schema-per-tenant design that section 1 assumes. Moving to a separate schema per tenant would change the whole data layer and is a separate decision for Tyche. Until then, the separation is covered by automated tests: tenant B, and the Super Admin, cannot list, read, change or calculate with tenant A's factor.

## Section 6, immediate actions

| Ref | Status |
|---|---|
| A-1 Delete EF-9999 | Done in `deploy-sql/20261111_factor_governance.sql`. It deletes the row only if no calculation result references it. |
| A-2 No usable-on-creation factors | Done. Every new factor, platform or tenant, starts as Draft. |
| A-3 Written confirmation | This document (above). |
| A-4 False "read-only" claim | Done. The page now says the platform library is read-only and states the tenant-factor rules. |
| A-5 Units constrained to the activity, plus a request path | Done. Only units accepted for the activity are offered and enforced. Users can request a missing unit, and the platform team answers each request. |
| A-6 Re-run TC-QA-001 T-04, T-25 to T-28, T-30 | For Tyche. |

## Section 3, tenant factor lifecycle

- **States:** Draft → In review → Approved → In use → Superseded. A factor moves forward only and is never deleted; the application has no delete route.
- **In use:** set automatically when a calculation run uses the factor. It cannot be edited after that.
- **Leaving Draft requires:**
  - activity, gas, a numeric value, and units from the controlled list
  - carbon origin (Fossil or Biogenic)
  - tier (Tier 1 default, Tier 2 country or Tier 3 site-specific)
  - source and edition, plus an attached evidence file
  - a written basis (how the value was derived and what it must not be used for)
  - validity dates that don't overlap another of the organisation's factors for the same activity and gas
- **Review:** the reviewer ticks the four checks in section 3.2 (source, units and NCV/GCV basis, tier, validity), then approves or returns the factor with comments. The approver, time and note are recorded and visible to the Verifier.
- **Versioning:** a new version names the factor it replaces. When the new version is approved, the old one is end-dated the day before the new one starts and marked Superseded.
- **Snapshot:** every new calculation result stores the factor's value and units, plus its code, source, edition, tier, library label and validity. Results calculated earlier keep their id, value and units; the factor row they point to is frozen and cannot be deleted.
- **No reviewer (O-4):** if the organisation has no reviewer other than the factor's creator or submitter, the factor cannot be submitted and stays a draft.

## Section 5, roles

Implemented as specified in the table:
- Data Entry, Tenant Admin and Reviewer create and submit factors.
- Only a Reviewer approves, and never a factor they created or submitted. With no other Reviewer, the factor stays in review (O-4).
- A Reviewer can edit an approved factor that hasn't been used. A factor in use can't be edited by anyone.
- Tenant Admin and Reviewer can supersede (end-date) a factor.
- The Verifier has read access only.
- Super Admin writes to the platform library only and cannot see tenant factors. The platform audit views list tenant factor events (who and when) without their content.

## Section 2.1, labels

"Tenant-defined · Tier 3 site-specific" or "Platform library · Tier 2 country" appears in:
- the factor list
- calculation results (Calculations and the activity record)
- factor history and audit entries
- the report CSV ("Library" column)
- the audit workspace calculations export

## Section 4, platform library

- **Propose and publish:** the Super Admin proposes a factor as a draft and publishes it after ticking the source checks.
- **Never edited:** a published factor is not edited. A new version end-dates it.
- **Change log:** every publication or end-dating appears under "Library updates" for all tenants.
- **Open periods:** calculations take the factor in force at the start of the reporting period. A platform factor replaced by a new edition stays in force within its end-dated window, so an open period keeps the edition it started with. A platform factor end-dated without a replacement is no longer selected.

## Points requiring Tyche's decision

- **Architecture (section 2, A-3):** tenant factors are in the same table as platform factors (option A). Section 2 asks for them in each tenant's own schema. Options: B, a separate tenant-factor table in the same database (recommended next step); or C, a database per tenant, which should be a whole-application decision under TC-ARC-003.
- **Superseded tenant factors (section 3 against section 4 and TC-DOM-002 rule 4):** when a tenant factor is replaced mid-year, the old version is no longer selected, so a period that started under it falls back to the platform default. Should tenant versions follow the platform rule (in force at the period start)?
- **"In use":** set on the first calculation run. Should it wait until the result is final (period locked)?
- **Refrigerant GWPs:** a tenant's own GWP and the platform GWP are ranked by date, not owner, unlike other factors. Please confirm the intended priority.
- **Factor IDs:** these are unique across all organisations, so a used ID is refused with "already used". Per-organisation IDs would need a schema change.
- **Notifications:** library changes appear in a "Library updates" tab. In-app notifications are not yet raised.

## Decisions taken and other points

1. **Precedence:** when an organisation has its own approved factor for an activity, calculations use it ahead of the platform default (site- or supplier-specific over default). Please confirm. This relates to O-1.
2. **Platform roles:** the platform has a single Super Admin role, so one person can propose and publish. The source-check confirmation is recorded with the publication. Separate propose, verify and publish roles (section 4) would need new platform roles.
3. **Rationale for overriding a factor (section 3.3, last point):** the application never lets a user pick a factor other than the one the selection rules choose. The only user choice is the factor type for process activities (for example lime type), which is a selection rule itself. If manual overrides are introduced later, they will need this rationale.
4. **Existing data:** factors that were Active became Approved (or In use, if a result already used them), and Withdrawn factors became Superseded. No other row was changed.
5. **Unit requests:** marking a request "added" records the answer. The new unit itself is added to the controlled list as a reference-data change by the development team.

## Testing

- **Backend:** 254 of 254 tests pass on PostgreSQL; the factor and calculation test files also pass on MySQL (94 tests). The new tests cover API bypass attempts (client-sent status, approving a draft, approval by the wrong role), O-4, calculation isolation (a record naming another tenant's factor), Super Admin audit privacy, the result snapshot, selection priority, open-period pinning of platform editions, the full tenant lifecycle, self-approval refusal, the overlap check, versioning and end-dating, tenant and Super Admin isolation, freezing once in use, unit requests and the platform publish flow.
- **Frontend:** the type-check and production build pass.
- **Live database file:** applied to a MySQL copy of the live schema. The result matched the application schema exactly.
