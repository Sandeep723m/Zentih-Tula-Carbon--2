-- Tula Carbon: UPDATE FOR THE EXISTING SERVER (run this one file in phpMyAdmin > Import).
-- Additive only: nothing on the server is deleted or replaced. FY 2024-25 and every other period stay as they are.
--   Part 1: allows quantity 0 (e.g. a refrigerant check with no top-up). Safe whether or not it was applied before.
--   Part 2: adds the FY 2023-24 showcase data next to the existing data. Safe to re-run.
-- Requires the demo accounts (already on the server from new-demo-accounts.sql).

-- ============================================================
-- PART 1: quantity may be zero (replaces the older "greater than zero" rule if it is still there)
-- ============================================================
SET @has_check := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'ActivityRecord' AND CONSTRAINT_NAME = 'ActivityRecord_quantity_check');
SET @drop_check := IF(@has_check > 0, 'ALTER TABLE `ActivityRecord` DROP CONSTRAINT `ActivityRecord_quantity_check`', 'DO 0');
PREPARE stmt FROM @drop_check; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE `ActivityRecord` ADD CONSTRAINT `ActivityRecord_quantity_check` CHECK (`quantity` >= 0);

-- ============================================================
-- PART 2: FY 2023-24 showcase data
-- ============================================================
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;

-- ============================================================
-- VARIABLES: resolve the IDs we need
-- ============================================================
SET @orgId     = (SELECT id FROM `Organization` WHERE name = 'WebAnatomy' LIMIT 1);
SET @entryId   = (SELECT id FROM `User` WHERE email = 'demo.dataentry@tulacarbon.app' LIMIT 1);
SET @tenantId  = (SELECT id FROM `User` WHERE email = 'demo.tenantadmin@tulacarbon.app' LIMIT 1);
SET @verifierId= (SELECT id FROM `User` WHERE email = 'demo.verifier@tulacarbon.app' LIMIT 1);

-- ============================================================
-- FACILITIES
-- ============================================================
INSERT IGNORE INTO `Facility` (id, organizationId, code, name, country, city, address, gridLocation, equityShare, operationalControl, financialControl, scope1Active, scope2Active, isActive, createdAt)
VALUES
  (UUID(), @orgId, 'PA', 'Plant A — Manufacturing',  'India', 'Pune',    NULL, 'India - National Average', 100.00, NULL, NULL, 1, 1, 1, NOW()),
  (UUID(), @orgId, 'PB', 'Plant B — Processing Unit', 'India', 'Chennai', NULL, 'India - Southern Grid',    40.00,  NULL, NULL, 1, 1, 1, NOW());

SET @facA = (SELECT id FROM `Facility` WHERE organizationId = @orgId AND code = 'PA' LIMIT 1);
SET @facB = (SELECT id FROM `Facility` WHERE organizationId = @orgId AND code = 'PB' LIMIT 1);

-- ============================================================
-- APPROVED BOUNDARY (equity share, both facilities)
-- ============================================================
-- If an approved boundary exists, move its start back to 2023-04-01 so it also covers FY 2023-24.
-- FY 2024-25 keeps using the same boundary version, so its results do not change.
UPDATE `OrgBoundary` SET effectiveFrom = '2023-04-01'
WHERE organizationId = @orgId AND status = 'APPROVED' AND effectiveFrom > '2023-04-01'
  AND version = (SELECT v FROM (SELECT MIN(version) v FROM `OrgBoundary` WHERE organizationId = @orgId AND status = 'APPROVED') x);

-- No approved boundary at all: create one.
INSERT INTO `OrgBoundary` (id, organizationId, version, approach, status, effectiveFrom, baseYear, approvedAt, changeReason, snapshot, createdAt)
SELECT UUID(), @orgId, COALESCE((SELECT MAX(version) FROM `OrgBoundary` b WHERE b.organizationId = @orgId), 0) + 1, 'EQUITY', 'APPROVED', '2023-04-01', 2023, NOW(),
  'Initial boundary — equity share. Plant A 100%, Plant B 40%.',
  JSON_ARRAY(
    JSON_OBJECT('id', @facA, 'code', 'PA', 'name', 'Plant A — Manufacturing',  'country', 'India', 'gridLocation', 'India - National Average', 'equityShare', 100, 'operationalControl', NULL, 'financialControl', NULL, 'scope1Active', TRUE, 'scope2Active', TRUE),
    JSON_OBJECT('id', @facB, 'code', 'PB', 'name', 'Plant B — Processing Unit', 'country', 'India', 'gridLocation', 'India - Southern Grid',    'equityShare', 40,  'operationalControl', NULL, 'financialControl', NULL, 'scope1Active', TRUE, 'scope2Active', TRUE)
  ),
  NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `OrgBoundary` WHERE organizationId = @orgId AND status = 'APPROVED');

-- ============================================================
-- REPORTING PERIOD: FY 2023-24
-- ============================================================
INSERT IGNORE INTO `ReportingPeriod` (id, organizationId, name, startDate, endDate, status, createdAt)
VALUES (UUID(), @orgId, 'FY 2023-24', '2023-04-01', '2024-03-31', 'OPEN', NOW());

SET @periodId = (SELECT id FROM `ReportingPeriod` WHERE organizationId = @orgId AND name = 'FY 2023-24' LIMIT 1);

-- Verifier grant so demo verifier can raise queries on this period
INSERT IGNORE INTO `VerifierGrant` (id, organizationId, userId, reportingPeriodId, grantedById, createdAt)
VALUES (UUID(), @orgId, @verifierId, @periodId, @tenantId, NOW());

-- ============================================================
-- EMISSION SOURCES  (one per calculation method)
-- ============================================================
-- Scope 1 — Stationary combustion (fossil)
INSERT INTO `EmissionSource` (id, organizationId, facilityId, name, category, activityCode, isActive, createdAt)
SELECT UUID(), @orgId, t.fac, t.name, t.cat, t.act, 1, NOW() FROM (
  SELECT @facA fac, 'DG Set — Diesel' name, 'FUEL_COMBUSTION' cat, 'A-ST-DIESEL-GAS-OIL' act
  UNION ALL SELECT @facA fac, 'Gas Boiler' name, 'FUEL_COMBUSTION' cat, 'A-ST-NATURAL-GAS' act
  UNION ALL SELECT @facA fac, 'Coal Boiler' name, 'FUEL_COMBUSTION' cat, 'A-COAL' act
  UNION ALL SELECT @facA fac, 'Biomass Boiler' name, 'FUEL_COMBUSTION' cat, 'A-ST-WOOD-WOOD-WASTE' act
  UNION ALL SELECT @facA fac, 'Truck Fleet' name, 'FUEL_COMBUSTION' cat, 'A-MO-DIESEL' act
  UNION ALL SELECT @facA fac, 'Car Fleet' name, 'FUEL_COMBUSTION' cat, 'A-MO-PETROL-GASOL' act
  UNION ALL SELECT @facA fac, 'Chiller — R-410A' name, 'FUGITIVE_GAS' cat, 'A-FU-R-410A' act
  UNION ALL SELECT @facA fac, 'AC Units — R-134A' name, 'FUGITIVE_GAS' cat, 'A-FU-R-134A' act
  UNION ALL SELECT @facA fac, 'Switchgear — SF6' name, 'FUGITIVE_GAS' cat, 'A-FU-SF6' act
  UNION ALL SELECT @facB fac, 'Clinker Kiln' name, 'PROCESS' cat, 'A-PR-CEMENT-CLINK-PRODU' act
  UNION ALL SELECT @facB fac, 'Lime Kiln' name, 'PROCESS' cat, 'A-PR-LIME-PRODU' act
  UNION ALL SELECT @facA fac, 'CO2 Recovery Plant' name, 'REMOVAL' cat, 'A-CO2-REC' act
  UNION ALL SELECT @facA fac, 'Grid Electricity — Plant A' name, 'PURCHASED_ELECTRICITY' cat, 'A-GRID' act
  UNION ALL SELECT @facB fac, 'Grid Electricity — Plant B' name, 'PURCHASED_ELECTRICITY' cat, 'A-GRID' act
  UNION ALL SELECT @facA fac, 'Steam Supply' name, 'PURCHASED_ENERGY' cat, 'A-STEAM' act
) t
-- A source is the same source when it is on the same facility and measures the same activity,
-- so existing FY 2024-25 sources are reused whatever they are called.
WHERE NOT EXISTS (SELECT 1 FROM `EmissionSource` e WHERE e.organizationId = @orgId AND e.facilityId = t.fac AND e.activityCode = t.act);

-- Resolve source IDs
SET @srcDiesel = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-ST-DIESEL-GAS-OIL' ORDER BY createdAt LIMIT 1);
SET @srcGas    = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-ST-NATURAL-GAS' ORDER BY createdAt LIMIT 1);
SET @srcCoal   = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-COAL' ORDER BY createdAt LIMIT 1);
SET @srcWood   = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-ST-WOOD-WOOD-WASTE' ORDER BY createdAt LIMIT 1);
SET @srcTruck  = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-MO-DIESEL' ORDER BY createdAt LIMIT 1);
SET @srcCar    = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-MO-PETROL-GASOL' ORDER BY createdAt LIMIT 1);
SET @srcChiller= (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-FU-R-410A' ORDER BY createdAt LIMIT 1);
SET @srcAC     = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-FU-R-134A' ORDER BY createdAt LIMIT 1);
SET @srcSF6    = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-FU-SF6' ORDER BY createdAt LIMIT 1);
SET @srcKiln   = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facB AND activityCode = 'A-PR-CEMENT-CLINK-PRODU' ORDER BY createdAt LIMIT 1);
SET @srcLime   = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facB AND activityCode = 'A-PR-LIME-PRODU' ORDER BY createdAt LIMIT 1);
SET @srcCO2Rec = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-CO2-REC' ORDER BY createdAt LIMIT 1);
SET @srcGridA  = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-GRID' ORDER BY createdAt LIMIT 1);
SET @srcGridB  = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facB AND activityCode = 'A-GRID' ORDER BY createdAt LIMIT 1);
SET @srcSteam  = (SELECT id FROM `EmissionSource` WHERE organizationId = @orgId AND facilityId = @facA AND activityCode = 'A-STEAM' ORDER BY createdAt LIMIT 1);

-- ============================================================
-- RE-RUN SAFETY: clear FY 2023-24 records only. No other period is touched.
-- ============================================================
DELETE FROM `VerificationQueryMessage` WHERE queryId IN (SELECT id FROM `VerificationQuery` WHERE reportingPeriodId = @periodId);
DELETE FROM `VerificationQuery` WHERE reportingPeriodId = @periodId;
DELETE FROM `CalculationResult` WHERE activityRecordId IN (SELECT id FROM `ActivityRecord` WHERE reportingPeriodId = @periodId);
DELETE FROM `ActivityReview`    WHERE activityRecordId IN (SELECT id FROM `ActivityRecord` WHERE reportingPeriodId = @periodId);
DELETE FROM `Evidence`          WHERE activityRecordId IN (SELECT id FROM `ActivityRecord` WHERE reportingPeriodId = @periodId);
DELETE FROM `ActivityRecord`    WHERE reportingPeriodId = @periodId;

-- ============================================================
-- ACTIVITY RECORDS  (all SUBMITTED, ready for the Reviewer)
-- Each record notes the method, expected result and what to look for.
-- ============================================================

-- 1. SCOPE 2 — Grid electricity Plant A (location + market based, C-06/C-07)
--    1,200,000 kWh × 0.727 tCO2e/MWh (FY 2023-24 factor) = 872.4 tCO2e
--    Demonstrates: two Scope 2 results from one record; location vs. market comparison
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcGridA, '2023-04-01', '2023-09-30', 1200000, 'kWh', NULL,
  'Grid electricity, Plant A. 1,200 MWh × 0.727 tCO2e/MWh (CEA, India national average, FY2023-24) = 872.4 tCO2e. One record gives both Scope 2 figures; with no certificates, location-based and market-based are both 872.4 tCO2e.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 2. SCOPE 2 — Grid electricity Plant B (C-06/C-07)
--    500 MWh on the Southern Grid; no published regional factor, so the national average applies (flagged)
--    No certificates: the factor library has no instrument factor valid for FY 2023-24
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facB, @periodId, @srcGridB, '2023-04-01', '2023-09-30', 500, 'MWh', NULL,
  'Grid electricity, Plant B. 500 MWh × 0.727 tCO2e/MWh = 363.5 tCO2e. The Southern Grid has no published factor, so the national average is applied and flagged for confirmation.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 3. SCOPE 1 — Stationary combustion, diesel (C-01)
--    10,000 litres, density 0.84 kg/l, IPCC default NCV
--    Demonstrates: volume → mass → energy → CO2/CH4/N2O → CO2e chain
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcDiesel, '2023-04-01', '2023-09-30', 10000, 'l',
  JSON_OBJECT('density', '0.84', 'densityUnit', 'kg/l'),
  'Diesel generator (stationary). 10,000 L × 0.84 kg/L = 8.4 t of fuel × 0.043 TJ/t = 0.3612 TJ. × 74,100 kg CO2/TJ plus CH4 and N2O at AR6 GWPs = 26.856 tCO2e.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 4. SCOPE 1 — Stationary combustion, natural gas volume (C-01)
--    120,000 SCM, density 0.717 kg/m3
--    Demonstrates: gas volume input path
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcGas, '2023-04-01', '2023-09-30', 120000, 'SCM',
  JSON_OBJECT('density', '0.717', 'densityUnit', 'kg/m3'),
  'Gas boiler, measured by volume. 120,000 SCM × 0.717 kg/m3 = 86.04 t × 0.048 TJ/t = 4.130 TJ. × 56,100 kg CO2/TJ plus CH4 and N2O = 231.924 tCO2e.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 5. SCOPE 1 — Stationary combustion, natural gas energy (C-01, GCV input)
--    500,000 kWh on a GCV basis → converted to NCV before factor is applied
--    Demonstrates: energy unit input, GCV→NCV conversion, V-06 warning
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcGas, '2023-10-01', '2023-12-31', 500000, 'kWh',
  JSON_OBJECT('energyBasis', 'GCV'),
  'Gas boiler, measured as energy on a gross (GCV) basis. 500,000 kWh = 1.8 TJ gross × 0.9 = 1.62 TJ net. × 56,100 kg CO2/TJ plus CH4 and N2O = 90.975 tCO2e. The gross-to-net conversion is flagged for confirmation.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 6. SCOPE 1 — Stationary combustion, coal (C-01)
--    1,250 tonnes — mass input, no density needed
--    Demonstrates: solid fuel mass path, higher CO2 factor
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcCoal, '2023-04-01', '2023-09-30', 1250, 't', NULL,
  'Coal boiler, measured by mass. 1,250 t × 0.0258 TJ/t = 32.25 TJ. × 94,600 kg CO2/TJ plus CH4 and N2O = 3,073.667 tCO2e.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 7. SCOPE 1 — Stationary combustion, biomass (C-02)
--    200 tonnes wood — biogenic CO2 is a memo item, only CH4 and N2O count in Scope 1 total
--    Demonstrates: C-02 biogenic treatment, memo CO2 line
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcWood, '2023-04-01', '2023-09-30', 200, 't', NULL,
  'Biomass boiler (wood waste). 200 t × 0.0156 TJ/t = 3.12 TJ. Only CH4 and N2O count in Scope 1: 5.934 tCO2e. The biogenic CO2 (349.44 t) is reported separately and is not added to Scope 1.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 8. SCOPE 1 — Mobile combustion, diesel truck (C-03, volume input)
--    1,000 litres, density 0.84 kg/l
--    Demonstrates: mobile vs. stationary — different CH4/N2O factors
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcTruck, '2023-04-01', '2023-09-30', 1000, 'l',
  JSON_OBJECT('density', '0.84', 'densityUnit', 'kg/l'),
  'Truck fleet (mobile diesel). 1,000 L × 0.84 kg/L × 0.043 TJ/t = 0.03612 TJ → 2.719 tCO2e. Road transport uses higher CH4 and N2O factors than stationary diesel, so compare it with the generator record.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 9. SCOPE 1 — Mobile combustion, petrol car (C-03, distance input)
--    12,000 km at 12 km/l, fuel density 0.74 kg/l
--    Demonstrates: distance → fuel → mass → energy chain (C-15 fuel economy step)
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcCar, '2023-04-01', '2023-09-30', 12000, 'km',
  JSON_OBJECT('fuelEconomy', '12', 'density', '0.74', 'densityUnit', 'kg/l'),
  'Car fleet (petrol, measured by distance). 12,000 km ÷ 12 km/L = 1,000 L × 0.74 kg/L = 0.74 t × 0.0443 TJ/t = 0.0328 TJ → 2.333 tCO2e.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 10. SCOPE 1 — Fugitive, refrigerant top-up mass balance (C-05)
--     12 kg R-410A charged — GWP 2255.5 (AR6)
--     Demonstrates: high-GWP refrigerant, simple mass × GWP calculation
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcChiller, '2023-04-01', '2023-09-30', 12, 'kg', NULL,
  'Chiller refrigerant top-up. 12 kg of R-410A × GWP 2,255.5 = 27.066 tCO2e.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 11. SCOPE 1 — Fugitive, R-134A (C-05)
--     50 kg — lower GWP than R-410A, demonstrates GWP comparison
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcAC, '2023-04-01', '2023-09-30', 50, 'kg', NULL,
  'Air-conditioning refrigerant top-up. 50 kg of R-134A × GWP 1,530 = 76.5 tCO2e. Similar quantities of different gases give very different results.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 12. SCOPE 1 — Fugitive, SF6 switchgear zero net top-up (C-05)
--     quantity = 0 kg (disposed 20 kg, recovered 18 kg, purchased 2 kg, net = 0 top-up)
--     Demonstrates: zero-quantity record is valid for mass balance; quantity >= 0 rule
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcSF6, '2023-04-01', '2023-09-30', 0, 'kg', NULL,
  'Switchgear SF6: nothing topped up this half-year, so 0 kg → 0 tCO2e. A zero record shows the source was checked.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 13. SCOPE 1 — Process emissions, cement clinker (C-04)
--     100,000 tonnes clinker produced — calcination releases CO2
--     Demonstrates: process emission (not from fuel), IPCC Tier 1 clinker factor
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facB, @periodId, @srcKiln, '2023-04-01', '2023-09-30', 100000, 't', NULL,
  'Cement clinker production. 100,000 t clinker × 0.52 tCO2/t (IPCC default) = 52,000 tCO2e. This is a process emission from calcination; the kiln''s fuel is reported separately as combustion.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 14. SCOPE 1 — Process emissions, lime production (C-04)
--     1,000 tonnes lime — different process factor
--     Demonstrates: another process category, different IPCC factor
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facB, @periodId, @srcLime, '2023-04-01', '2023-09-30', 1000, 't', JSON_OBJECT('factorCode', 'EF-0309'),
  'Lime production. 1,000 t × 0.75 tCO2/t (high-calcium lime, chosen under ''Which factor applies'') = 750 tCO2e. Dolomitic lime would use 0.77.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 15. SCOPE 1 — Removal / recovery, CO2 captured (C-08)
--     500 tonnes CO2 captured, metered and stored permanently
--     Demonstrates: removals are reported separately, never netted against Scope 1
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcCO2Rec, '2023-04-01', '2023-09-30', 500, 't',
  JSON_OBJECT('meterReference', 'FM-CO2-01 flow meter log', 'endUse', 'Permanent geological storage'),
  'CO2 captured and stored permanently: 500 t, metered. Reported on its own removals line and not deducted from Scope 1. The end use is confirmed each run, because CO2 released again (for example in drinks) does not count as a removal.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- 16. SCOPE 2 — Purchased steam (C-21)
--     8,000 GJ steam with supplier emission factor 60 kgCO2e/GJ
--     Demonstrates: Scope 2 heat/steam, supplier factor disclosure
INSERT INTO `ActivityRecord` (id, organizationId, facilityId, reportingPeriodId, emissionSourceId, startDate, endDate, quantity, unit, parameters, notes, status, submittedAt, createdById, updatedById, createdAt, updatedAt)
VALUES (UUID(), @orgId, @facA, @periodId, @srcSteam, '2023-04-01', '2023-09-30', 8000, 'GJ',
  JSON_OBJECT('supplierFactor', '60', 'supplierDisclosure', 'Supplier emission disclosure FY2023-24 — 60 kgCO2e/GJ'),
  'Purchased steam. 8,000 GJ × 60 kg CO2e/GJ (supplier factor) = 480 tCO2e, reported as Scope 2 purchased heat on its own line.',
  'SUBMITTED', NOW(), @entryId, @entryId, NOW(), NOW());

-- ============================================================
-- ACTIVITY REVIEW HISTORY (each record was submitted by Data Entry)
-- ============================================================
INSERT INTO `ActivityReview` (id, organizationId, activityRecordId, action, fromStatus, toStatus, actorId, comment, createdAt)
SELECT UUID(), organizationId, id, 'SUBMITTED', 'DRAFT', 'SUBMITTED', @entryId, NULL, NOW()
FROM `ActivityRecord` WHERE organizationId = @orgId AND reportingPeriodId = @periodId;

/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;

-- Done.
-- Added: FY 2023-24 period | 16 activity records. Facilities/sources/boundary reused if they already existed.
-- FY 2024-25 untouched — compare the two years in Reports.
-- All records are SUBMITTED. Sign in as Reviewer to approve; then run a Calculation to see results.
-- Sign in as Verifier to raise queries on any record.
-- Methods covered: C-01 (×3), C-02, C-03 (×2), C-04 (×2), C-05 (×3), C-06/C-07 (×2), C-08, C-21
