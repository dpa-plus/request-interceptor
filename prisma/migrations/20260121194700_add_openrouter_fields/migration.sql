-- Add OpenRouter-specific fields to AiRequest table
ALTER TABLE "AiRequest" ADD COLUMN "openrouterGenerationId" TEXT;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterEnriched" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterEnrichedAt" DATETIME;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterProviderName" TEXT;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterUpstreamId" TEXT;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterTotalCost" REAL;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterCacheDiscount" REAL;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterLatency" INTEGER;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterGenerationTime" INTEGER;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterModerationLatency" INTEGER;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterNativeTokensPrompt" INTEGER;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterNativeTokensCompletion" INTEGER;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterNativeTokensReasoning" INTEGER;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterNativeTokensCached" INTEGER;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterFinishReason" TEXT;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterIsByok" BOOLEAN;
ALTER TABLE "AiRequest" ADD COLUMN "openrouterRawResponse" TEXT;

-- Create index for openrouterGenerationId
CREATE INDEX "AiRequest_openrouterGenerationId_idx" ON "AiRequest"("openrouterGenerationId");
