-- ============================================================
-- Tula Carbon: emission factor governance (TC-ARC-006), Nov 2026
-- Works on MySQL and MariaDB. Run ONCE, AFTER
-- 20261110_factor_lifecycle_fuel_properties.sql.
-- Adds columns and one table; renames factor statuses; deletes
-- only EF-9999, and only if no calculation result uses it.
-- ============================================================

-- 1. Factor statuses: allow old and new values, convert, then keep only the new ones (below).
ALTER TABLE `EmissionFactor` MODIFY `status` ENUM('DRAFT', 'ACTIVE', 'WITHDRAWN', 'IN_REVIEW', 'APPROVED', 'IN_USE', 'SUPERSEDED') NOT NULL DEFAULT 'DRAFT';
UPDATE `EmissionFactor` SET `status` = 'APPROVED' WHERE `status` = 'ACTIVE';
UPDATE `EmissionFactor` SET `status` = 'SUPERSEDED' WHERE `status` = 'WITHDRAWN';

-- 2. Schema

-- AlterTable
ALTER TABLE `CalculationResult` ADD COLUMN `factorUnit` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `EmissionFactor` ADD COLUMN `approvalNote` TEXT NULL,
    ADD COLUMN `basis` TEXT NULL,
    ADD COLUMN `evidenceFile` VARCHAR(191) NULL,
    ADD COLUMN `evidenceName` VARCHAR(255) NULL,
    ADD COLUMN `evidenceSha256` VARCHAR(191) NULL,
    ADD COLUMN `submittedAt` DATETIME(3) NULL,
    ADD COLUMN `submittedById` VARCHAR(191) NULL,
    ADD COLUMN `supersedesId` VARCHAR(191) NULL,
    MODIFY `status` ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'IN_USE', 'SUPERSEDED') NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE `UnitRequest` (
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

-- AddForeignKey
ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UnitRequest` ADD CONSTRAINT `UnitRequest_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UnitRequest` ADD CONSTRAINT `UnitRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UnitRequest` ADD CONSTRAINT `UnitRequest_resolvedById_fkey` FOREIGN KEY (`resolvedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- 3. Data
-- An organisation's factor that a calculation result already uses is IN_USE (frozen).
UPDATE `EmissionFactor` ef SET ef.`status` = 'IN_USE'
WHERE ef.`organizationId` IS NOT NULL AND ef.`status` = 'APPROVED'
  AND EXISTS (SELECT 1 FROM `CalculationResult` r WHERE r.`emissionFactorId` = ef.`id`);
-- Results calculated earlier get the units snapshot from their factor.
UPDATE `CalculationResult` r JOIN `EmissionFactor` ef ON ef.`id` = r.`emissionFactorId`
SET r.`factorUnit` = CONCAT(ef.`numeratorUnit`, ' / ', ef.`denominatorUnit`) WHERE r.`factorUnit` IS NULL;

-- 4. A-1: delete the EF-9999 test entry (coal per "ton-hour"), only if nothing references it.
DELETE ef FROM `EmissionFactor` ef
WHERE ef.`code` = 'EF-9999'
  AND NOT EXISTS (SELECT 1 FROM `CalculationResult` r WHERE r.`emissionFactorId` = ef.`id`);
SELECT COUNT(*) AS `ef9999_still_present_because_used` FROM `EmissionFactor` WHERE `code` = 'EF-9999';
