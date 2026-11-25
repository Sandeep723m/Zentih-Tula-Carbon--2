-- CreateEnum
CREATE TYPE "CalcResultStatus" AS ENUM ('CALCULATED', 'BLOCKED');

-- CreateTable
CREATE TABLE "ActivityType" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "sourceCategory" "SourceCategory",
    "measuredIn" TEXT NOT NULL,
    "allowedUnits" JSONB NOT NULL,
    "carbonOrigin" TEXT NOT NULL,
    "formulaCode" TEXT,

    CONSTRAINT "ActivityType_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Unit" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "baseUnit" TEXT NOT NULL,
    "toBase" DECIMAL(30,15) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "GridRegion" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "fallbackCode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GridRegion_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "EmissionFactor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "activityCode" TEXT NOT NULL,
    "gas" TEXT NOT NULL,
    "value" DECIMAL(30,15) NOT NULL,
    "numeratorUnit" TEXT NOT NULL,
    "denominatorUnit" TEXT NOT NULL,
    "carbonOrigin" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "regionCode" TEXT,
    "geography" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmissionFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalculationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportingPeriodId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "calculatedCount" INTEGER NOT NULL,
    "blockedCount" INTEGER NOT NULL,
    "notCalculableCount" INTEGER NOT NULL,
    "scope2LocationTCO2e" DECIMAL(45,25) NOT NULL,
    "boundaryId" TEXT,
    "scope2LocationBoundaryTCO2e" DECIMAL(45,25),
    "runById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalculationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalculationResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activityRecordId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "formulaCode" TEXT NOT NULL,
    "status" "CalcResultStatus" NOT NULL,
    "inputs" JSONB NOT NULL,
    "emissionFactorId" TEXT,
    "factorValue" DECIMAL(30,15),
    "selection" JSONB,
    "tCO2e" DECIMAL(45,25),
    "inclusionPct" DECIMAL(5,2),
    "issues" JSONB NOT NULL,
    "needsConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalculationResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GridRegion_name_key" ON "GridRegion"("name");

-- CreateIndex
CREATE UNIQUE INDEX "EmissionFactor_code_key" ON "EmissionFactor"("code");

-- CreateIndex
CREATE INDEX "EmissionFactor_activityCode_regionCode_validFrom_idx" ON "EmissionFactor"("activityCode", "regionCode", "validFrom");

-- CreateIndex
CREATE INDEX "CalculationRun_organizationId_reportingPeriodId_createdAt_idx" ON "CalculationRun"("organizationId", "reportingPeriodId", "createdAt");

-- CreateIndex
CREATE INDEX "CalculationResult_runId_idx" ON "CalculationResult"("runId");

-- CreateIndex
CREATE INDEX "CalculationResult_activityRecordId_createdAt_idx" ON "CalculationResult"("activityRecordId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmissionFactor" ADD CONSTRAINT "EmissionFactor_activityCode_fkey" FOREIGN KEY ("activityCode") REFERENCES "ActivityType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmissionFactor" ADD CONSTRAINT "EmissionFactor_regionCode_fkey" FOREIGN KEY ("regionCode") REFERENCES "GridRegion"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmissionFactor" ADD CONSTRAINT "EmissionFactor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationRun" ADD CONSTRAINT "CalculationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationRun" ADD CONSTRAINT "CalculationRun_reportingPeriodId_fkey" FOREIGN KEY ("reportingPeriodId") REFERENCES "ReportingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationRun" ADD CONSTRAINT "CalculationRun_runById_fkey" FOREIGN KEY ("runById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationResult" ADD CONSTRAINT "CalculationResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CalculationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationResult" ADD CONSTRAINT "CalculationResult_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationResult" ADD CONSTRAINT "CalculationResult_activityRecordId_fkey" FOREIGN KEY ("activityRecordId") REFERENCES "ActivityRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationResult" ADD CONSTRAINT "CalculationResult_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationResult" ADD CONSTRAINT "CalculationResult_emissionFactorId_fkey" FOREIGN KEY ("emissionFactorId") REFERENCES "EmissionFactor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalculationResult" ADD CONSTRAINT "CalculationResult_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

