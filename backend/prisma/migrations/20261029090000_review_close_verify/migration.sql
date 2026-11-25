-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('SUBMITTED', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "LockAction" AS ENUM ('LOCKED', 'REOPENED');

-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityStatus" ADD VALUE 'RETURNED';
ALTER TYPE "ActivityStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "ActivityRecord" ADD COLUMN     "returnReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "ActivityType" ADD COLUMN     "defaultNcv" DECIMAL(30,15),
ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "CalculationResult" ADD COLUMN     "biogenicTCO2" DECIMAL(45,25),
ADD COLUMN     "gases" JSONB,
ADD COLUMN     "line" TEXT NOT NULL DEFAULT 'SCOPE2_LOCATION';

-- AlterTable
ALTER TABLE "CalculationRun" ADD COLUMN     "totals" JSONB;

-- AlterTable
ALTER TABLE "EmissionFactor" ALTER COLUMN "activityCode" DROP NOT NULL;

-- AlterTable
ALTER TABLE "EmissionSource" ADD COLUMN     "activityCode" TEXT;

-- AlterTable
ALTER TABLE "ReportingPeriod" ADD COLUMN     "finalRunId" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "lockedById" TEXT;

-- CreateTable
CREATE TABLE "ActivityReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activityRecordId" TEXT NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "fromStatus" "ActivityStatus" NOT NULL,
    "toStatus" "ActivityStatus" NOT NULL,
    "actorId" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodLockEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportingPeriodId" TEXT NOT NULL,
    "action" "LockAction" NOT NULL,
    "runId" TEXT,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeriodLockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifierGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportingPeriodId" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifierGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationQuery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportingPeriodId" TEXT NOT NULL,
    "activityRecordId" TEXT,
    "subject" TEXT NOT NULL,
    "status" "QueryStatus" NOT NULL DEFAULT 'OPEN',
    "raisedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationQueryMessage" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationQueryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityReview_activityRecordId_createdAt_idx" ON "ActivityReview"("activityRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "PeriodLockEvent_reportingPeriodId_createdAt_idx" ON "PeriodLockEvent"("reportingPeriodId", "createdAt");

-- CreateIndex
CREATE INDEX "VerifierGrant_organizationId_idx" ON "VerifierGrant"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "VerifierGrant_userId_reportingPeriodId_key" ON "VerifierGrant"("userId", "reportingPeriodId");

-- CreateIndex
CREATE INDEX "VerificationQuery_organizationId_status_updatedAt_idx" ON "VerificationQuery"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "VerificationQueryMessage_queryId_createdAt_idx" ON "VerificationQueryMessage"("queryId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmissionSource" ADD CONSTRAINT "EmissionSource_activityCode_fkey" FOREIGN KEY ("activityCode") REFERENCES "ActivityType"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityRecord" ADD CONSTRAINT "ActivityRecord_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityReview" ADD CONSTRAINT "ActivityReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityReview" ADD CONSTRAINT "ActivityReview_activityRecordId_fkey" FOREIGN KEY ("activityRecordId") REFERENCES "ActivityRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityReview" ADD CONSTRAINT "ActivityReview_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodLockEvent" ADD CONSTRAINT "PeriodLockEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodLockEvent" ADD CONSTRAINT "PeriodLockEvent_reportingPeriodId_fkey" FOREIGN KEY ("reportingPeriodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodLockEvent" ADD CONSTRAINT "PeriodLockEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifierGrant" ADD CONSTRAINT "VerifierGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifierGrant" ADD CONSTRAINT "VerifierGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifierGrant" ADD CONSTRAINT "VerifierGrant_reportingPeriodId_fkey" FOREIGN KEY ("reportingPeriodId") REFERENCES "ReportingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifierGrant" ADD CONSTRAINT "VerifierGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationQuery" ADD CONSTRAINT "VerificationQuery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationQuery" ADD CONSTRAINT "VerificationQuery_reportingPeriodId_fkey" FOREIGN KEY ("reportingPeriodId") REFERENCES "ReportingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationQuery" ADD CONSTRAINT "VerificationQuery_activityRecordId_fkey" FOREIGN KEY ("activityRecordId") REFERENCES "ActivityRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationQuery" ADD CONSTRAINT "VerificationQuery_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationQueryMessage" ADD CONSTRAINT "VerificationQueryMessage_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "VerificationQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationQueryMessage" ADD CONSTRAINT "VerificationQueryMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

