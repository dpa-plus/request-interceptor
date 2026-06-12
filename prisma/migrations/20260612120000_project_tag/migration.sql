-- AlterTable
ALTER TABLE "RequestLog" ADD COLUMN "projectTag" TEXT;

-- CreateIndex
CREATE INDEX "RequestLog_projectTag_idx" ON "RequestLog"("projectTag");
