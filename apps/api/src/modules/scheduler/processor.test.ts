/**
 * Testes do processador contra o PostgreSQL real (npm run db:local).
 * As integrações externas são substituídas por um publicador de teste: aqui validamos
 * a máquina de estados, as travas e as tentativas, não as APIs das redes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encrypt } from '../../lib/crypto.js';
import { PublishError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { publishers } from '../integrations/registry.js';
import type { Publisher } from '../integrations/types.js';
import { processTarget } from './processor.js';
import { findDueTargets } from './sweeper.js';

let userId: string;
let accountId: string;
let videoId: string;
const original = publishers.INSTAGRAM;
let calls = 0;

function usePublisher(step: Publisher['step']) {
  calls = 0;
  publishers.INSTAGRAM = {
    platform: 'INSTAGRAM',
    step: async (ctx) => {
      calls++;
      return step(ctx);
    },
  };
}

async function newTarget(nextAttemptAt = new Date(Date.now() - 1000)) {
  const post = await prisma.post.create({ data: { userId, videoId, scheduledAt: nextAttemptAt, status: 'SCHEDULED' } });
  return prisma.postTarget.create({
    data: { postId: post.id, accountId, platform: 'INSTAGRAM', caption: 'teste', hashtags: [], status: 'SCHEDULED', nextAttemptAt },
  });
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `test-${Date.now()}@sendvideo.test`, name: 'Teste', passwordHash: 'x' } });
  userId = user.id;
  const conn = await prisma.socialConnection.create({
    data: { userId, provider: 'META', externalUserId: 'u1', displayName: 'Teste', accessTokenEnc: encrypt('t'), scopes: [] },
  });
  const acc = await prisma.socialAccount.create({
    data: { userId, connectionId: conn.id, platform: 'INSTAGRAM', externalId: 'ig1', name: 'perfil', username: 'perfil', tokenEnc: encrypt('page') },
  });
  accountId = acc.id;
  const video = await prisma.video.create({
    data: { userId, title: 'v', originalName: 'v.mp4', storageKey: 'x', mimeType: 'video/mp4', sizeBytes: 10n, sha256: 'x' },
  });
  videoId = video.id;
});

beforeEach(() => {
  publishers.INSTAGRAM = original;
});

afterAll(async () => {
  publishers.INSTAGRAM = original;
  await prisma.post.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('processTarget', () => {
  it('publica, registra tentativa e atualiza o status da publicação', async () => {
    usePublisher(async () => ({ type: 'published', externalId: 'm1', permalink: 'https://instagram.com/p/x', state: {} }));
    const t = await newTarget();
    await processTarget(t.id);
    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: t.id }, include: { attempts: true, post: true } });
    expect(after.status).toBe('PUBLISHED');
    expect(after.externalId).toBe('m1');
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0].outcome).toBe('SUCCESS');
    expect(after.post.status).toBe('PUBLISHED');
  });

  it('não processa antes do horário', async () => {
    usePublisher(async () => ({ type: 'published', externalId: 'm', state: {} }));
    const t = await newTarget(new Date(Date.now() + 60_000));
    await processTarget(t.id);
    expect(calls).toBe(0);
    expect((await prisma.postTarget.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('SCHEDULED');
  });

  it('execuções concorrentes do mesmo destino publicam uma única vez', async () => {
    usePublisher(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { type: 'published', externalId: 'm2', state: {} };
    });
    const t = await newTarget();
    await Promise.all([processTarget(t.id), processTarget(t.id), processTarget(t.id), processTarget(t.id)]);
    expect(calls).toBe(1);
  });

  it('falha transitória agenda nova tentativa com backoff; esgotadas, vira FAILED', async () => {
    usePublisher(async () => {
      throw new PublishError('retry', 'network', 'rede caiu');
    });
    const t = await newTarget();
    await processTarget(t.id);
    let after = await prisma.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe('QUEUED');
    expect(after.attemptCount).toBe(1);
    expect(after.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 50_000);

    // Simula as tentativas seguintes chegando na hora
    for (let i = 2; i <= after.maxAttempts; i++) {
      await prisma.postTarget.update({ where: { id: t.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await processTarget(t.id);
    }
    const final = await prisma.postTarget.findUniqueOrThrow({ where: { id: t.id }, include: { attempts: true } });
    expect(final.status).toBe('FAILED');
    expect(final.attempts).toHaveLength(final.maxAttempts);
    expect(final.lastError).toContain('rede caiu');
  });

  it('erro que exige ação vira NEEDS_ACTION sem novas tentativas', async () => {
    usePublisher(async () => {
      throw new PublishError('action', 'perm', 'sem permissão');
    });
    const t = await newTarget();
    await processTarget(t.id);
    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe('NEEDS_ACTION');
    expect(after.nextAttemptAt).toBeNull();
  });

  it('etapas "continue" mantêm a mesma tentativa e retomam da fase salva', async () => {
    usePublisher(async (ctx) => {
      if (!ctx.phase) {
        await ctx.checkpoint('UPLOADING', { containerId: 'c1' });
        return { type: 'continue', phase: 'AWAITING_PROCESSING', state: { containerId: 'c1' }, delayMs: 0 };
      }
      expect(ctx.phase).toBe('AWAITING_PROCESSING');
      expect(ctx.state.containerId).toBe('c1');
      return { type: 'published', externalId: 'm3', state: ctx.state };
    });
    const t = await newTarget();
    await processTarget(t.id);
    let after = await prisma.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe('PROCESSING');
    expect(after.leaseUntil).toBeNull();
    await processTarget(t.id);
    const final = await prisma.postTarget.findUniqueOrThrow({ where: { id: t.id }, include: { attempts: true } });
    expect(final.status).toBe('PUBLISHED');
    expect(final.attemptCount).toBe(1);
    expect(final.attempts).toHaveLength(1);
  });

  it('destino cancelado nunca é processado e não aparece na varredura', async () => {
    usePublisher(async () => ({ type: 'published', externalId: 'x', state: {} }));
    const t = await newTarget();
    await prisma.postTarget.update({ where: { id: t.id }, data: { status: 'CANCELED' } });
    await processTarget(t.id);
    expect(calls).toBe(0);
    const due = await findDueTargets(1000);
    expect(due.some((d) => d.id === t.id)).toBe(false);
  });

  it('lease vencido (worker caiu) é recuperado como nova tentativa', async () => {
    usePublisher(async (ctx) => ({ type: 'published', externalId: `resume-${ctx.phase}`, state: {} }));
    const t = await newTarget();
    await prisma.postTarget.update({
      where: { id: t.id },
      data: { status: 'PROCESSING', phase: 'UPLOADING', leaseUntil: new Date(Date.now() - 1000), attemptCount: 1 },
    });
    await processTarget(t.id);
    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.externalId).toBe('resume-UPLOADING');
    expect(after.attemptCount).toBe(2);
  });
});
