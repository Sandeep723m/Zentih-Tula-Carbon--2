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

