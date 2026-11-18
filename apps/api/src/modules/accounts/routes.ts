import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env, integrationStatus } from '../../config/env.js';
import { decrypt, randomToken } from '../../lib/crypto.js';
import { HttpError, notFound, PublishError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { logActivity } from '../activity/activity.js';
import { requireAuth, userOf } from '../auth/session.js';
import * as meta from '../integrations/meta/api.js';
import * as tiktok from '../integrations/tiktok/api.js';
import { getConnectionToken } from '../integrations/tokens.js';
import { saveMetaConnection, saveTikTokConnection, syncMetaAccounts, syncTikTokAccount } from './connect.js';

const providerParam = z.object({ provider: z.enum(['tiktok', 'meta']) });

export async function accountRoutes(app: FastifyInstance) {
  // ── OAuth ──────────────────────────────────────────────────
  app.get('/api/oauth/:provider/start', { preHandler: requireAuth }, async (req, reply) => {
    const { provider } = providerParam.parse(req.params);
    const { reconnect } = z.object({ reconnect: z.string().optional() }).parse(req.query);
    const user = userOf(req);
    const state = randomToken(24);
    const url = provider === 'tiktok' ? tiktok.buildAuthorizeUrl(state) : meta.buildAuthorizeUrl(state);
    await prisma.oAuthState.create({
      data: {
        state,
        userId: user.id,
        provider: provider === 'tiktok' ? 'TIKTOK' : 'META',
        reconnectId: reconnect ?? null,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    return reply.redirect(url);
  });

  app.get('/api/oauth/:provider/callback', async (req, reply) => {
    const { provider } = providerParam.parse(req.params);
    const q = z
      .object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional(), error_description: z.string().optional(), error_reason: z.string().optional() })
      .parse(req.query);
    const back = (params: Record<string, string>) => reply.redirect(`${env.PUBLIC_URL}/contas?${new URLSearchParams(params)}`);

    if (!q.state) return back({ error: 'Resposta OAuth sem state' });
    const saved = await prisma.oAuthState.findUnique({ where: { state: q.state } });
    if (saved) await prisma.oAuthState.delete({ where: { id: saved.id } });
    if (!saved || saved.expiresAt < new Date() || saved.provider !== (provider === 'tiktok' ? 'TIKTOK' : 'META')) {
      return back({ error: 'Sessão de conexão expirada ou inválida. Tente novamente.' });
    }
    // O cookie de sessão precisa pertencer ao mesmo usuário que iniciou o fluxo
    if (req.user && req.user.id !== saved.userId) return back({ error: 'Usuário da sessão não confere.' });
    if (q.error || !q.code) {
      const reason = q.error_description ?? q.error_reason ?? q.error ?? 'Autorização cancelada';
      return back({ error: reason });
    }

    try {
      if (provider === 'tiktok') {
        const token = await tiktok.exchangeCode(q.code, saved.userId);
        const conn = await saveTikTokConnection(saved.userId, token);
        await logActivity({ userId: saved.userId, type: 'account.connected', level: 'SUCCESS', message: `TikTok conectado: ${conn.displayName}` });
        const missing = ['video.publish', 'video.upload'].filter((s) => !conn.scopes.includes(s));
        return back({ connected: 'tiktok', ...(missing.length ? { warning: `Permissões não concedidas: ${missing.join(', ')}` } : {}) });
      }
      const token = await meta.exchangeCode(q.code, saved.userId);
      const conn = await saveMetaConnection(saved.userId, token);
      const accounts = await prisma.socialAccount.count({ where: { connectionId: conn.id, status: 'ACTIVE' } });
      await logActivity({ userId: saved.userId, type: 'account.connected', level: 'SUCCESS', message: `Meta conectada: ${conn.displayName} (${accounts} conta(s))` });
      const missing = ['pages_manage_posts', 'instagram_content_publish'].filter((s) => !conn.scopes.includes(s));
      return back({
        connected: 'meta',
        ...(accounts === 0 ? { warning: 'Nenhuma página do Facebook foi autorizada. Reconecte e selecione suas páginas e contas do Instagram.' } : {}),
        ...(missing.length ? { warning: `Permissões não concedidas: ${missing.join(', ')}` } : {}),
      });
    } catch (err) {
      req.log.error({ err }, 'oauth callback falhou');
      const message = err instanceof PublishError || err instanceof HttpError ? err.message : 'Falha ao concluir a conexão';
      return back({ error: message });
    }
  });

  // ── Contas ─────────────────────────────────────────────────
  app.get('/api/integrations/status', { preHandler: requireAuth }, async () => integrationStatus());

  app.get('/api/accounts', { preHandler: requireAuth }, async (req) => {
    const user = userOf(req);
    const connections = await prisma.socialConnection.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      include: { accounts: { orderBy: [{ platform: 'asc' }, { name: 'asc' }] } },
    });
    // Nunca devolve tokens
    return connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      displayName: c.displayName,
      avatarUrl: c.avatarUrl,
      status: c.status,
      scopes: c.scopes,
      lastError: c.lastError,
      lastSyncedAt: c.lastSyncedAt,
      accessTokenExpiresAt: c.accessTokenExpiresAt,
      refreshTokenExpiresAt: c.refreshTokenExpiresAt,
      createdAt: c.createdAt,
      accounts: c.accounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        externalId: a.externalId,
        name: a.name,
        username: a.username,
        avatarUrl: a.avatarUrl,
        status: a.status,
        enabled: a.enabled,
        lastSyncedAt: a.lastSyncedAt,
        metadata: a.metadata,
      })),
    }));
  });

  app.post('/api/connections/:id/sync', { preHandler: requireAuth }, async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const conn = await prisma.socialConnection.findFirst({ where: { id, userId: user.id } });
    if (!conn) throw notFound('Conexão não encontrada');
    try {
      if (conn.provider === 'TIKTOK') {
        const token = await getConnectionToken(conn);
        const fresh = await prisma.socialConnection.findUniqueOrThrow({ where: { id } });
        await syncTikTokAccount(fresh, token);
      } else {
        await syncMetaAccounts(conn);
      }
    } catch (err) {
      if (err instanceof PublishError) {
        await prisma.socialConnection.update({ where: { id }, data: { lastError: err.message } });
        throw new HttpError(err.kind === 'retry' ? 502 : 409, err.message, err.code);
      }
      throw err;
    }
    return { ok: true };
  });

  app.delete('/api/connections/:id', { preHandler: requireAuth }, async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const conn = await prisma.socialConnection.findFirst({ where: { id, userId: user.id }, include: { accounts: true } });
    if (!conn) throw notFound('Conexão não encontrada');

    // Revoga na plataforma (melhor esforço)
    try {
      const token = decrypt(conn.accessTokenEnc);
      if (token) {
        if (conn.provider === 'TIKTOK') await tiktok.revokeToken(token, user.id);
        else await meta.revokeAppAccess(token, user.id);
      }
    } catch {
      /* segue com a desconexão local */
    }

    const accountIds = conn.accounts.map((a) => a.id);
    const pending = await prisma.postTarget.updateMany({
      where: { accountId: { in: accountIds }, status: { in: ['SCHEDULED', 'QUEUED'] } },
      data: {
        status: 'NEEDS_ACTION',
        nextAttemptAt: null,
        lastErrorCode: 'account_disconnected',
        lastError: 'A conta foi desconectada. Reconecte ou remova este destino.',
      },
    });
    await prisma.$transaction([
      prisma.socialConnection.update({
        where: { id },
        data: { status: 'REVOKED', accessTokenEnc: '', refreshTokenEnc: null, lastError: 'Desconectada pelo usuário' },
      }),
      prisma.socialAccount.updateMany({ where: { connectionId: id }, data: { status: 'REVOKED', tokenEnc: null } }),
    ]);
    // Contas sem histórico de publicação podem ser removidas por completo
    await prisma.socialAccount.deleteMany({ where: { connectionId: id, targets: { none: {} } } });
    const remaining = await prisma.socialAccount.count({ where: { connectionId: id } });
    if (remaining === 0) await prisma.socialConnection.delete({ where: { id } });

    await logActivity({ userId: user.id, type: 'account.disconnected', level: 'WARNING', message: `${conn.provider === 'TIKTOK' ? 'TikTok' : 'Meta'} desconectado: ${conn.displayName}` });
    return { ok: true, affectedTargets: pending.count };
  });

  app.patch('/api/accounts/:id', { preHandler: requireAuth }, async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    const acc = await prisma.socialAccount.findFirst({ where: { id, userId: user.id } });
    if (!acc) throw notFound('Conta não encontrada');
    await prisma.socialAccount.update({ where: { id }, data: { enabled: body.enabled } });
    return { ok: true };
  });

  app.get('/api/integration-logs', { preHandler: requireAuth }, async (req) => {
    const user = userOf(req);
    const { limit } = z.object({ limit: z.coerce.number().min(1).max(200).default(50) }).parse(req.query);
    return prisma.integrationLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: limit });
  });
}
