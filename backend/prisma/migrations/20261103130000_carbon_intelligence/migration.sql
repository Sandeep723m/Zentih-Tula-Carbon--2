-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportingPeriodId" TEXT NOT NULL,
    "adjustments" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntensityMetric" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportingPeriodId" TEXT NOT NULL,
    "facilityId" TEXT,
    "metric" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntensityMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarbonTarget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baselinePeriodId" TEXT NOT NULL,
    "baselineTCO2e" DECIMAL(45,25) NOT NULL,
    "scope" TEXT NOT NULL,
    "facilityId" TEXT,
    "targetYear" INTEGER NOT NULL,
    "reductionPercent" DECIMAL(6,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarbonTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetBaselineRevision" (
    "id" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "previousTCO2e" DECIMAL(45,25),
    "newTCO2e" DECIMAL(45,25) NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetBaselineRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scenario_organizationId_createdAt_idx" ON "Scenario"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntensityMetric_organizationId_reportingPeriodId_facilityId_key" ON "IntensityMetric"("organizationId", "reportingPeriodId", "facilityId", "metric");

-- CreateIndex
CREATE INDEX "CarbonTarget_organizationId_idx" ON "CarbonTarget"("organizationId");

-- CreateIndex
CREATE INDEX "TargetBaselineRevision_targetId_idx" ON "TargetBaselineRevision"("targetId");

-- AddForeignKey
ALTER TABLE "TargetBaselineRevision" ADD CONSTRAINT "TargetBaselineRevision_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "CarbonTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

