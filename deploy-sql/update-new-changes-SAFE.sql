-- Tula Carbon: ALL NEW CHANGES, SAFE VERSION (AI documents + phases 2 to 9) for the existing live server.
-- Every step checks first and skips what already exists, so it can be imported again after a partial or failed run.
-- Works on MySQL and MariaDB. Additive only: no existing row is changed or deleted.
-- phpMyAdmin > your database > Import > this file > Go.


CREATE TABLE IF NOT EXISTS `IntakeDocument` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'EXTRACTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `documentType` VARCHAR(191) NULL,
    `result` JSON NULL,
    `provider` VARCHAR(191) NULL,
    `model` VARCHAR(191) NULL,
    `activityRecordId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IntakeDocument_storageKey_key`(`storageKey`),
    INDEX `IntakeDocument_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `IntakeDocument_organizationId_status_idx`(`organizationId`, `status`),
    INDEX `IntakeDocument_organizationId_sha256_idx`(`organizationId`, `sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `AiUsageEvent` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NULL,
    `provider` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `errorCode` VARCHAR(191) NULL,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `estimatedCostUsd` DECIMAL(14, 6) NULL,
    `durationMs` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AiUsageEvent_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `AiUsageEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'IntakeDocument' AND CONSTRAINT_NAME = 'IntakeDocument_organizationId_fkey') > 0, 'SELECT 1', 'ALTER TABLE `IntakeDocument` ADD CONSTRAINT `IntakeDocument_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'IntakeDocument' AND CONSTRAINT_NAME = 'IntakeDocument_uploadedById_fkey') > 0, 'SELECT 1', 'ALTER TABLE `IntakeDocument` ADD CONSTRAINT `IntakeDocument_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'IntakeDocument' AND CONSTRAINT_NAME = 'IntakeDocument_activityRecordId_fkey') > 0, 'SELECT 1', 'ALTER TABLE `IntakeDocument` ADD CONSTRAINT `IntakeDocument_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord`(`id`) ON DELETE SET NULL ON UPDATE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'AiUsageEvent' AND CONSTRAINT_NAME = 'AiUsageEvent_organizationId_fkey') > 0, 'SELECT 1', 'ALTER TABLE `AiUsageEvent` ADD CONSTRAINT `AiUsageEvent_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'AiUsageEvent' AND CONSTRAINT_NAME = 'AiUsageEvent_documentId_fkey') > 0, 'SELECT 1', 'ALTER TABLE `AiUsageEvent` ADD CONSTRAINT `AiUsageEvent_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `IntakeDocument`(`id`) ON DELETE SET NULL ON UPDATE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'IntakeDocument' AND COLUMN_NAME = 'category') > 0, 'SELECT 1', 'ALTER TABLE `IntakeDocument` ADD COLUMN `category` VARCHAR(191) NULL');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'IntakeDocument' AND COLUMN_NAME = 'duplicateOfId') > 0, 'SELECT 1', 'ALTER TABLE `IntakeDocument` ADD COLUMN `duplicateOfId` VARCHAR(191) NULL');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'IntakeDocument' AND COLUMN_NAME = 'rejectReason') > 0, 'SELECT 1', 'ALTER TABLE `IntakeDocument` ADD COLUMN `rejectReason` VARCHAR(191) NULL');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'IntakeDocument' AND COLUMN_NAME = 'rejectedAt') > 0, 'SELECT 1', 'ALTER TABLE `IntakeDocument` ADD COLUMN `rejectedAt` DATETIME(3) NULL');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `IntakeMatch` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `invoiceIndex` INTEGER NOT NULL,
    `activityRecordId` VARCHAR(191) NOT NULL,
    `withEvidence` BOOLEAN NOT NULL,
    `matchedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IntakeMatch_organizationId_activityRecordId_idx`(`organizationId`, `activityRecordId`),
    UNIQUE INDEX `IntakeMatch_documentId_invoiceIndex_key`(`documentId`, `invoiceIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `IntakeCorrection` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `documentId` VARCHAR(191) NOT NULL,
    `invoiceIndex` INTEGER NOT NULL,
    `field` VARCHAR(191) NOT NULL,
    `before` VARCHAR(191) NULL,
    `after` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IntakeCorrection_documentId_idx`(`documentId`),
    INDEX `IntakeCorrection_organizationId_field_idx`(`organizationId`, `field`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'IntakeMatch' AND CONSTRAINT_NAME = 'IntakeMatch_documentId_fkey') > 0, 'SELECT 1', 'ALTER TABLE `IntakeMatch` ADD CONSTRAINT `IntakeMatch_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `IntakeDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'IntakeMatch' AND CONSTRAINT_NAME = 'IntakeMatch_activityRecordId_fkey') > 0, 'SELECT 1', 'ALTER TABLE `IntakeMatch` ADD CONSTRAINT `IntakeMatch_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'IntakeCorrection' AND CONSTRAINT_NAME = 'IntakeCorrection_documentId_fkey') > 0, 'SELECT 1', 'ALTER TABLE `IntakeCorrection` ADD CONSTRAINT `IntakeCorrection_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `IntakeDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

INSERT INTO `IntakeMatch` (`id`, `organizationId`, `documentId`, `invoiceIndex`, `activityRecordId`, `withEvidence`, `matchedById`, `createdAt`)
SELECT UUID(), `organizationId`, `id`, 0, `activityRecordId`, true, `uploadedById`, `updatedAt` FROM `IntakeDocument` WHERE `activityRecordId` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `IntakeMatch` m WHERE m.`documentId` = `IntakeDocument`.`id` AND m.`invoiceIndex` = 0);

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Organization' AND COLUMN_NAME = 'qualityAnomalyPercent') > 0, 'SELECT 1', 'ALTER TABLE `Organization` ADD COLUMN `qualityAnomalyPercent` INTEGER NOT NULL DEFAULT 50');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Organization' AND COLUMN_NAME = 'qualityMinHistory') > 0, 'SELECT 1', 'ALTER TABLE `Organization` ADD COLUMN `qualityMinHistory` INTEGER NOT NULL DEFAULT 3');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `DataQualityReview` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `findingKey` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NOT NULL,
    `reviewedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DataQualityReview_organizationId_findingKey_key`(`organizationId`, `findingKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `Reconciliation` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `facilityId` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NOT NULL,
    `status` ENUM('OPEN', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `resolvedValue` DECIMAL(20, 6) NULL,
    `resolution` VARCHAR(191) NULL,
    `resolvedById` VARCHAR(191) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Reconciliation_organizationId_status_createdAt_idx`(`organizationId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ReconciliationItem` (
    `id` VARCHAR(191) NOT NULL,
    `reconciliationId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `value` DECIMAL(20, 6) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `activityRecordId` VARCHAR(191) NULL,
    `documentId` VARCHAR(191) NULL,
    `addedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReconciliationItem_reconciliationId_idx`(`reconciliationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'ReconciliationItem' AND CONSTRAINT_NAME = 'ReconciliationItem_reconciliationId_fkey') > 0, 'SELECT 1', 'ALTER TABLE `ReconciliationItem` ADD CONSTRAINT `ReconciliationItem_reconciliationId_fkey` FOREIGN KEY (`reconciliationId`) REFERENCES `Reconciliation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `Scenario` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `reportingPeriodId` VARCHAR(191) NOT NULL,
    `adjustments` JSON NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Scenario_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `IntensityMetric` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `reportingPeriodId` VARCHAR(191) NOT NULL,
    `facilityId` VARCHAR(191) NULL,
    `metric` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `value` DECIMAL(20, 6) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `IntensityMetric_organizationId_reportingPeriodId_facilityId__key`(`organizationId`, `reportingPeriodId`, `facilityId`, `metric`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `CarbonTarget` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `baselinePeriodId` VARCHAR(191) NOT NULL,
    `baselineTCO2e` DECIMAL(45, 25) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `facilityId` VARCHAR(191) NULL,
    `targetYear` INTEGER NOT NULL,
    `reductionPercent` DECIMAL(6, 2) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CarbonTarget_organizationId_idx`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `TargetBaselineRevision` (
    `id` VARCHAR(191) NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `previousTCO2e` DECIMAL(45, 25) NULL,
    `newTCO2e` DECIMAL(45, 25) NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TargetBaselineRevision_targetId_idx`(`targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'TargetBaselineRevision' AND CONSTRAINT_NAME = 'TargetBaselineRevision_targetId_fkey') > 0, 'SELECT 1', 'ALTER TABLE `TargetBaselineRevision` ADD CONSTRAINT `TargetBaselineRevision_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `CarbonTarget`(`id`) ON DELETE CASCADE ON UPDATE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `EnergyInstrument` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `issuer` VARCHAR(191) NULL,
    `supplier` VARCHAR(191) NULL,
    `quantityMWh` DECIMAL(20, 6) NOT NULL,
    `generationFrom` DATE NOT NULL,
    `generationTo` DATE NOT NULL,
    `country` VARCHAR(191) NULL,
    `retiredAt` DATE NULL,
    `retiredForOrg` BOOLEAN NOT NULL DEFAULT false,
    `emissionFactor` DECIMAL(30, 15) NULL,
    `notes` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EnergyInstrument_organizationId_type_reference_key`(`organizationId`, `type`, `reference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `InstrumentAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `instrumentId` VARCHAR(191) NOT NULL,
    `activityRecordId` VARCHAR(191) NOT NULL,
    `mwh` DECIMAL(20, 6) NOT NULL,
    `allocatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InstrumentAllocation_organizationId_activityRecordId_idx`(`organizationId`, `activityRecordId`),
    UNIQUE INDEX `InstrumentAllocation_instrumentId_activityRecordId_key`(`instrumentId`, `activityRecordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @s = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'InstrumentAllocation' AND CONSTRAINT_NAME = 'InstrumentAllocation_instrumentId_fkey') > 0, 'SELECT 1', 'ALTER TABLE `InstrumentAllocation` ADD CONSTRAINT `InstrumentAllocation_instrumentId_fkey` FOREIGN KEY (`instrumentId`) REFERENCES `EnergyInstrument`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Done.
