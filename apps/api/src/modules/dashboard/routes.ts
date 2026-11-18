import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { addDays, startOfZonedWeek, zonedDayKey } from '../../lib/time.js';
import { requireAuth, userOf } from '../auth/session.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/dashboard', async (req) => {
    const user = userOf(req);
    const now = new Date();
    const weekStart = startOfZonedWeek(now);
    const weekEnd = addDays(weekStart, 7);

    const [videos, targetGroups, upcoming, connections, weekTargets, recent, nextTarget] = await Promise.all([
      prisma.video.count({ where: { userId: user.id, deletedAt: null } }),
      prisma.postTarget.groupBy({ by: ['status'], where: { post: { userId: user.id } }, _count: true }),
      prisma.post.findMany({
        where: { userId: user.id, status: { in: ['SCHEDULED', 'QUEUED', 'PROCESSING'] }, scheduledAt: { not: null } },
        orderBy: { scheduledAt: 'asc' },
        take: 6,
        include: {
          video: { select: { id: true, title: true, thumbnailKey: true, updatedAt: true, durationSec: true } },
          targets: { select: { id: true, platform: true, status: true, account: { select: { name: true, username: true } } } },
        },
      }),
      prisma.socialAccount.findMany({
        where: { userId: user.id, status: { not: 'REVOKED' } },
        select: { id: true, platform: true, name: true, username: true, avatarUrl: true, status: true },
        orderBy: { platform: 'asc' },
      }),
      prisma.postTarget.findMany({
        where: { post: { userId: user.id, scheduledAt: { gte: weekStart, lt: weekEnd } }, status: { not: 'CANCELED' } },
        select: { status: true, platform: true, post: { select: { scheduledAt: true } } },
      }),
      prisma.activityLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 12 }),
      prisma.postTarget.findFirst({
        where: { post: { userId: user.id }, status: 'SCHEDULED', nextAttemptAt: { gte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        select: { nextAttemptAt: true },
      }),
    ]);

    const count = (s: string) => targetGroups.find((g) => g.status === s)?._count ?? 0;

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i);
      return { date: zonedDayKey(d), total: 0, published: 0, failed: 0, pending: 0, platforms: { TIKTOK: 0, INSTAGRAM: 0, FACEBOOK: 0 } };
    });
    for (const t of weekTargets) {
      const key = zonedDayKey(t.post.scheduledAt!);
      const day = days.find((d) => d.date === key);
      if (!day) continue;
      day.total++;
      day.platforms[t.platform]++;
      if (t.status === 'PUBLISHED') day.published++;
      else if (t.status === 'FAILED' || t.status === 'NEEDS_ACTION') day.failed++;
      else if (t.status !== 'DRAFT') day.pending++;
    }

    return {
      stats: {
        videos,
        scheduled: count('SCHEDULED') + count('QUEUED') + count('PROCESSING'),
        published: count('PUBLISHED'),
        failed: count('FAILED'),
        needsAction: count('NEEDS_ACTION'),
        drafts: count('DRAFT'),
      },
      nextAt: nextTarget?.nextAttemptAt ?? null,
      upcoming: upcoming.map((p) => ({
        id: p.id,
        title: p.title || p.video.title,
        scheduledAt: p.scheduledAt,
        status: p.status,
        thumbnailUrl: p.video.thumbnailKey ? `/api/videos/${p.video.id}/thumbnail?v=${p.video.updatedAt.getTime()}` : null,
        durationSec: p.video.durationSec,
        targets: p.targets,
      })),
      accounts: connections,
      week: { start: zonedDayKey(weekStart), days },
      activity: recent,
    };
  });

  app.get('/api/activity', async (req) => {
    const user = userOf(req);
    const q = z.object({ limit: z.coerce.number().min(1).max(200).default(50), before: z.coerce.date().optional() }).parse(req.query);
    return prisma.activityLog.findMany({
      where: { userId: user.id, ...(q.before ? { createdAt: { lt: q.before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
  });
}
