-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "model" TEXT,
    "isStreaming" BOOLEAN NOT NULL DEFAULT false,
    "systemPrompt" TEXT,
    "userMessages" TEXT,
    "assistantResponse" TEXT,
    "messages" TEXT,
    "hasToolCalls" BOOLEAN NOT NULL DEFAULT false,
    "toolCallCount" INTEGER,
    "toolNames" TEXT,
    "fullRequest" TEXT,
    "fullResponse" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "inputCostMicros" INTEGER,
    "outputCostMicros" INTEGER,
    "totalCostMicros" INTEGER,
    "timeToFirstToken" INTEGER,
    "totalDuration" INTEGER,
    "openrouterGenerationId" TEXT,
    "openrouterEnriched" BOOLEAN NOT NULL DEFAULT false,
    "openrouterEnrichedAt" DATETIME,
    "openrouterProviderName" TEXT,
    "openrouterUpstreamId" TEXT,
    "openrouterTotalCost" REAL,
    "openrouterCacheDiscount" REAL,
    "openrouterLatency" INTEGER,
    "openrouterGenerationTime" INTEGER,
    "openrouterModerationLatency" INTEGER,
    "openrouterNativeTokensPrompt" INTEGER,
    "openrouterNativeTokensCompletion" INTEGER,
    "openrouterNativeTokensReasoning" INTEGER,
    "openrouterNativeTokensCached" INTEGER,
    "openrouterFinishReason" TEXT,
    "openrouterIsByok" BOOLEAN,
    "openrouterRawResponse" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AiRequest" ("assistantResponse", "completionTokens", "createdAt", "endpoint", "fullRequest", "fullResponse", "id", "inputCostMicros", "isStreaming", "model", "openrouterCacheDiscount", "openrouterEnriched", "openrouterEnrichedAt", "openrouterFinishReason", "openrouterGenerationId", "openrouterGenerationTime", "openrouterIsByok", "openrouterLatency", "openrouterModerationLatency", "openrouterNativeTokensCached", "openrouterNativeTokensCompletion", "openrouterNativeTokensPrompt", "openrouterNativeTokensReasoning", "openrouterProviderName", "openrouterRawResponse", "openrouterTotalCost", "openrouterUpstreamId", "outputCostMicros", "promptTokens", "provider", "systemPrompt", "timeToFirstToken", "totalCostMicros", "totalDuration", "totalTokens", "userMessages") SELECT "assistantResponse", "completionTokens", "createdAt", "endpoint", "fullRequest", "fullResponse", "id", "inputCostMicros", "isStreaming", "model", "openrouterCacheDiscount", "openrouterEnriched", "openrouterEnrichedAt", "openrouterFinishReason", "openrouterGenerationId", "openrouterGenerationTime", "openrouterIsByok", "openrouterLatency", "openrouterModerationLatency", "openrouterNativeTokensCached", "openrouterNativeTokensCompletion", "openrouterNativeTokensPrompt", "openrouterNativeTokensReasoning", "openrouterProviderName", "openrouterRawResponse", "openrouterTotalCost", "openrouterUpstreamId", "outputCostMicros", "promptTokens", "provider", "systemPrompt", "timeToFirstToken", "totalCostMicros", "totalDuration", "totalTokens", "userMessages" FROM "AiRequest";
DROP TABLE "AiRequest";
ALTER TABLE "new_AiRequest" RENAME TO "AiRequest";
CREATE INDEX "AiRequest_provider_idx" ON "AiRequest"("provider");
CREATE INDEX "AiRequest_model_idx" ON "AiRequest"("model");
CREATE INDEX "AiRequest_createdAt_idx" ON "AiRequest"("createdAt");
CREATE INDEX "AiRequest_openrouterGenerationId_idx" ON "AiRequest"("openrouterGenerationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
