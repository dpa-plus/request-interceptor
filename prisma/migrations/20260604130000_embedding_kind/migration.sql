-- AlterTable
ALTER TABLE "AiRequest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE "AiRequest" ADD COLUMN "embeddingInputCount" INTEGER;
ALTER TABLE "AiRequest" ADD COLUMN "embeddingDimensions" INTEGER;

-- CreateIndex
CREATE INDEX "AiRequest_kind_idx" ON "AiRequest"("kind");
