import { config } from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    env: { QUEUE_DRIVER: 'pg' },
  },
});
