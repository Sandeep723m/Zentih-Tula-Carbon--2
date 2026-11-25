-- Tula Carbon: 2 of 5, UPGRADE (existing site from the October 2026 deploy only).
-- Adds the calculation engine, review, period close and verification tables and columns. Run once, instead of 1-schema. Additive: no table or row is removed.

-- AlterTable
ALTER TABLE `ReportingPeriod` ADD COLUMN `finalRunId` VARCHAR(191) NULL,
    ADD COLUMN `lockedAt` DATETIME(3) NULL,
    ADD COLUMN `lockedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `EmissionSource` ADD COLUMN `activityCode` VARCHAR(191) NULL,
    MODIFY `category` ENUM('FUEL_COMBUSTION', 'FUGITIVE_GAS', 'PURCHASED_ELECTRICITY', 'PURCHASED_ENERGY', 'PROCESS', 'REMOVAL') NOT NULL;

-- AlterTable
ALTER TABLE `ActivityRecord` ADD COLUMN `parameters` JSON NULL,
    ADD COLUMN `returnReason` TEXT NULL,
    ADD COLUMN `reviewedAt` DATETIME(3) NULL,
    ADD COLUMN `reviewedById` VARCHAR(191) NULL,
    MODIFY `status` ENUM('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE `ActivityType` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `scope` INTEGER NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `sourceCategory` ENUM('FUEL_COMBUSTION', 'FUGITIVE_GAS', 'PURCHASED_ELECTRICITY', 'PURCHASED_ENERGY', 'PROCESS', 'REMOVAL') NULL,
    `measuredIn` VARCHAR(191) NOT NULL,
    `allowedUnits` JSON NOT NULL,
    `carbonOrigin` VARCHAR(191) NOT NULL,
    `formulaCode` VARCHAR(191) NULL,
    `defaultNcv` DECIMAL(30, 15) NULL,
    `notes` TEXT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Unit` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `dimension` VARCHAR(191) NOT NULL,
    `baseUnit` VARCHAR(191) NOT NULL,
    `toBase` DECIMAL(30, 15) NOT NULL,
    `notes` VARCHAR(191) NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GridRegion` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NOT NULL,
    `fallbackCode` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `GridRegion_name_key`(`name`),
    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmissionFactor` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `activityCode` VARCHAR(191) NULL,
    `gas` VARCHAR(191) NOT NULL,
    `value` DECIMAL(30, 15) NOT NULL,
    `numeratorUnit` VARCHAR(191) NOT NULL,
    `denominatorUnit` VARCHAR(191) NOT NULL,
    `carbonOrigin` VARCHAR(191) NOT NULL,
    `source` VARCHAR(300) NOT NULL,
    `sourceVersion` VARCHAR(191) NOT NULL,
    `validFrom` DATE NOT NULL,
    `validTo` DATE NULL,
    `regionCode` VARCHAR(191) NULL,
    `geography` VARCHAR(255) NOT NULL,
    `tier` VARCHAR(191) NOT NULL,
    `notes` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EmissionFactor_code_key`(`code`),
    INDEX `EmissionFactor_activityCode_regionCode_validFrom_idx`(`activityCode`, `regionCode`, `validFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CalculationRun` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `reportingPeriodId` VARCHAR(191) NOT NULL,
    `engineVersion` VARCHAR(191) NOT NULL,
    `recordCount` INTEGER NOT NULL,
    `calculatedCount` INTEGER NOT NULL,
    `blockedCount` INTEGER NOT NULL,
    `notCalculableCount` INTEGER NOT NULL,
    `scope2LocationTCO2e` DECIMAL(45, 25) NOT NULL,
    `boundaryId` VARCHAR(191) NULL,
    `scope2LocationBoundaryTCO2e` DECIMAL(45, 25) NULL,
    `gwpSet` VARCHAR(191) NOT NULL DEFAULT 'AR6',
    `gwpReason` TEXT NULL,
    `totals` JSON NULL,
    `runById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CalculationRun_organizationId_reportingPeriodId_createdAt_idx`(`organizationId`, `reportingPeriodId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CalculationResult` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `activityRecordId` VARCHAR(191) NOT NULL,
    `facilityId` VARCHAR(191) NOT NULL,
    `formulaCode` VARCHAR(191) NOT NULL,
    `line` VARCHAR(191) NOT NULL DEFAULT 'SCOPE2_LOCATION',
    `status` ENUM('CALCULATED', 'BLOCKED') NOT NULL,
    `inputs` JSON NOT NULL,
    `emissionFactorId` VARCHAR(191) NULL,
    `factorValue` DECIMAL(30, 15) NULL,
    `selection` JSON NULL,
    `tCO2e` DECIMAL(45, 25) NULL,
    `biogenicTCO2` DECIMAL(45, 25) NULL,
    `gases` JSON NULL,
    `inclusionPct` DECIMAL(5, 2) NULL,
    `issues` JSON NOT NULL,
    `needsConfirmation` BOOLEAN NOT NULL DEFAULT false,
    `confirmedById` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `confirmationReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CalculationResult_runId_idx`(`runId`),
    INDEX `CalculationResult_activityRecordId_createdAt_idx`(`activityRecordId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityReview` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `activityRecordId` VARCHAR(191) NOT NULL,
    `action` ENUM('SUBMITTED', 'APPROVED', 'RETURNED') NOT NULL,
    `fromStatus` ENUM('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') NOT NULL,
    `toStatus` ENUM('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `comment` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ActivityReview_activityRecordId_createdAt_idx`(`activityRecordId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PeriodLockEvent` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `reportingPeriodId` VARCHAR(191) NOT NULL,
    `action` ENUM('LOCKED', 'REOPENED') NOT NULL,
    `runId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PeriodLockEvent_reportingPeriodId_createdAt_idx`(`reportingPeriodId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerifierGrant` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reportingPeriodId` VARCHAR(191) NOT NULL,
    `grantedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VerifierGrant_organizationId_idx`(`organizationId`),
    UNIQUE INDEX `VerifierGrant_userId_reportingPeriodId_key`(`userId`, `reportingPeriodId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerificationQuery` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `reportingPeriodId` VARCHAR(191) NOT NULL,
    `activityRecordId` VARCHAR(191) NULL,
    `subject` VARCHAR(255) NOT NULL,
    `status` ENUM('OPEN', 'ANSWERED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `raisedById` VARCHAR(191) NOT NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VerificationQuery_organizationId_status_updatedAt_idx`(`organizationId`, `status`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VerificationQueryMessage` (
    `id` VARCHAR(191) NOT NULL,
    `queryId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VerificationQueryMessage_queryId_createdAt_idx`(`queryId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EmissionSource` ADD CONSTRAINT `EmissionSource_activityCode_fkey` FOREIGN KEY (`activityCode`) REFERENCES `ActivityType`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRecord` ADD CONSTRAINT `ActivityRecord_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_activityCode_fkey` FOREIGN KEY (`activityCode`) REFERENCES `ActivityType`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_regionCode_fkey` FOREIGN KEY (`regionCode`) REFERENCES `GridRegion`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculationRun` ADD CONSTRAINT `CalculationRun_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculationRun` ADD CONSTRAINT `CalculationRun_reportingPeriodId_fkey` FOREIGN KEY (`reportingPeriodId`) REFERENCES `ReportingPeriod`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculationRun` ADD CONSTRAINT `CalculationRun_runById_fkey` FOREIGN KEY (`runById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculationResult` ADD CONSTRAINT `CalculationResult_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `CalculationRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculationResult` ADD CONSTRAINT `CalculationResult_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculationResult` ADD CONSTRAINT `CalculationResult_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculationResult` ADD CONSTRAINT `CalculationResult_facilityId_fkey` FOREIGN KEY (`facilityId`) REFERENCES `Facility`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculationResult` ADD CONSTRAINT `CalculationResult_emissionFactorId_fkey` FOREIGN KEY (`emissionFactorId`) REFERENCES `EmissionFactor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CalculationResult` ADD CONSTRAINT `CalculationResult_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityReview` ADD CONSTRAINT `ActivityReview_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityReview` ADD CONSTRAINT `ActivityReview_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityReview` ADD CONSTRAINT `ActivityReview_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PeriodLockEvent` ADD CONSTRAINT `PeriodLockEvent_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PeriodLockEvent` ADD CONSTRAINT `PeriodLockEvent_reportingPeriodId_fkey` FOREIGN KEY (`reportingPeriodId`) REFERENCES `ReportingPeriod`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PeriodLockEvent` ADD CONSTRAINT `PeriodLockEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerifierGrant` ADD CONSTRAINT `VerifierGrant_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerifierGrant` ADD CONSTRAINT `VerifierGrant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerifierGrant` ADD CONSTRAINT `VerifierGrant_reportingPeriodId_fkey` FOREIGN KEY (`reportingPeriodId`) REFERENCES `ReportingPeriod`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerifierGrant` ADD CONSTRAINT `VerifierGrant_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationQuery` ADD CONSTRAINT `VerificationQuery_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationQuery` ADD CONSTRAINT `VerificationQuery_reportingPeriodId_fkey` FOREIGN KEY (`reportingPeriodId`) REFERENCES `ReportingPeriod`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationQuery` ADD CONSTRAINT `VerificationQuery_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationQuery` ADD CONSTRAINT `VerificationQuery_raisedById_fkey` FOREIGN KEY (`raisedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationQueryMessage` ADD CONSTRAINT `VerificationQueryMessage_queryId_fkey` FOREIGN KEY (`queryId`) REFERENCES `VerificationQuery`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VerificationQueryMessage` ADD CONSTRAINT `VerificationQueryMessage_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

