-- CreateTable
CREATE TABLE "EnergyInstrument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "issuer" TEXT,
    "supplier" TEXT,
    "quantityMWh" DECIMAL(20,6) NOT NULL,
    "generationFrom" DATE NOT NULL,
    "generationTo" DATE NOT NULL,
    "country" TEXT,
    "retiredAt" DATE,
    "retiredForOrg" BOOLEAN NOT NULL DEFAULT false,
    "emissionFactor" DECIMAL(30,15),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnergyInstrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstrumentAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "activityRecordId" TEXT NOT NULL,
    "mwh" DECIMAL(20,6) NOT NULL,
    "allocatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstrumentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EnergyInstrument_organizationId_type_reference_key" ON "EnergyInstrument"("organizationId", "type", "reference");

-- CreateIndex
CREATE INDEX "InstrumentAllocation_organizationId_activityRecordId_idx" ON "InstrumentAllocation"("organizationId", "activityRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentAllocation_instrumentId_activityRecordId_key" ON "InstrumentAllocation"("instrumentId", "activityRecordId");

-- AddForeignKey
ALTER TABLE "InstrumentAllocation" ADD CONSTRAINT "InstrumentAllocation_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "EnergyInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

