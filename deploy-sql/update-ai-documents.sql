-- Tula Carbon: AI DOCUMENT INTAKE UPGRADE (existing server; run once in phpMyAdmin > Import).
-- Additive: creates two new tables. No existing table, column or row is changed or deleted.
-- CreateTable
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

-- CreateTable
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

