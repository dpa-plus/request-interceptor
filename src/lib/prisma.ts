import { PrismaClient } from '../generated/prisma/index.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Default AI model pricing (micro-dollars per 1M tokens)
const DEFAULT_PRICING = [
  { provider: 'openai', modelPattern: 'gpt-4o$', inputPricePerMillion: 2500000, outputPricePerMillion: 10000000 },
  { provider: 'openai', modelPattern: 'gpt-4o-mini', inputPricePerMillion: 150000, outputPricePerMillion: 600000 },
  { provider: 'openai', modelPattern: 'gpt-4-turbo', inputPricePerMillion: 10000000, outputPricePerMillion: 30000000 },
  { provider: 'openai', modelPattern: 'gpt-4$', inputPricePerMillion: 30000000, outputPricePerMillion: 60000000 },
  { provider: 'openai', modelPattern: 'gpt-3.5-turbo', inputPricePerMillion: 500000, outputPricePerMillion: 1500000 },
  { provider: 'anthropic', modelPattern: 'claude-3-opus', inputPricePerMillion: 15000000, outputPricePerMillion: 75000000 },
  { provider: 'anthropic', modelPattern: 'claude-3-sonnet', inputPricePerMillion: 3000000, outputPricePerMillion: 15000000 },
  { provider: 'anthropic', modelPattern: 'claude-3-haiku', inputPricePerMillion: 250000, outputPricePerMillion: 1250000 },
  { provider: 'anthropic', modelPattern: 'claude-3.5-sonnet', inputPricePerMillion: 3000000, outputPricePerMillion: 15000000 },
];

export async function initDatabase() {
  // Ensure default config exists
  const config = await prisma.config.findUnique({
    where: { id: 'default' },
  });

  if (!config) {
    await prisma.config.create({
      data: {
        id: 'default',
        defaultTargetUrl: process.env.TARGET_URL || null,
        logEnabled: true,
        maxBodySize: 1048576,
        aiDetectionEnabled: true,
      },
    });
    console.log('Created default config');
  }

  // Seed default AI model pricing
  for (const pricing of DEFAULT_PRICING) {
    await prisma.aiModelPricing.upsert({
      where: {
        provider_modelPattern: {
          provider: pricing.provider,
          modelPattern: pricing.modelPattern,
        },
      },
      update: {},
      create: pricing,
    });
  }
  console.log('Initialized AI model pricing');
}
