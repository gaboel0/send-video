import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  API_PORT: z.coerce.number().default(4000),
  APP_TIMEZONE: z.string().default('America/Sao_Paulo'),
  ALLOW_SIGNUP: bool,

  TOKEN_ENCRYPTION_KEY: z
    .string({ error: 'TOKEN_ENCRYPTION_KEY é obrigatória (32 bytes em base64)' })
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'TOKEN_ENCRYPTION_KEY precisa ter 32 bytes em base64'),
  SESSION_COOKIE_NAME: z.string().default('sendvideo_session'),
  SESSION_TTL_DAYS: z.coerce.number().default(30),

  DATABASE_URL: z.string({ error: 'DATABASE_URL é obrigatória' }),

  QUEUE_DRIVER: z.enum(['bullmq', 'pg']).default('bullmq'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: optional,
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_FORCE_PATH_STYLE: bool,
  MAX_UPLOAD_MB: z.coerce.number().default(1024),

  TIKTOK_CLIENT_KEY: optional,
  TIKTOK_CLIENT_SECRET: optional,
  TIKTOK_REDIRECT_URI: optional,
  TIKTOK_POST_MODE: z.enum(['direct', 'inbox']).default('direct'),

  META_APP_ID: optional,
  META_APP_SECRET: optional,
  META_REDIRECT_URI: optional,
  META_GRAPH_VERSION: z.string().default('v24.0'),
  META_LOGIN_CONFIG_ID: optional,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('\n✖ Configuração inválida no .env:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nVeja .env.example para a lista completa.\n');
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

export const integrationStatus = () => ({
  tiktok: {
    configured: Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET && env.TIKTOK_REDIRECT_URI),
    missing: [
      !env.TIKTOK_CLIENT_KEY && 'TIKTOK_CLIENT_KEY',
      !env.TIKTOK_CLIENT_SECRET && 'TIKTOK_CLIENT_SECRET',
      !env.TIKTOK_REDIRECT_URI && 'TIKTOK_REDIRECT_URI',
    ].filter(Boolean) as string[],
    postMode: env.TIKTOK_POST_MODE,
  },
  meta: {
    configured: Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_REDIRECT_URI),
    missing: [
      !env.META_APP_ID && 'META_APP_ID',
      !env.META_APP_SECRET && 'META_APP_SECRET',
      !env.META_REDIRECT_URI && 'META_REDIRECT_URI',
    ].filter(Boolean) as string[],
    graphVersion: env.META_GRAPH_VERSION,
  },
});
