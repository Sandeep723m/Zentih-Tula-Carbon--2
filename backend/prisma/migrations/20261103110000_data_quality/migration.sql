-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "qualityAnomalyPercent" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "qualityMinHistory" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "DataQualityReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "findingKey" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataQualityReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataQualityReview_organizationId_findingKey_key" ON "DataQualityReview"("organizationId", "findingKey");

