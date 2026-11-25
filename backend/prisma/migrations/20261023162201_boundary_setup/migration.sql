-- CreateEnum
CREATE TYPE "BoundaryApproach" AS ENUM ('EQUITY', 'OPERATIONAL', 'FINANCIAL');

-- CreateEnum
CREATE TYPE "BoundaryStatus" AS ENUM ('DRAFT', 'APPROVED');

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "equityShare" DECIMAL(5,2),
ADD COLUMN     "financialControl" BOOLEAN,
ADD COLUMN     "gridLocation" TEXT,
ADD COLUMN     "operationalControl" BOOLEAN,
ADD COLUMN     "scope1Active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "scope2Active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "baseYear" INTEGER;

-- CreateTable
CREATE TABLE "OrgBoundary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "approach" "BoundaryApproach" NOT NULL,
    "status" "BoundaryStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" DATE NOT NULL,
    "baseYear" INTEGER NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgBoundary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgBoundary_organizationId_createdAt_idx" ON "OrgBoundary"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrgBoundary_organizationId_version_key" ON "OrgBoundary"("organizationId", "version");

-- AddForeignKey
ALTER TABLE "OrgBoundary" ADD CONSTRAINT "OrgBoundary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgBoundary" ADD CONSTRAINT "OrgBoundary_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

