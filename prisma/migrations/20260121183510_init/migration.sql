-- CreateTable
CREATE TABLE "RequestLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "queryParams" TEXT,
    "headers" TEXT NOT NULL,
    "body" TEXT,
    "bodyTruncated" BOOLEAN NOT NULL DEFAULT false,
    "bodySize" INTEGER NOT NULL DEFAULT 0,
    "statusCode" INTEGER,
    "responseHeaders" TEXT,
    "responseBody" TEXT,
    "responseTruncated" BOOLEAN NOT NULL DEFAULT false,
    "responseSize" INTEGER NOT NULL DEFAULT 0,
    "responseTime" INTEGER,
    "targetUrl" TEXT NOT NULL,
    "routeSource" TEXT NOT NULL,
    "routeRuleId" TEXT,
    "isAiRequest" BOOLEAN NOT NULL DEFAULT false,
    "aiRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    CONSTRAINT "RequestLog_aiRequestId_fkey" FOREIGN KEY ("aiRequestId") REFERENCES "AiRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "model" TEXT,
    "isStreaming" BOOLEAN NOT NULL DEFAULT false,
    "systemPrompt" TEXT,
    "userMessages" TEXT,
    "assistantResponse" TEXT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RoutingRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "matchType" TEXT NOT NULL,
    "matchPattern" TEXT NOT NULL,
    "matchHeader" TEXT,
    "targetUrl" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Config" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "defaultTargetUrl" TEXT,
    "logEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maxBodySize" INTEGER NOT NULL DEFAULT 1048576,
    "aiDetectionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiModelPricing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "modelPattern" TEXT NOT NULL,
    "inputPricePerMillion" INTEGER NOT NULL,
    "outputPricePerMillion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "RequestLog_aiRequestId_key" ON "RequestLog"("aiRequestId");

-- CreateIndex
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_method_idx" ON "RequestLog"("method");

-- CreateIndex
CREATE INDEX "RequestLog_isAiRequest_idx" ON "RequestLog"("isAiRequest");

-- CreateIndex
CREATE INDEX "RequestLog_targetUrl_idx" ON "RequestLog"("targetUrl");

-- CreateIndex
CREATE INDEX "AiRequest_provider_idx" ON "AiRequest"("provider");

-- CreateIndex
CREATE INDEX "AiRequest_model_idx" ON "AiRequest"("model");

-- CreateIndex
CREATE INDEX "AiRequest_createdAt_idx" ON "AiRequest"("createdAt");

-- CreateIndex
CREATE INDEX "RoutingRule_enabled_priority_idx" ON "RoutingRule"("enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "AiModelPricing_provider_modelPattern_key" ON "AiModelPricing"("provider", "modelPattern");
