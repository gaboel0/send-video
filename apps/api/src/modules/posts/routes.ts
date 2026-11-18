import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { requireAuth, userOf } from '../auth/session.js';
import { PLATFORM_RULES } from '../integrations/validation.js';
import { serializeVideo } from '../videos/routes.js';
import { cancelPost, deletePost, markPublished, postInput, reschedulePost, retryTarget, savePost, validatePost } from './service.js';

const STATUSES = ['DRAFT', 'SCHEDULED', 'QUEUED', 'PROCESSING', 'PUBLISHED', 'FAILED', 'NEEDS_ACTION', 'CANCELED'] as const;

const listInclude = {
  video: { include: { folder: true } },
  targets: {
    orderBy: { platform: 'asc' },
    include: { account: { select: { id: true, name: true, username: true, avatarUrl: true, platform: true, status: true } } },
  },
} satisfies Prisma.PostInclude;

type PostWithList = Prisma.PostGetPayload<{ include: typeof listInclude }>;

export function serializePost(p: PostWithList) {
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    scheduledAt: p.scheduledAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    video: serializeVideo({ ...p.video, posts: [] }),
    targets: p.targets.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      platform: t.platform,
      caption: t.caption,
      hashtags: t.hashtags,
      options: t.options,
      status: t.status,
      attemptCount: t.attemptCount,
      maxAttempts: t.maxAttempts,
      nextAttemptAt: t.nextAttemptAt,
      phase: t.phase,
      externalId: t.externalId,
      permalink: t.permalink,
      lastError: t.lastError,
      lastErrorCode: t.lastErrorCode,
      publishedAt: t.publishedAt,
      account: t.account,
    })),
  };
}

export async function postRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/platform-rules', async () => PLATFORM_RULES);

  app.get('/api/posts', async (req) => {
    const user = userOf(req);
    const q = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        status: z.string().optional(),
        platform: z.enum(['TIKTOK', 'INSTAGRAM', 'FACEBOOK']).optional(),
        videoId: z.string().optional(),
        unscheduled: z.coerce.boolean().optional(),
        limit: z.coerce.number().min(1).max(1000).default(500),
      })
      .parse(req.query);
    const statuses = q.status?.split(',').filter((s): s is (typeof STATUSES)[number] => (STATUSES as readonly string[]).includes(s));
    const where: Prisma.PostWhereInput = {
      userId: user.id,
      ...(q.from || q.to ? { scheduledAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
      ...(q.unscheduled ? { scheduledAt: null } : {}),
      ...(statuses?.length ? { status: { in: statuses } } : {}),
      ...(q.platform ? { targets: { some: { platform: q.platform } } } : {}),
      ...(q.videoId ? { videoId: q.videoId } : {}),
    };
    const posts = await prisma.post.findMany({
      where,
      include: listInclude,
      orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: q.limit,
    });
    return posts.map(serializePost);
  });

  app.get('/api/posts/:id', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const post = await prisma.post.findFirst({ where: { id, userId: user.id }, include: listInclude });
    if (!post) throw notFound('Publicação não encontrada');
    const attempts = await prisma.publishAttempt.findMany({
      where: { target: { postId: id } },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    const activity = await prisma.activityLog.findMany({ where: { postId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { ...serializePost(post), attempts, activity };
  });

  app.post('/api/posts/validate', async (req) => {
    const user = userOf(req);
    const input = postInput.parse(req.body);
    const v = await validatePost(user.id, input);
    return { issues: v.issues, general: v.general, hasErrors: v.hasErrors };
  });

  app.post('/api/posts', async (req) => {
    const user = userOf(req);
    return savePost(user.id, null, postInput.parse(req.body));
  });

  app.put('/api/posts/:id', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return savePost(user.id, id, postInput.parse(req.body));
  });

  app.patch('/api/posts/:id/schedule', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { scheduledAt } = z.object({ scheduledAt: z.coerce.date() }).parse(req.body);
    await reschedulePost(user.id, id, scheduledAt);
    return { ok: true };
  });

  app.post('/api/posts/:id/cancel', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return cancelPost(user.id, id);
  });

  app.delete('/api/posts/:id', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await deletePost(user.id, id);
    return { ok: true };
  });

  app.post('/api/targets/:id/retry', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await retryTarget(user.id, id);
    return { ok: true };
  });

  app.post('/api/targets/:id/mark-published', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { permalink } = z.object({ permalink: z.string().url().optional() }).parse(req.body ?? {});
    await markPublished(user.id, id, permalink);
    return { ok: true };
  });
}
