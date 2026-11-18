import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { env, isProd } from './config/env.js';
import { HttpError } from './lib/errors.js';
import { accountRoutes } from './modules/accounts/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { loadUser } from './modules/auth/session.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { postRoutes } from './modules/posts/routes.js';
import { folderRoutes } from './modules/videos/folders.routes.js';
import { videoRoutes } from './modules/videos/routes.js';

export async function buildApp() {
  const app = Fastify({
    trustProxy: true,
    logger: isProd
      ? { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] }
      : { level: 'info', transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    bodyLimit: 1024 * 1024,
  });

  // JSON tolerante a corpo vazio (ex.: POST de ação sem payload)
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (body as string).trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(new HttpError(400, 'JSON inválido', 'invalid_json'), undefined);
    }
  });

  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(multipart);

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/')) req.user = await loadUser(req);
  });

  // Proteção CSRF: requisições que alteram dados precisam vir da própria aplicação
  const allowedOrigin = new URL(env.PUBLIC_URL).origin;
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && origin !== allowedOrigin && !(!isProd && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
      throw new HttpError(403, 'Origem não permitida', 'bad_origin');
    }
  });

  // Respostas da API nunca ficam em cache intermediário; cabeçalhos básicos de segurança
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', message: err.issues[0]?.message ?? 'Dados inválidos', issues: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'erro não tratado');
    return reply.code(status).send({
      error: (err as FastifyError).code ?? 'internal_error',
      message: status >= 500 ? 'Erro interno. Tente novamente.' : err.message,
    });
  });

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString(), queue: env.QUEUE_DRIVER }));

  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(videoRoutes);
  await app.register(folderRoutes);
  await app.register(postRoutes);
  await app.register(dashboardRoutes);

  // Em produção a API também serve o frontend compilado (mesmo domínio → cookies e OAuth simples)
  const webDist = path.resolve(import.meta.dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found', message: 'Rota não encontrada' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
