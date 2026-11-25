-- Tula Carbon: MOVE the Demo Industries showcase data INTO WebAnatomy.
-- Run once in phpMyAdmin > your database > Import, AFTER demo-features-seed.sql. Back up first.
--
-- What it does:
--   * The two demo plants join WebAnatomy as "PC — Pune Works" and "PD — Chennai Works", with their emission
--     sources, 44 activity records, review history, verification query, data quality review, reconciliations,
--     intensity measures, scenarios, targets and renewable instruments.
--   * Records go into WebAnatomy's own FY 2023-24 / FY 2024-25 periods when those exist (otherwise the demo
--     periods move across as they are).
--   * The demo calculation runs are removed: they covered the demo plants alone. Re-run the calculation for
--     both periods afterwards (steps at the end).
--   * Nothing already in WebAnatomy is changed or deleted.
--   * Demo Industries is left empty, suspended and with no members, so it disappears from the organisation
--     list. It cannot be deleted outright because its audit trail is append-only by design.

SET @demo = 'de300000-0000-4000-8000-000000000001' COLLATE utf8mb4_unicode_ci;
SET @wa   = (SELECT id FROM `Organization` WHERE name = 'WebAnatomy' LIMIT 1);

-- Periods: WebAnatomy's own period covering the same year, else the demo period itself.
SET @d1 = (SELECT id FROM `ReportingPeriod` WHERE organizationId = @demo AND name = 'FY 2023-24' LIMIT 1);
SET @d2 = (SELECT id FROM `ReportingPeriod` WHERE organizationId = @demo AND name = 'FY 2024-25' LIMIT 1);
SET @w1 = (SELECT id FROM `ReportingPeriod` WHERE organizationId = @wa AND startDate <= '2023-04-01' AND endDate >= '2024-03-31' ORDER BY startDate DESC LIMIT 1);
SET @w2 = (SELECT id FROM `ReportingPeriod` WHERE organizationId = @wa AND startDate <= '2024-04-01' AND endDate >= '2025-03-31' ORDER BY startDate DESC LIMIT 1);
SET @p1 = COALESCE(@w1, @d1);
SET @p2 = COALESCE(@w2, @d2);

-- 1. Calculation runs of the demo organisation (results first: they point at the records).
DELETE FROM `CalculationResult` WHERE organizationId = @demo;
DELETE FROM `CalculationRun` WHERE organizationId = @demo;

-- 2. Plants, sources and the demo periods that have no WebAnatomy counterpart.
UPDATE `Facility` SET organizationId = @wa, code = 'PC', name = 'PC — Pune Works' WHERE id = 'de300000-0000-4000-8000-0000000000a1' AND organizationId = @demo;
UPDATE `Facility` SET organizationId = @wa, code = 'PD', name = 'PD — Chennai Works' WHERE id = 'de300000-0000-4000-8000-0000000000b1' AND organizationId = @demo;
UPDATE `EmissionSource` SET organizationId = @wa WHERE organizationId = @demo;
UPDATE `ReportingPeriod` SET organizationId = @wa WHERE organizationId = @demo AND id IN (@p1, @p2);

-- 3. Everything that refers to a period, remapped.
UPDATE `ActivityRecord` SET organizationId = @wa, reportingPeriodId = CASE reportingPeriodId WHEN @d1 THEN @p1 WHEN @d2 THEN @p2 ELSE reportingPeriodId END WHERE organizationId = @demo;
UPDATE `ActivityReview` SET organizationId = @wa WHERE organizationId = @demo;
UPDATE `VerificationQuery` SET organizationId = @wa, reportingPeriodId = CASE reportingPeriodId WHEN @d1 THEN @p1 WHEN @d2 THEN @p2 ELSE reportingPeriodId END WHERE organizationId = @demo;
UPDATE `Scenario` SET organizationId = @wa, reportingPeriodId = CASE reportingPeriodId WHEN @d1 THEN @p1 WHEN @d2 THEN @p2 ELSE reportingPeriodId END WHERE organizationId = @demo;
UPDATE `CarbonTarget` SET organizationId = @wa, baselinePeriodId = CASE baselinePeriodId WHEN @d1 THEN @p1 WHEN @d2 THEN @p2 ELSE baselinePeriodId END WHERE organizationId = @demo;
-- An intensity measure WebAnatomy already has for the same period and plant is kept; the demo one is dropped.
UPDATE IGNORE `IntensityMetric` SET organizationId = @wa, reportingPeriodId = CASE reportingPeriodId WHEN @d1 THEN @p1 WHEN @d2 THEN @p2 ELSE reportingPeriodId END WHERE organizationId = @demo;
DELETE FROM `IntensityMetric` WHERE organizationId = @demo;

-- 4. The rest only change organisation.
UPDATE `DataQualityReview` SET organizationId = @wa WHERE organizationId = @demo;
UPDATE `Reconciliation` SET organizationId = @wa WHERE organizationId = @demo;
UPDATE IGNORE `EnergyInstrument` SET organizationId = @wa WHERE organizationId = @demo;
UPDATE `InstrumentAllocation` SET organizationId = @wa WHERE organizationId = @demo;

-- 5. Leave Demo Industries empty and out of sight.
DELETE FROM `VerifierGrant` WHERE organizationId = @demo;
DELETE FROM `ReportingPeriod` WHERE organizationId = @demo AND NOT EXISTS (SELECT 1 FROM `ActivityRecord` r WHERE r.reportingPeriodId = `ReportingPeriod`.id);
DELETE FROM `OrgBoundary` WHERE organizationId = @demo;
DELETE FROM `Membership` WHERE organizationId = @demo;
DELETE FROM `Session` WHERE activeOrganizationId = @demo;
UPDATE `Organization` SET status = 'SUSPENDED', statusReason = 'Showcase data moved into WebAnatomy' WHERE id = @demo;

-- 6. The demo verifier can see every WebAnatomy period, including any that moved across.
INSERT INTO `VerifierGrant` (id, organizationId, userId, reportingPeriodId, grantedById)
SELECT UUID(), p.organizationId, v.id, p.id, t.id FROM `ReportingPeriod` p
JOIN `User` v ON v.email = 'demo.verifier@tulacarbon.app'
JOIN `User` t ON t.email = 'demo.tenantadmin@tulacarbon.app'
WHERE p.organizationId = @wa AND NOT EXISTS (SELECT 1 FROM `VerifierGrant` g WHERE g.userId = v.id AND g.reportingPeriodId = p.id);

-- Done. Next, in the app as WebAnatomy:
--   1. Calculations > FY 2023-24 > Run calculation.
--   2. Calculations > FY 2024-25 > Run calculation twice (once with GWP set AR5, once AR6) to see "Compare two runs".
--   3. Carbon Intelligence > Targets > "Recalculate baseline" on each target, so it includes all plants.
--   4. Sites & Facilities: add PC and PD to the organisational boundary if you want them in boundary-weighted totals.
