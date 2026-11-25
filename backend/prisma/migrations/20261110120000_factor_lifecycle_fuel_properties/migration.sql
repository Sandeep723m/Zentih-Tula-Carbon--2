-- CreateEnum
CREATE TYPE "FactorStatus" AS ENUM ('DRAFT', 'ACTIVE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "FuelPropertyStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "ActivityType" ADD COLUMN     "defaultDensity" DECIMAL(30,15),
ADD COLUMN     "defaultDensitySource" TEXT,
ADD COLUMN     "defaultDensityUnit" TEXT,
ADD COLUMN     "defaultNcvPublished" TEXT,
ADD COLUMN     "defaultNcvSource" TEXT;

-- AlterTable
ALTER TABLE "CalculationRun" ADD COLUMN     "gwpBasis" TEXT NOT NULL DEFAULT 'GWP-100';

-- AlterTable
ALTER TABLE "EmissionFactor" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "gwpBasis" TEXT,
ADD COLUMN     "gwpSet" TEXT,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "status" "FactorStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updatedAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnAt" TIMESTAMP(3),
ADD COLUMN     "withdrawnById" TEXT,
ADD COLUMN     "withdrawnReason" TEXT;

-- CreateTable
CREATE TABLE "FuelProperty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "activityCode" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "FuelPropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "ncv" DECIMAL(30,15),
    "density" DECIMAL(30,15),
    "densityUnit" TEXT,
    "carbonContent" DECIMAL(30,15),
    "oxidationFactor" DECIMAL(10,6),
    "biogenicShare" DECIMAL(10,6),
    "certificateRef" TEXT NOT NULL,
    "laboratory" TEXT,
    "sampleDate" DATE,
    "notes" TEXT,
    "evidenceFile" TEXT,
    "evidenceName" TEXT,
    "evidenceSha256" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "FuelProperty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FuelProperty_organizationId_facilityId_activityCode_month_idx" ON "FuelProperty"("organizationId", "facilityId", "activityCode", "month");

-- CreateIndex
CREATE UNIQUE INDEX "FuelProperty_facilityId_activityCode_month_version_key" ON "FuelProperty"("facilityId", "activityCode", "month", "version");

-- CreateIndex
CREATE INDEX "EmissionFactor_organizationId_status_idx" ON "EmissionFactor"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "EmissionFactor" ADD CONSTRAINT "EmissionFactor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmissionFactor" ADD CONSTRAINT "EmissionFactor_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmissionFactor" ADD CONSTRAINT "EmissionFactor_withdrawnById_fkey" FOREIGN KEY ("withdrawnById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelProperty" ADD CONSTRAINT "FuelProperty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelProperty" ADD CONSTRAINT "FuelProperty_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelProperty" ADD CONSTRAINT "FuelProperty_activityCode_fkey" FOREIGN KEY ("activityCode") REFERENCES "ActivityType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelProperty" ADD CONSTRAINT "FuelProperty_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelProperty" ADD CONSTRAINT "FuelProperty_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill (data, no deletes): GWP rows carry their assessment set in a structured column instead of being
-- recognised from the "source version" text. Every existing factor stays ACTIVE and shared (organizationId null).
UPDATE "EmissionFactor" SET "gwpSet" = 'AR6', "gwpBasis" = 'GWP-100' WHERE "sourceVersion" LIKE 'AR6%';
UPDATE "EmissionFactor" SET "gwpSet" = 'AR5', "gwpBasis" = 'GWP-100' WHERE "sourceVersion" LIKE 'AR5%';
