-- Tula Carbon: DELETE ALL DATA, KEEP THE TABLES.
-- Empties every table holding organisations, users, records, calculations and documents. Tables, columns,
-- foreign keys and triggers stay exactly as they are. The reference library (activity types, units, grid regions,
-- emission factors) is kept. Cannot be undone: download a backup first. Then import 3-showcase-data-webanatomy.sql.
-- Works with phpMyAdmin's "Enable foreign key checks" on or off: rows are removed child tables first.
-- The audit log is append-only, so it is cleared with TRUNCATE (nothing points at it).
DELETE FROM `ActivityReview`;
DELETE FROM `AiUsageEvent`;
TRUNCATE TABLE `AuditLog`;
DELETE FROM `CalculationResult`;
DELETE FROM `DataQualityReview`;
DELETE FROM `Evidence`;
DELETE FROM `InstrumentAllocation`;
DELETE FROM `IntakeCorrection`;
DELETE FROM `IntakeMatch`;
DELETE FROM `IntensityMetric`;
DELETE FROM `Membership`;
DELETE FROM `OrgBoundary`;
DELETE FROM `PeriodLockEvent`;
DELETE FROM `ReconciliationItem`;
DELETE FROM `Scenario`;
DELETE FROM `Session`;
DELETE FROM `Subscription`;
DELETE FROM `SubscriptionEvent`;
DELETE FROM `TargetBaselineRevision`;
DELETE FROM `VerificationQueryMessage`;
DELETE FROM `VerifierGrant`;
DELETE FROM `CalculationRun`;
DELETE FROM `CarbonTarget`;
DELETE FROM `EnergyInstrument`;
DELETE FROM `IntakeDocument`;
DELETE FROM `Reconciliation`;
DELETE FROM `VerificationQuery`;
DELETE FROM `ActivityRecord`;
DELETE FROM `EmissionSource`;
DELETE FROM `ReportingPeriod`;
-- Factors added by a user who is being removed stay in the library, without the link to that user.
UPDATE `EmissionFactor` SET createdById = NULL WHERE createdById IS NOT NULL;
DELETE FROM `User`;
DELETE FROM `Facility`;
DELETE FROM `Organization`;
