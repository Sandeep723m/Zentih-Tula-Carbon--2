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
