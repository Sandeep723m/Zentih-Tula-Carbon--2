-- ============================================================
-- Tula Carbon: factor lifecycle + fuel lab values (Nov 2026)
-- Works on MySQL and MariaDB. Run ONCE on the existing database.
-- Additive only: adds columns and one table; nothing is dropped.
-- If it fails part-way, tell the developer before re-running.
-- ============================================================

-- AlterTable
ALTER TABLE `ActivityType` ADD COLUMN `defaultDensity` DECIMAL(30, 15) NULL,
    ADD COLUMN `defaultDensitySource` VARCHAR(191) NULL,
    ADD COLUMN `defaultDensityUnit` VARCHAR(191) NULL,
    ADD COLUMN `defaultNcvPublished` VARCHAR(191) NULL,
    ADD COLUMN `defaultNcvSource` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `CalculationRun` ADD COLUMN `gwpBasis` VARCHAR(191) NOT NULL DEFAULT 'GWP-100';

-- AlterTable
ALTER TABLE `EmissionFactor` ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` VARCHAR(191) NULL,
    ADD COLUMN `gwpBasis` VARCHAR(191) NULL,
    ADD COLUMN `gwpSet` VARCHAR(191) NULL,
    ADD COLUMN `organizationId` VARCHAR(191) NULL,
    ADD COLUMN `status` ENUM('DRAFT', 'ACTIVE', 'WITHDRAWN') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `updatedAt` DATETIME(3) NULL,
    ADD COLUMN `withdrawnAt` DATETIME(3) NULL,
    ADD COLUMN `withdrawnById` VARCHAR(191) NULL,
    ADD COLUMN `withdrawnReason` TEXT NULL;

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

-- CreateIndex
CREATE INDEX `EmissionFactor_organizationId_status_idx` ON `EmissionFactor`(`organizationId`, `status`);

-- AddForeignKey
ALTER TABLE `EmissionFactor` ADD CONSTRAINT `EmissionFactor_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- Backfill: tag existing GWP factors with their assessment set
UPDATE `EmissionFactor` SET `gwpSet` = 'AR6', `gwpBasis` = 'GWP-100' WHERE `sourceVersion` LIKE 'AR6%';
UPDATE `EmissionFactor` SET `gwpSet` = 'AR5', `gwpBasis` = 'GWP-100' WHERE `sourceVersion` LIKE 'AR5%';
