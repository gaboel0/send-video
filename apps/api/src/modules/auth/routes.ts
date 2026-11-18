import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { hashPassword, verifyPassword } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { createSession, destroySession } from './session.js';

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres').max(200),
});

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/api/auth/me', async (req) => ({ user: req.user }));

  app.get('/api/auth/status', async () => {
    const users = await prisma.user.count();
    return { needsSetup: users === 0, signupAllowed: users === 0 || env.ALLOW_SIGNUP };
  });

  app.post('/api/auth/register', strict, async (req, reply) => {
    const body = credentials.extend({ name: z.string().trim().min(1, 'Informe seu nome').max(80) }).parse(req.body);
    const users = await prisma.user.count();
    if (users > 0 && !env.ALLOW_SIGNUP) throw new HttpError(403, 'Cadastro desativado. Peça acesso ao administrador.', 'signup_disabled');
    if (await prisma.user.findUnique({ where: { email: body.email } })) throw new HttpError(409, 'Este e-mail já está cadastrado', 'email_taken');
    const user = await prisma.user.create({
      data: { email: body.email, name: body.name, passwordHash: await hashPassword(body.password) },
      select: { id: true, email: true, name: true },
    });
    await createSession(reply, req, user.id);
    return { user };
  });

  app.post('/api/auth/login', strict, async (req, reply) => {
    const body = credentials.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    // Sempre roda a verificação para não revelar se o e-mail existe pelo tempo de resposta
    const ok = await verifyPassword(body.password, user?.passwordHash ?? 'scrypt$16384$8$1$AAAA$AAAA');
    if (!user || !ok) throw new HttpError(401, 'E-mail ou senha incorretos', 'invalid_credentials');
    await createSession(reply, req, user.id);
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return { ok: true };
  });
}
