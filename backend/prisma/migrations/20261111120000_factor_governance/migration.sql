-- CreateEnum
CREATE TYPE "UnitRequestStatus" AS ENUM ('OPEN', 'ADDED', 'DECLINED');

-- AlterEnum
BEGIN;
CREATE TYPE "FactorStatus_new" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'IN_USE', 'SUPERSEDED');
ALTER TABLE "EmissionFactor" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "EmissionFactor" ALTER COLUMN "status" TYPE "FactorStatus_new" USING ((CASE "status"::text WHEN 'ACTIVE' THEN 'APPROVED' WHEN 'WITHDRAWN' THEN 'SUPERSEDED' ELSE "status"::text END)::"FactorStatus_new");
ALTER TYPE "FactorStatus" RENAME TO "FactorStatus_old";
ALTER TYPE "FactorStatus_new" RENAME TO "FactorStatus";
DROP TYPE "FactorStatus_old";
ALTER TABLE "EmissionFactor" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterTable
ALTER TABLE "CalculationResult" ADD COLUMN     "factorUnit" TEXT;

-- AlterTable
ALTER TABLE "EmissionFactor" ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "basis" TEXT,
ADD COLUMN     "evidenceFile" TEXT,
ADD COLUMN     "evidenceName" TEXT,
ADD COLUMN     "evidenceSha256" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT,
ADD COLUMN     "supersedesId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE "UnitRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "requestedById" TEXT NOT NULL,
    "activityCode" TEXT,
    "unit" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "UnitRequestStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnitRequest_status_createdAt_idx" ON "UnitRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "EmissionFactor" ADD CONSTRAINT "EmissionFactor_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitRequest" ADD CONSTRAINT "UnitRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitRequest" ADD CONSTRAINT "UnitRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitRequest" ADD CONSTRAINT "UnitRequest_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data (TC-ARC-006). No row is deleted. ACTIVE became APPROVED and WITHDRAWN became SUPERSEDED above.
-- An organisation's factor that a calculation result already uses is IN_USE (frozen).
UPDATE "EmissionFactor" ef SET "status" = 'IN_USE'
WHERE ef."organizationId" IS NOT NULL AND ef."status" = 'APPROVED'
  AND EXISTS (SELECT 1 FROM "CalculationResult" r WHERE r."emissionFactorId" = ef."id");
-- Results calculated earlier get the units snapshot from their factor (factors in use are never edited).
UPDATE "CalculationResult" r SET "factorUnit" = ef."numeratorUnit" || ' / ' || ef."denominatorUnit"
FROM "EmissionFactor" ef WHERE r."emissionFactorId" = ef."id" AND r."factorUnit" IS NULL;
