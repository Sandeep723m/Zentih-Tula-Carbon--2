-- ============================================================================
-- Tula Carbon: schema update for the live MySQL / MariaDB database (Nov 2026)
--   * fuel lab values, structured NCV/density, GWP set
--   * emission factor governance (TC-ARC-006): statuses, evidence, review, unit requests
--   * TC-ARC-006 A-1: delete the EF-9999 test factor, only if no result uses it
--
-- SAFE TO RUN ON THE LIVE DATABASE, AND SAFE TO RUN MORE THAN ONCE:
--   every step checks the current structure first and skips what already exists.
--   No table or column is dropped. No activity record, calculation run or calculation
--   result is deleted. Existing factor values are not changed.
--   The only data changes: factor status names are converted (Active -> Approved,
--   Withdrawn -> Superseded), new columns are filled from existing data, and EF-9999
--   is deleted if unused.
-- Take a full database backup before running it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. New columns (added only if missing)
-- ---------------------------------------------------------------------------
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ActivityType' AND COLUMN_NAME = 'defaultDensity') = 0, 'ALTER TABLE `ActivityType` ADD COLUMN `defaultDensity` DECIMAL(30, 15) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ActivityType' AND COLUMN_NAME = 'defaultDensitySource') = 0, 'ALTER TABLE `ActivityType` ADD COLUMN `defaultDensitySource` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ActivityType' AND COLUMN_NAME = 'defaultDensityUnit') = 0, 'ALTER TABLE `ActivityType` ADD COLUMN `defaultDensityUnit` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ActivityType' AND COLUMN_NAME = 'defaultNcvPublished') = 0, 'ALTER TABLE `ActivityType` ADD COLUMN `defaultNcvPublished` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ActivityType' AND COLUMN_NAME = 'defaultNcvSource') = 0, 'ALTER TABLE `ActivityType` ADD COLUMN `defaultNcvSource` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CalculationRun' AND COLUMN_NAME = 'gwpBasis') = 0, 'ALTER TABLE `CalculationRun` ADD COLUMN `gwpBasis` VARCHAR(191) NOT NULL DEFAULT ''GWP-100''', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CalculationResult' AND COLUMN_NAME = 'factorUnit') = 0, 'ALTER TABLE `CalculationResult` ADD COLUMN `factorUnit` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'gwpSet') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `gwpSet` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'gwpBasis') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `gwpBasis` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'organizationId') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `organizationId` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'updatedAt') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `updatedAt` DATETIME(3) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'approvedById') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `approvedById` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'approvedAt') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `approvedAt` DATETIME(3) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'withdrawnById') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `withdrawnById` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'withdrawnAt') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `withdrawnAt` DATETIME(3) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'withdrawnReason') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `withdrawnReason` TEXT NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'basis') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `basis` TEXT NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'evidenceFile') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `evidenceFile` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'evidenceName') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `evidenceName` VARCHAR(255) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'evidenceSha256') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `evidenceSha256` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'submittedById') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `submittedById` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'submittedAt') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `submittedAt` DATETIME(3) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'approvalNote') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `approvalNote` TEXT NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'supersedesId') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `supersedesId` VARCHAR(191) NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 2. Emission factor status: allow old and new names, convert, then keep only the new ones.
--    Existing factors stay usable: Active becomes Approved; Withdrawn becomes Superseded.
-- ---------------------------------------------------------------------------
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND COLUMN_NAME = 'status') = 0, 'ALTER TABLE `EmissionFactor` ADD COLUMN `status` ENUM(''DRAFT'', ''ACTIVE'', ''WITHDRAWN'', ''IN_REVIEW'', ''APPROVED'', ''IN_USE'', ''SUPERSEDED'') NOT NULL DEFAULT ''APPROVED''', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
ALTER TABLE `EmissionFactor` MODIFY `status` ENUM('DRAFT', 'ACTIVE', 'WITHDRAWN', 'IN_REVIEW', 'APPROVED', 'IN_USE', 'SUPERSEDED') NOT NULL DEFAULT 'APPROVED';
UPDATE `EmissionFactor` SET `status` = 'APPROVED' WHERE `status` = 'ACTIVE';
UPDATE `EmissionFactor` SET `status` = 'SUPERSEDED' WHERE `status` = 'WITHDRAWN';
ALTER TABLE `EmissionFactor` MODIFY `status` ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'IN_USE', 'SUPERSEDED') NOT NULL DEFAULT 'DRAFT';

-- ---------------------------------------------------------------------------
-- 3. New tables (created only if missing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `FuelProperty` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `facilityId` VARCHAR(191) NOT NULL,
    `activityCode` VARCHAR(191) NOT NULL,
    `month` DATE NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'APPROVED', 'REJECTED', 'SUPERSEDED') NOT NULL DEFAULT 'DRAFT',
    `ncv` DECIMAL(30, 15) NULL,
    `density` DECIMAL(30, 15) NULL,
    `densityUnit` VARCHAR(191) NULL,
    `carbonContent` DECIMAL(30, 15) NULL,
    `oxidationFactor` DECIMAL(10, 6) NULL,
    `biogenicShare` DECIMAL(10, 6) NULL,
    `certificateRef` VARCHAR(255) NOT NULL,
    `laboratory` VARCHAR(191) NULL,
    `sampleDate` DATE NULL,
    `notes` TEXT NULL,
    `evidenceFile` VARCHAR(191) NULL,
    `evidenceName` VARCHAR(191) NULL,
    `evidenceSha256` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    INDEX `FuelProperty_organizationId_facilityId_activityCode_month_idx`(`organizationId`, `facilityId`, `activityCode`, `month`),
    UNIQUE INDEX `FuelProperty_facilityId_activityCode_month_version_key`(`facilityId`, `activityCode`, `month`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `UnitRequest` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NULL,
    `requestedById` VARCHAR(191) NOT NULL,
    `activityCode` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('OPEN', 'ADDED', 'DECLINED') NOT NULL DEFAULT 'OPEN',
    `resolvedById` VARCHAR(191) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `resolution` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `UnitRequest_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. Index and foreign keys (added only if missing)
-- ---------------------------------------------------------------------------
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND INDEX_NAME = 'EmissionFactor_organizationId_status_idx') = 0, 'CREATE INDEX `EmissionFactor_organizationId_status_idx` ON `EmissionFactor`(`organizationId`, `status`)', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND CONSTRAINT_NAME = 'EmissionFactor_organizationId_fkey') = 0, 'ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND CONSTRAINT_NAME = 'EmissionFactor_approvedById_fkey') = 0, 'ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND CONSTRAINT_NAME = 'EmissionFactor_withdrawnById_fkey') = 0, 'ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_withdrawnById_fkey` FOREIGN KEY (`withdrawnById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EmissionFactor' AND CONSTRAINT_NAME = 'EmissionFactor_submittedById_fkey') = 0, 'ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'FuelProperty' AND CONSTRAINT_NAME = 'FuelProperty_organizationId_fkey') = 0, 'ALTER TABLE `FuelProperty` ADD CONSTRAINT `FuelProperty_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'FuelProperty' AND CONSTRAINT_NAME = 'FuelProperty_facilityId_fkey') = 0, 'ALTER TABLE `FuelProperty` ADD CONSTRAINT `FuelProperty_facilityId_fkey` FOREIGN KEY (`facilityId`) REFERENCES `Facility`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'FuelProperty' AND CONSTRAINT_NAME = 'FuelProperty_createdById_fkey') = 0, 'ALTER TABLE `FuelProperty` ADD CONSTRAINT `FuelProperty_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'FuelProperty' AND CONSTRAINT_NAME = 'FuelProperty_reviewedById_fkey') = 0, 'ALTER TABLE `FuelProperty` ADD CONSTRAINT `FuelProperty_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'UnitRequest' AND CONSTRAINT_NAME = 'UnitRequest_organizationId_fkey') = 0, 'ALTER TABLE `UnitRequest` ADD CONSTRAINT `UnitRequest_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'UnitRequest' AND CONSTRAINT_NAME = 'UnitRequest_requestedById_fkey') = 0, 'ALTER TABLE `UnitRequest` ADD CONSTRAINT `UnitRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'UnitRequest' AND CONSTRAINT_NAME = 'UnitRequest_resolvedById_fkey') = 0, 'ALTER TABLE `UnitRequest` ADD CONSTRAINT `UnitRequest_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'FuelProperty' AND CONSTRAINT_NAME = 'FuelProperty_activityCode_fkey') = 0, 'ALTER TABLE `FuelProperty` ADD CONSTRAINT `FuelProperty_activityCode_fkey` FOREIGN KEY (`activityCode`) REFERENCES `ActivityType`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ---------------------------------------------------------------------------
-- 5. Fill the new columns from existing data (only rows not yet filled)
-- ---------------------------------------------------------------------------
UPDATE `EmissionFactor` SET `gwpSet` = 'AR6', `gwpBasis` = 'GWP-100' WHERE `gwpSet` IS NULL AND `sourceVersion` LIKE 'AR6%';
UPDATE `EmissionFactor` SET `gwpSet` = 'AR5', `gwpBasis` = 'GWP-100' WHERE `gwpSet` IS NULL AND `sourceVersion` LIKE 'AR5%';

-- An organisation's factor already used by a calculation result is IN_USE (frozen).
UPDATE `EmissionFactor` ef SET ef.`status` = 'IN_USE'
WHERE ef.`organizationId` IS NOT NULL AND ef.`status` = 'APPROVED'
  AND EXISTS (SELECT 1 FROM `CalculationResult` r WHERE r.`emissionFactorId` = ef.`id`);

-- Results calculated earlier get the units of the factor they used (their values are not touched).
UPDATE `CalculationResult` r JOIN `EmissionFactor` ef ON ef.`id` = r.`emissionFactorId`
SET r.`factorUnit` = CONCAT(ef.`numeratorUnit`, ' / ', ef.`denominatorUnit`)
WHERE r.`factorUnit` IS NULL;

-- ---------------------------------------------------------------------------
-- 6. TC-ARC-006 A-1: delete EF-9999 (coal per "ton-hour" test entry).
--    Deleted only if no calculation result references it; otherwise it is kept.
-- ---------------------------------------------------------------------------
SELECT `code`, `status`, (SELECT COUNT(*) FROM `CalculationResult` r WHERE r.`emissionFactorId` = ef.`id`) AS `results_using_it`
FROM `EmissionFactor` ef WHERE ef.`code` = 'EF-9999';

DELETE ef FROM `EmissionFactor` ef
WHERE ef.`code` = 'EF-9999'
  AND NOT EXISTS (SELECT 1 FROM `CalculationResult` r WHERE r.`emissionFactorId` = ef.`id`);

-- Expect 0. If 1, EF-9999 is used by a result and was kept: report it to the developer.
SELECT COUNT(*) AS `ef9999_remaining` FROM `EmissionFactor` WHERE `code` = 'EF-9999';
