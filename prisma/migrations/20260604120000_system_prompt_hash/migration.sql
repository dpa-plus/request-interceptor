-- AlterTable
ALTER TABLE "AiRequest" ADD COLUMN "systemPromptHash" TEXT;

-- CreateIndex
CREATE INDEX "AiRequest_systemPromptHash_idx" ON "AiRequest"("systemPromptHash");
