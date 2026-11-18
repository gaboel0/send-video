import type { FastifyReply, FastifyRequest } from 'fastify';
import { env, isProd } from '../../config/env.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

const TTL_MS = () => env.SESSION_TTL_DAYS * 86_400_000;

export async function createSession(reply: FastifyReply, req: FastifyRequest, userId: string) {
  const token = randomToken(32);
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt: new Date(Date.now() + TTL_MS()),
      userAgent: req.headers['user-agent']?.slice(0, 300),
      ip: req.ip,
    },
  });
  reply.setCookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: TTL_MS() / 1000,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[env.SESSION_COOKIE_NAME];
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
}

export async function loadUser(req: FastifyRequest): Promise<AuthUser | null> {
  const token = req.cookies[env.SESSION_COOKIE_NAME];
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  // renova "lastSeen" no máximo 1x por hora
  if (Date.now() - session.lastSeenAt.getTime() > 3600_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return session.user;
}

export async function requireAuth(req: FastifyRequest) {
  if (!req.user) throw new HttpError(401, 'Faça login para continuar', 'unauthorized');
}

export const userOf = (req: FastifyRequest) => {
  if (!req.user) throw new HttpError(401, 'Faça login para continuar', 'unauthorized');
  return req.user;
};
