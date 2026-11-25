-- ============================================================
-- Tula Carbon – complete MySQL schema (all migrations combined)
-- Generated: 2026-11-10T06:13:24Z from prisma-mysql/schema.prisma
-- Run this file ONCE on a fresh database, OR if the live DB
-- already has tables use 20261110_factor_lifecycle_fuel_properties.sql
-- (the additive-only patch for existing installs).
-- ============================================================
SET FOREIGN_KEY_CHECKS = 0;

-- CreateTable
CREATE TABLE `Organization` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `statusReason` TEXT NULL,
    `legalName` VARCHAR(255) NULL,
    `country` VARCHAR(191) NULL,
    `industry` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `baseYear` INTEGER NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `fiscalYearStartMonth` INTEGER NOT NULL DEFAULT 1,
    `requireEvidenceOnSubmit` BOOLEAN NOT NULL DEFAULT false,
    `qualityAnomalyPercent` INTEGER NOT NULL DEFAULT 50,
    `qualityMinHistory` INTEGER NOT NULL DEFAULT 3,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Facility` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `country` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `gridLocation` VARCHAR(191) NULL,
    `equityShare` DECIMAL(5, 2) NULL,
    `operationalControl` BOOLEAN NULL,
    `financialControl` BOOLEAN NULL,
    `scope1Active` BOOLEAN NOT NULL DEFAULT true,
    `scope2Active` BOOLEAN NOT NULL DEFAULT true,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Facility_organizationId_code_key`(`organizationId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReportingPeriod` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `status` ENUM('OPEN', 'LOCKED') NOT NULL DEFAULT 'OPEN',
    `lockedAt` DATETIME(3) NULL,
    `lockedById` VARCHAR(191) NULL,
    `finalRunId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReportingPeriod_organizationId_startDate_idx`(`organizationId`, `startDate`),
    UNIQUE INDEX `ReportingPeriod_organizationId_name_key`(`organizationId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmissionSource` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `facilityId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `category` ENUM('FUEL_COMBUSTION', 'FUGITIVE_GAS', 'PURCHASED_ELECTRICITY', 'PURCHASED_ENERGY', 'PROCESS', 'REMOVAL') NOT NULL,
    `material` VARCHAR(191) NULL,
    `activityCode` VARCHAR(191) NULL,
    `defaultUnit` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `EmissionSource_organizationId_idx`(`organizationId`),
    UNIQUE INDEX `EmissionSource_facilityId_name_key`(`facilityId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `platformRole` ENUM('SUPER_ADMIN') NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `mfaSecret` VARCHAR(191) NULL,
    `mfaEnabled` BOOLEAN NOT NULL DEFAULT false,
    `mfaLastStep` INTEGER NULL,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Membership` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `role` ENUM('TENANT_ADMIN', 'DATA_ENTRY', 'REVIEWER', 'VERIFIER') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Membership_userId_organizationId_key`(`userId`, `organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `mfaVerified` BOOLEAN NOT NULL DEFAULT false,
    `mfaFailedCount` INTEGER NOT NULL DEFAULT 0,
    `activeOrganizationId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
    INDEX `Session_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NULL,
    `actorUserId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivityRecord` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `facilityId` VARCHAR(191) NOT NULL,
    `reportingPeriodId` VARCHAR(191) NOT NULL,
    `emissionSourceId` VARCHAR(191) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `quantity` DECIMAL(20, 6) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `parameters` JSON NULL,
    `notes` TEXT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
    `submittedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `returnReason` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `updatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ActivityRecord_organizationId_status_idx`(`organizationId`, `status`),
    INDEX `ActivityRecord_organizationId_reportingPeriodId_facilityId_idx`(`organizationId`, `reportingPeriodId`, `facilityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Evidence` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `activityRecordId` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Evidence_storageKey_key`(`storageKey`),
    INDEX `Evidence_activityRecordId_idx`(`activityRecordId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `planName` VARCHAR(191) NOT NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED') NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Subscription_organizationId_key`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionEvent` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `actorUserId` VARCHAR(191) NULL,
    `planName` VARCHAR(191) NOT NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED') NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SubscriptionEvent_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrgBoundary` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `approach` ENUM('EQUITY', 'OPERATIONAL', 'FINANCIAL') NOT NULL,
    `status` ENUM('DRAFT', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
    `effectiveFrom` DATE NOT NULL,
    `baseYear` INTEGER NOT NULL,
    `approvedAt` DATETIME(3) NULL,
    `approvedById` VARCHAR(191) NULL,
    `changeReason` TEXT NULL,
    `snapshot` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OrgBoundary_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    UNIQUE INDEX `OrgBoundary_organizationId_version_key`(`organizationId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    `defaultNcvPublished` VARCHAR(191) NULL,
    `defaultNcvSource` VARCHAR(191) NULL,
    `defaultDensity` DECIMAL(30, 15) NULL,
    `defaultDensityUnit` VARCHAR(191) NULL,
    `defaultDensitySource` VARCHAR(191) NULL,
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
    `gwpSet` VARCHAR(191) NULL,
    `gwpBasis` VARCHAR(191) NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'WITHDRAWN') NOT NULL DEFAULT 'ACTIVE',
    `organizationId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `withdrawnById` VARCHAR(191) NULL,
    `withdrawnAt` DATETIME(3) NULL,
    `withdrawnReason` TEXT NULL,

    UNIQUE INDEX `EmissionFactor_code_key`(`code`),
    INDEX `EmissionFactor_activityCode_regionCode_validFrom_idx`(`activityCode`, `regionCode`, `validFrom`),
    INDEX `EmissionFactor_organizationId_status_idx`(`organizationId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FuelProperty` (
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
    `gwpBasis` VARCHAR(191) NOT NULL DEFAULT 'GWP-100',
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

-- CreateTable
CREATE TABLE `IntakeDocument` (
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
    `category` VARCHAR(191) NULL,
    `duplicateOfId` VARCHAR(191) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `rejectReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IntakeDocument_storageKey_key`(`storageKey`),
    INDEX `IntakeDocument_organizationId_createdAt_idx`(`organizationId`, `createdAt`),
    INDEX `IntakeDocument_organizationId_status_idx`(`organizationId`, `status`),
    INDEX `IntakeDocument_organizationId_sha256_idx`(`organizationId`, `sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiUsageEvent` (
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
ALTER TABLE `Facility` ADD CONSTRAINT `Facility_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportingPeriod` ADD CONSTRAINT `ReportingPeriod_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionSource` ADD CONSTRAINT `EmissionSource_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionSource` ADD CONSTRAINT `EmissionSource_facilityId_fkey` FOREIGN KEY (`facilityId`) REFERENCES `Facility`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionSource` ADD CONSTRAINT `EmissionSource_activityCode_fkey` FOREIGN KEY (`activityCode`) REFERENCES `ActivityType`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRecord` ADD CONSTRAINT `ActivityRecord_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRecord` ADD CONSTRAINT `ActivityRecord_facilityId_fkey` FOREIGN KEY (`facilityId`) REFERENCES `Facility`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRecord` ADD CONSTRAINT `ActivityRecord_reportingPeriodId_fkey` FOREIGN KEY (`reportingPeriodId`) REFERENCES `ReportingPeriod`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRecord` ADD CONSTRAINT `ActivityRecord_emissionSourceId_fkey` FOREIGN KEY (`emissionSourceId`) REFERENCES `EmissionSource`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRecord` ADD CONSTRAINT `ActivityRecord_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRecord` ADD CONSTRAINT `ActivityRecord_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivityRecord` ADD CONSTRAINT `ActivityRecord_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Evidence` ADD CONSTRAINT `Evidence_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Evidence` ADD CONSTRAINT `Evidence_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Evidence` ADD CONSTRAINT `Evidence_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SubscriptionEvent` ADD CONSTRAINT `SubscriptionEvent_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrgBoundary` ADD CONSTRAINT `OrgBoundary_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrgBoundary` ADD CONSTRAINT `OrgBoundary_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_activityCode_fkey` FOREIGN KEY (`activityCode`) REFERENCES `ActivityType`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_regionCode_fkey` FOREIGN KEY (`regionCode`) REFERENCES `GridRegion`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_withdrawnById_fkey` FOREIGN KEY (`withdrawnById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelProperty` ADD CONSTRAINT `FuelProperty_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelProperty` ADD CONSTRAINT `FuelProperty_facilityId_fkey` FOREIGN KEY (`facilityId`) REFERENCES `Facility`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelProperty` ADD CONSTRAINT `FuelProperty_activityCode_fkey` FOREIGN KEY (`activityCode`) REFERENCES `ActivityType`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelProperty` ADD CONSTRAINT `FuelProperty_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FuelProperty` ADD CONSTRAINT `FuelProperty_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE `IntakeDocument` ADD CONSTRAINT `IntakeDocument_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeDocument` ADD CONSTRAINT `IntakeDocument_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeDocument` ADD CONSTRAINT `IntakeDocument_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiUsageEvent` ADD CONSTRAINT `AiUsageEvent_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiUsageEvent` ADD CONSTRAINT `AiUsageEvent_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `IntakeDocument`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeMatch` ADD CONSTRAINT `IntakeMatch_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `IntakeDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeMatch` ADD CONSTRAINT `IntakeMatch_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeCorrection` ADD CONSTRAINT `IntakeCorrection_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `IntakeDocument`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReconciliationItem` ADD CONSTRAINT `ReconciliationItem_reconciliationId_fkey` FOREIGN KEY (`reconciliationId`) REFERENCES `Reconciliation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TargetBaselineRevision` ADD CONSTRAINT `TargetBaselineRevision_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `CarbonTarget`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InstrumentAllocation` ADD CONSTRAINT `InstrumentAllocation_instrumentId_fkey` FOREIGN KEY (`instrumentId`) REFERENCES `EnergyInstrument`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Backfill: tag existing GWP factors with their assessment set
-- ============================================================
UPDATE `EmissionFactor` SET `gwpSet` = 'AR6', `gwpBasis` = 'GWP-100' WHERE `sourceVersion` LIKE 'AR6%';
UPDATE `EmissionFactor` SET `gwpSet` = 'AR5', `gwpBasis` = 'GWP-100' WHERE `sourceVersion` LIKE 'AR5%';

SET FOREIGN_KEY_CHECKS = 1;
