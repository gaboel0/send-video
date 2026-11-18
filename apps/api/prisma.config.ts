import { config } from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` (no build) não acessa o banco; só migrate/deploy precisam da URL real.
  // O valor de reserva evita que o build falhe em CI/Vercel/Docker sem DATABASE_URL.
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://build:build@localhost:5432/build' },
});
