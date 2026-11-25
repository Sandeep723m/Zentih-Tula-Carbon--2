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

