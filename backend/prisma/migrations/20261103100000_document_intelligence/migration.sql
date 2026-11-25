-- AlterTable
ALTER TABLE "IntakeDocument" ADD COLUMN     "category" TEXT,
ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IntakeMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "invoiceIndex" INTEGER NOT NULL,
    "activityRecordId" TEXT NOT NULL,
    "withEvidence" BOOLEAN NOT NULL,
    "matchedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeCorrection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "invoiceIndex" INTEGER NOT NULL,
    "field" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntakeMatch_organizationId_activityRecordId_idx" ON "IntakeMatch"("organizationId", "activityRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeMatch_documentId_invoiceIndex_key" ON "IntakeMatch"("documentId", "invoiceIndex");

-- CreateIndex
CREATE INDEX "IntakeCorrection_documentId_idx" ON "IntakeCorrection"("documentId");

-- CreateIndex
CREATE INDEX "IntakeCorrection_organizationId_field_idx" ON "IntakeCorrection"("organizationId", "field");

-- AddForeignKey
ALTER TABLE "IntakeMatch" ADD CONSTRAINT "IntakeMatch_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "IntakeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeMatch" ADD CONSTRAINT "IntakeMatch_activityRecordId_fkey" FOREIGN KEY ("activityRecordId") REFERENCES "ActivityRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeCorrection" ADD CONSTRAINT "IntakeCorrection_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "IntakeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Documents attached before this release become a match for their first invoice.
INSERT INTO "IntakeMatch" ("id", "organizationId", "documentId", "invoiceIndex", "activityRecordId", "withEvidence", "matchedById", "createdAt")
SELECT gen_random_uuid()::text, "organizationId", "id", 0, "activityRecordId", true, "uploadedById", "updatedAt" FROM "IntakeDocument" WHERE "activityRecordId" IS NOT NULL;
