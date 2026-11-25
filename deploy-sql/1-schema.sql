-- Tula Carbon: 1 of 5, SCHEMA (fresh install only).
-- Run first, in phpMyAdmin > your database > Import. Creates every table if missing. Not for upgrading an existing site: use 2-upgrade.


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `ActivityRecord` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `facilityId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reportingPeriodId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `emissionSourceId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `startDate` date NOT NULL,
  `endDate` date NOT NULL,
  `quantity` decimal(20,6) NOT NULL,
  `unit` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `parameters` json DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `status` enum('DRAFT','SUBMITTED','RETURNED','APPROVED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `submittedAt` datetime(3) DEFAULT NULL,
  `reviewedById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewedAt` datetime(3) DEFAULT NULL,
  `returnReason` text COLLATE utf8mb4_unicode_ci,
  `createdById` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `updatedById` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ActivityRecord_organizationId_status_idx` (`organizationId`,`status`),
  KEY `ActivityRecord_organizationId_reportingPeriodId_facilityId_idx` (`organizationId`,`reportingPeriodId`,`facilityId`),
  KEY `ActivityRecord_facilityId_fkey` (`facilityId`),
  KEY `ActivityRecord_reportingPeriodId_fkey` (`reportingPeriodId`),
  KEY `ActivityRecord_emissionSourceId_fkey` (`emissionSourceId`),
  KEY `ActivityRecord_createdById_fkey` (`createdById`),
  KEY `ActivityRecord_updatedById_fkey` (`updatedById`),
  KEY `ActivityRecord_reviewedById_fkey` (`reviewedById`),
  CONSTRAINT `ActivityRecord_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ActivityRecord_emissionSourceId_fkey` FOREIGN KEY (`emissionSourceId`) REFERENCES `EmissionSource` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ActivityRecord_facilityId_fkey` FOREIGN KEY (`facilityId`) REFERENCES `Facility` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ActivityRecord_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ActivityRecord_reportingPeriodId_fkey` FOREIGN KEY (`reportingPeriodId`) REFERENCES `ReportingPeriod` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ActivityRecord_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ActivityRecord_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `ActivityReview` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activityRecordId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` enum('SUBMITTED','APPROVED','RETURNED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `fromStatus` enum('DRAFT','SUBMITTED','RETURNED','APPROVED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `toStatus` enum('DRAFT','SUBMITTED','RETURNED','APPROVED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `actorId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `comment` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ActivityReview_activityRecordId_createdAt_idx` (`activityRecordId`,`createdAt`),
  KEY `ActivityReview_organizationId_fkey` (`organizationId`),
  KEY `ActivityReview_actorId_fkey` (`actorId`),
  CONSTRAINT `ActivityReview_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ActivityReview_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ActivityReview_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `ActivityType` (
  `code` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope` int NOT NULL,
  `category` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sourceCategory` enum('FUEL_COMBUSTION','FUGITIVE_GAS','PURCHASED_ELECTRICITY','PURCHASED_ENERGY','PROCESS','REMOVAL') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `measuredIn` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `allowedUnits` json NOT NULL,
  `carbonOrigin` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `formulaCode` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `defaultNcv` decimal(30,15) DEFAULT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `AuditLog` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actorUserId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entityType` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entityId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `before` json DEFAULT NULL,
  `after` json DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `AuditLog_organizationId_createdAt_idx` (`organizationId`,`createdAt`),
  KEY `AuditLog_createdAt_idx` (`createdAt`),
  CONSTRAINT `AuditLog_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `CalculationResult` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `runId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activityRecordId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `facilityId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `formulaCode` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `line` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SCOPE2_LOCATION',
  `status` enum('CALCULATED','BLOCKED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `inputs` json NOT NULL,
  `emissionFactorId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `factorValue` decimal(30,15) DEFAULT NULL,
  `selection` json DEFAULT NULL,
  `tCO2e` decimal(45,25) DEFAULT NULL,
  `biogenicTCO2` decimal(45,25) DEFAULT NULL,
  `gases` json DEFAULT NULL,
  `inclusionPct` decimal(5,2) DEFAULT NULL,
  `issues` json NOT NULL,
  `needsConfirmation` tinyint(1) NOT NULL DEFAULT '0',
  `confirmedById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `confirmedAt` datetime(3) DEFAULT NULL,
  `confirmationReason` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `CalculationResult_runId_idx` (`runId`),
  KEY `CalculationResult_activityRecordId_createdAt_idx` (`activityRecordId`,`createdAt`),
  KEY `CalculationResult_organizationId_fkey` (`organizationId`),
  KEY `CalculationResult_facilityId_fkey` (`facilityId`),
  KEY `CalculationResult_emissionFactorId_fkey` (`emissionFactorId`),
  KEY `CalculationResult_confirmedById_fkey` (`confirmedById`),
  CONSTRAINT `CalculationResult_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CalculationResult_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CalculationResult_emissionFactorId_fkey` FOREIGN KEY (`emissionFactorId`) REFERENCES `EmissionFactor` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CalculationResult_facilityId_fkey` FOREIGN KEY (`facilityId`) REFERENCES `Facility` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CalculationResult_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CalculationResult_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `CalculationRun` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `CalculationRun` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reportingPeriodId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `engineVersion` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recordCount` int NOT NULL,
  `calculatedCount` int NOT NULL,
  `blockedCount` int NOT NULL,
  `notCalculableCount` int NOT NULL,
  `scope2LocationTCO2e` decimal(45,25) NOT NULL,
  `boundaryId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `scope2LocationBoundaryTCO2e` decimal(45,25) DEFAULT NULL,
  `gwpSet` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'AR6',
  `gwpReason` text COLLATE utf8mb4_unicode_ci,
  `totals` json DEFAULT NULL,
  `runById` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `CalculationRun_organizationId_reportingPeriodId_createdAt_idx` (`organizationId`,`reportingPeriodId`,`createdAt`),
  KEY `CalculationRun_reportingPeriodId_fkey` (`reportingPeriodId`),
  KEY `CalculationRun_runById_fkey` (`runById`),
  CONSTRAINT `CalculationRun_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CalculationRun_reportingPeriodId_fkey` FOREIGN KEY (`reportingPeriodId`) REFERENCES `ReportingPeriod` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CalculationRun_runById_fkey` FOREIGN KEY (`runById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `EmissionFactor` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activityCode` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gas` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` decimal(30,15) NOT NULL,
  `numeratorUnit` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `denominatorUnit` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `carbonOrigin` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sourceVersion` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `validFrom` date NOT NULL,
  `validTo` date DEFAULT NULL,
  `regionCode` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `geography` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tier` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `notes` text COLLATE utf8mb4_unicode_ci,
  `createdById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `EmissionFactor_code_key` (`code`),
  KEY `EmissionFactor_activityCode_regionCode_validFrom_idx` (`activityCode`,`regionCode`,`validFrom`),
  KEY `EmissionFactor_regionCode_fkey` (`regionCode`),
  KEY `EmissionFactor_createdById_fkey` (`createdById`),
  CONSTRAINT `EmissionFactor_activityCode_fkey` FOREIGN KEY (`activityCode`) REFERENCES `ActivityType` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `EmissionFactor_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `EmissionFactor_regionCode_fkey` FOREIGN KEY (`regionCode`) REFERENCES `GridRegion` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `EmissionSource` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `facilityId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('FUEL_COMBUSTION','FUGITIVE_GAS','PURCHASED_ELECTRICITY','PURCHASED_ENERGY','PROCESS','REMOVAL') COLLATE utf8mb4_unicode_ci NOT NULL,
  `material` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `activityCode` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `defaultUnit` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `EmissionSource_facilityId_name_key` (`facilityId`,`name`),
  KEY `EmissionSource_organizationId_idx` (`organizationId`),
  KEY `EmissionSource_activityCode_fkey` (`activityCode`),
  CONSTRAINT `EmissionSource_activityCode_fkey` FOREIGN KEY (`activityCode`) REFERENCES `ActivityType` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `EmissionSource_facilityId_fkey` FOREIGN KEY (`facilityId`) REFERENCES `Facility` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `EmissionSource_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `Evidence` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activityRecordId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fileName` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mimeType` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sizeBytes` int NOT NULL,
  `sha256` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `storageKey` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `uploadedById` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Evidence_storageKey_key` (`storageKey`),
  KEY `Evidence_activityRecordId_idx` (`activityRecordId`),
  KEY `Evidence_organizationId_fkey` (`organizationId`),
  KEY `Evidence_uploadedById_fkey` (`uploadedById`),
  CONSTRAINT `Evidence_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Evidence_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Evidence_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `Facility` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `country` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `gridLocation` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `equityShare` decimal(5,2) DEFAULT NULL,
  `operationalControl` tinyint(1) DEFAULT NULL,
  `financialControl` tinyint(1) DEFAULT NULL,
  `scope1Active` tinyint(1) NOT NULL DEFAULT '1',
  `scope2Active` tinyint(1) NOT NULL DEFAULT '1',
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Facility_organizationId_code_key` (`organizationId`,`code`),
  CONSTRAINT `Facility_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `GridRegion` (
  `code` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `country` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fallbackCode` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sortOrder` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`code`),
  UNIQUE KEY `GridRegion_name_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `Membership` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('TENANT_ADMIN','DATA_ENTRY','REVIEWER','VERIFIER') COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Membership_userId_organizationId_key` (`userId`,`organizationId`),
  KEY `Membership_organizationId_fkey` (`organizationId`),
  CONSTRAINT `Membership_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `Membership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `Organization` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('ACTIVE','SUSPENDED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  `statusReason` text COLLATE utf8mb4_unicode_ci,
  `legalName` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `country` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `industry` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `baseYear` int DEFAULT NULL,
  `timezone` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'UTC',
  `fiscalYearStartMonth` int NOT NULL DEFAULT '1',
  `requireEvidenceOnSubmit` tinyint(1) NOT NULL DEFAULT '0',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `OrgBoundary` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `version` int NOT NULL,
  `approach` enum('EQUITY','OPERATIONAL','FINANCIAL') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('DRAFT','APPROVED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `effectiveFrom` date NOT NULL,
  `baseYear` int NOT NULL,
  `approvedAt` datetime(3) DEFAULT NULL,
  `approvedById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `changeReason` text COLLATE utf8mb4_unicode_ci,
  `snapshot` json DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `OrgBoundary_organizationId_version_key` (`organizationId`,`version`),
  KEY `OrgBoundary_organizationId_createdAt_idx` (`organizationId`,`createdAt`),
  KEY `OrgBoundary_approvedById_fkey` (`approvedById`),
  CONSTRAINT `OrgBoundary_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `OrgBoundary_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `PeriodLockEvent` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reportingPeriodId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` enum('LOCKED','REOPENED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `runId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actorId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `PeriodLockEvent_reportingPeriodId_createdAt_idx` (`reportingPeriodId`,`createdAt`),
  KEY `PeriodLockEvent_organizationId_fkey` (`organizationId`),
  KEY `PeriodLockEvent_actorId_fkey` (`actorId`),
  CONSTRAINT `PeriodLockEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `PeriodLockEvent_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PeriodLockEvent_reportingPeriodId_fkey` FOREIGN KEY (`reportingPeriodId`) REFERENCES `ReportingPeriod` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `ReportingPeriod` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `startDate` date NOT NULL,
  `endDate` date NOT NULL,
  `status` enum('OPEN','LOCKED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `lockedAt` datetime(3) DEFAULT NULL,
  `lockedById` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `finalRunId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ReportingPeriod_organizationId_name_key` (`organizationId`,`name`),
  KEY `ReportingPeriod_organizationId_startDate_idx` (`organizationId`,`startDate`),
  CONSTRAINT `ReportingPeriod_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `Session` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tokenHash` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mfaVerified` tinyint(1) NOT NULL DEFAULT '0',
  `mfaFailedCount` int NOT NULL DEFAULT '0',
  `activeOrganizationId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `expiresAt` datetime(3) NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `Session_tokenHash_key` (`tokenHash`),
  KEY `Session_userId_idx` (`userId`),
  CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `Subscription` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `planName` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('TRIAL','ACTIVE','EXPIRED','SUSPENDED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `startDate` date NOT NULL,
  `endDate` date DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Subscription_organizationId_key` (`organizationId`),
  CONSTRAINT `Subscription_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `SubscriptionEvent` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actorUserId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `planName` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('TRIAL','ACTIVE','EXPIRED','SUSPENDED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `startDate` date NOT NULL,
  `endDate` date DEFAULT NULL,
  `reason` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `SubscriptionEvent_organizationId_createdAt_idx` (`organizationId`,`createdAt`),
  CONSTRAINT `SubscriptionEvent_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `Unit` (
  `code` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dimension` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `baseUnit` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `toBase` decimal(30,15) NOT NULL,
  `notes` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `User` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `passwordHash` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mustChangePassword` tinyint(1) NOT NULL DEFAULT '0',
  `platformRole` enum('SUPER_ADMIN') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `isActive` tinyint(1) NOT NULL DEFAULT '1',
  `mfaSecret` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mfaEnabled` tinyint(1) NOT NULL DEFAULT '0',
  `mfaLastStep` int DEFAULT NULL,
  `failedLoginCount` int NOT NULL DEFAULT '0',
  `lockedUntil` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `User_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `VerificationQuery` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reportingPeriodId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `activityRecordId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subject` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('OPEN','ANSWERED','CLOSED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `raisedById` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `closedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `VerificationQuery_organizationId_status_updatedAt_idx` (`organizationId`,`status`,`updatedAt`),
  KEY `VerificationQuery_reportingPeriodId_fkey` (`reportingPeriodId`),
  KEY `VerificationQuery_activityRecordId_fkey` (`activityRecordId`),
  KEY `VerificationQuery_raisedById_fkey` (`raisedById`),
  CONSTRAINT `VerificationQuery_activityRecordId_fkey` FOREIGN KEY (`activityRecordId`) REFERENCES `ActivityRecord` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `VerificationQuery_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `VerificationQuery_raisedById_fkey` FOREIGN KEY (`raisedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `VerificationQuery_reportingPeriodId_fkey` FOREIGN KEY (`reportingPeriodId`) REFERENCES `ReportingPeriod` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `VerificationQueryMessage` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `queryId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `authorId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `VerificationQueryMessage_queryId_createdAt_idx` (`queryId`,`createdAt`),
  KEY `VerificationQueryMessage_authorId_fkey` (`authorId`),
  CONSTRAINT `VerificationQueryMessage_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `VerificationQueryMessage_queryId_fkey` FOREIGN KEY (`queryId`) REFERENCES `VerificationQuery` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `VerifierGrant` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `organizationId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reportingPeriodId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `grantedById` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `VerifierGrant_userId_reportingPeriodId_key` (`userId`,`reportingPeriodId`),
  KEY `VerifierGrant_organizationId_idx` (`organizationId`),
  KEY `VerifierGrant_reportingPeriodId_fkey` (`reportingPeriodId`),
  KEY `VerifierGrant_grantedById_fkey` (`grantedById`),
  CONSTRAINT `VerifierGrant_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `VerifierGrant_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `VerifierGrant_reportingPeriodId_fkey` FOREIGN KEY (`reportingPeriodId`) REFERENCES `ReportingPeriod` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `VerifierGrant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;


-- Quantities are never negative (zero is valid: e.g. a refrigerant mass balance with no top-up).
ALTER TABLE `ActivityRecord` ADD CONSTRAINT `ActivityRecord_quantity_check` CHECK (`quantity` >= 0);

-- AI document intake
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


-- Phase 2: Document Intelligence Centre
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


-- Phase 3: Data Quality Dashboard
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


-- Phase 4: Reconciliation
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


-- Phase 7: Carbon Intelligence
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


-- Phase 9: Renewable Energy
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

