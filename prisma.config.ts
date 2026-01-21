import path from 'path';
import { defineConfig } from 'prisma/config';
import { config } from 'dotenv';

// Load .env file
config();

export default defineConfig({
  earlyAccess: true,
  schema: path.join(import.meta.dirname, 'prisma', 'schema.prisma'),
});
