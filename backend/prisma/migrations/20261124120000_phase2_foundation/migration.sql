-- Phase 2 / P2-A: sites, effective-dated facility placement, Data Entry assignments, GHG category,
-- calculation-result site and name snapshots. Additive; existing results default to LEGACY_UNKNOWN.

-- CreateEnum
CREATE TYPE "GhgCategory" AS ENUM ('S1_STATIONARY', 'S1_MOBILE', 'S1_FUGITIVE', 'S1_PROCESS', 'S2_ELECTRICITY', 'S2_HEAT_STEAM_COOLING', 'REMOVALS');

-- CreateEnum
CREATE TYPE "AssignmentLevel" AS ENUM ('ORGANISATION', 'SITE', 'FACILITY');

-- CreateEnum
CREATE TYPE "AssignmentScope" AS ENUM ('S1', 'S2', 'REMOVALS');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "SiteAttribution" AS ENUM ('RECORDED', 'UNASSIGNED', 'LEGACY_UNKNOWN');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "assignmentsEnforced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "assignmentsEnforcedAt" TIMESTAMP(3),
ADD COLUMN     "assignmentsEnforcedById" TEXT,
ADD COLUMN     "gridFromSnapshot" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "EmissionSource" ADD COLUMN     "ghgCategory" "GhgCategory",
ADD COLUMN     "ghgCategoryConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "ghgCategoryConfirmedById" TEXT;

-- AlterTable
ALTER TABLE "CalculationResult" ADD COLUMN     "facilityCode" TEXT,
ADD COLUMN     "facilityName" TEXT,
ADD COLUMN     "gridSource" VARCHAR(20),
ADD COLUMN     "siteAttribution" "SiteAttribution" NOT NULL DEFAULT 'LEGACY_UNKNOWN',
ADD COLUMN     "siteCode" TEXT,
ADD COLUMN     "siteId" TEXT,
ADD COLUMN     "siteName" TEXT;

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "country" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilitySiteHistory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "openKey" TEXT,
    "reason" VARCHAR(500) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "FacilitySiteHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataEntryAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" "AssignmentLevel" NOT NULL,
    "siteId" TEXT,
    "facilityId" TEXT,
    "scope" "AssignmentScope",
    "ghgCategory" "GhgCategory",
    "status" "AssignmentStatus" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DataEntryAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Site_organizationId_isActive_idx" ON "Site"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Site_organizationId_code_key" ON "Site"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FacilitySiteHistory_openKey_key" ON "FacilitySiteHistory"("openKey");

-- CreateIndex
CREATE INDEX "FacilitySiteHistory_facilityId_validFrom_idx" ON "FacilitySiteHistory"("facilityId", "validFrom");

-- CreateIndex
CREATE INDEX "FacilitySiteHistory_organizationId_idx" ON "FacilitySiteHistory"("organizationId");

-- CreateIndex
CREATE INDEX "DataEntryAssignment_organizationId_userId_status_idx" ON "DataEntryAssignment"("organizationId", "userId", "status");

-- CreateIndex
CREATE INDEX "DataEntryAssignment_facilityId_idx" ON "DataEntryAssignment"("facilityId");

-- CreateIndex
CREATE INDEX "DataEntryAssignment_siteId_idx" ON "DataEntryAssignment"("siteId");

-- CreateIndex
CREATE INDEX "Facility_organizationId_siteId_idx" ON "Facility"("organizationId", "siteId");

-- CreateIndex
CREATE INDEX "CalculationResult_runId_siteAttribution_siteId_idx" ON "CalculationResult"("runId", "siteAttribution", "siteId");

-- CreateIndex
CREATE INDEX "CalculationResult_runId_facilityId_idx" ON "CalculationResult"("runId", "facilityId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_assignmentsEnforcedById_fkey" FOREIGN KEY ("assignmentsEnforcedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySiteHistory" ADD CONSTRAINT "FacilitySiteHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySiteHistory" ADD CONSTRAINT "FacilitySiteHistory_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySiteHistory" ADD CONSTRAINT "FacilitySiteHistory_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySiteHistory" ADD CONSTRAINT "FacilitySiteHistory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilitySiteHistory" ADD CONSTRAINT "FacilitySiteHistory_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataEntryAssignment" ADD CONSTRAINT "DataEntryAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataEntryAssignment" ADD CONSTRAINT "DataEntryAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataEntryAssignment" ADD CONSTRAINT "DataEntryAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataEntryAssignment" ADD CONSTRAINT "DataEntryAssignment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataEntryAssignment" ADD CONSTRAINT "DataEntryAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataEntryAssignment" ADD CONSTRAINT "DataEntryAssignment_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataEntryAssignment" ADD CONSTRAINT "DataEntryAssignment_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmissionSource" ADD CONSTRAINT "EmissionSource_ghgCategoryConfirmedById_fkey" FOREIGN KEY ("ghgCategoryConfirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A placement ends on or after the day it starts (Prisma cannot express CHECK constraints).
ALTER TABLE "FacilitySiteHistory" ADD CONSTRAINT "FacilitySiteHistory_valid_range" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");
