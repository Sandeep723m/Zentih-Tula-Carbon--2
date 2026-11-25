-- Tula Carbon: ALL NEW CHANGES (phases 2 to 9) for the existing live server.
-- Run ONCE in phpMyAdmin > your database > Import. Additive only: new tables and new columns; no existing row is changed or deleted.
-- Already imported the separate update-phase*.sql files? Then do not run this.


-- Tula Carbon: PHASE 2, DOCUMENT INTELLIGENCE CENTRE (existing server; run once in phpMyAdmin > Import).
-- Additive: adds four nullable columns to IntakeDocument and two new tables. No row is changed or deleted.

-- AlterTable
ALTER TABLE `IntakeDocument` ADD COLUMN `category` VARCHAR(191) NULL,
    ADD COLUMN `duplicateOfId` VARCHAR(191) NULL,
    ADD COLUMN `rejectReason` VARCHAR(191) NULL,
    ADD COLUMN `rejectedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `IntakeMatch` (
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

-- CreateTable
CREATE TABLE `IntakeCorrection` (
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

-- AddForeignKey
ALTER TABLE `IntakeMatch` ADD CONSTRAINT `IntakeMatch_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `IntakeDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeMatch` ADD CONSTRAINT `IntakeMatch_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeCorrection` ADD CONSTRAINT `IntakeCorrection_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `IntakeDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Documents attached before this release become a match for their first invoice.
INSERT INTO `IntakeMatch` (`id`, `organizationId`, `documentId`, `invoiceIndex`, `activityRecordId`, `withEvidence`, `matchedById`, `createdAt`)
SELECT UUID(), `organizationId`, `id`, 0, `activityRecordId`, true, `uploadedById`, `updatedAt` FROM `IntakeDocument` WHERE `activityRecordId` IS NOT NULL;

-- Tula Carbon: PHASE 3, DATA QUALITY DASHBOARD (existing server; run once in phpMyAdmin > Import, after update-phase2-documents.sql).
-- Additive: two Organization settings with defaults, one new table. No row is changed or deleted.

-- AlterTable
ALTER TABLE `Organization` ADD COLUMN `qualityAnomalyPercent` INTEGER NOT NULL DEFAULT 50,
    ADD COLUMN `qualityMinHistory` INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE `DataQualityReview` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `findingKey` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NOT NULL,
    `reviewedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DataQualityReview_organizationId_findingKey_key`(`organizationId`, `findingKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- Tula Carbon: PHASE 4, RECONCILIATION (existing server; run once in phpMyAdmin > Import, after update-phase3-data-quality.sql).
-- Additive: two new tables. No existing table, column or row is changed.

-- CreateTable
CREATE TABLE `Reconciliation` (
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

-- CreateTable
CREATE TABLE `ReconciliationItem` (
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

-- AddForeignKey
ALTER TABLE `ReconciliationItem` ADD CONSTRAINT `ReconciliationItem_reconciliationId_fkey` FOREIGN KEY (`reconciliationId`) REFERENCES `Reconciliation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Tula Carbon: PHASE 7, CARBON INTELLIGENCE (existing server; run once in phpMyAdmin > Import, after update-phase4-reconciliation.sql).
-- Additive: four new tables (scenarios, intensity measures, targets, baseline revisions). Nothing existing is changed.

-- CreateTable
CREATE TABLE `Scenario` (
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

-- CreateTable
CREATE TABLE `IntensityMetric` (
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

-- CreateTable
CREATE TABLE `CarbonTarget` (
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

-- CreateTable
CREATE TABLE `TargetBaselineRevision` (
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

-- AddForeignKey
ALTER TABLE `TargetBaselineRevision` ADD CONSTRAINT `TargetBaselineRevision_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `CarbonTarget`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Tula Carbon: PHASE 9, RENEWABLE ENERGY (existing server; run once in phpMyAdmin > Import, after update-phase7-carbon-intelligence.sql).
-- Additive: two new tables (instruments and their allocations). Nothing existing is changed.

-- CreateTable
CREATE TABLE `EnergyInstrument` (
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

-- CreateTable
CREATE TABLE `InstrumentAllocation` (
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

-- AddForeignKey
ALTER TABLE `InstrumentAllocation` ADD CONSTRAINT `InstrumentAllocation_instrumentId_fkey` FOREIGN KEY (`instrumentId`) REFERENCES `EnergyInstrument`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

