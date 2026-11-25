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

