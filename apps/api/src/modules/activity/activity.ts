import { prisma, type LogLevel, type PublishStatus } from '../../lib/prisma.js';

export async function logActivity(entry: {
  userId: string;
  type: string;
  message: string;
  level?: LogLevel;
  postId?: string | null;
  targetId?: string | null;
}) {
  await prisma.activityLog.create({
    data: {
      userId: entry.userId,
      type: entry.type,
      message: entry.message,
      level: entry.level ?? 'INFO',
      postId: entry.postId ?? null,
      targetId: entry.targetId ?? null,
    },
  });
}

/** Status agregado da publicação a partir dos destinos */
export function aggregateStatus(statuses: PublishStatus[]): PublishStatus {
  if (statuses.length === 0) return 'DRAFT';
  const has = (s: PublishStatus) => statuses.includes(s);
  const active = statuses.filter((s) => s !== 'CANCELED');
  if (active.length === 0) return 'CANCELED';
  if (active.every((s) => s === 'PUBLISHED')) return 'PUBLISHED';
  if (has('PROCESSING')) return 'PROCESSING';
  if (has('QUEUED')) return 'QUEUED';
  if (has('NEEDS_ACTION')) return 'NEEDS_ACTION';
  if (has('FAILED')) return 'FAILED';
  if (has('SCHEDULED')) return 'SCHEDULED';
  if (active.every((s) => s === 'DRAFT')) return 'DRAFT';
  return active.find((s) => s !== 'PUBLISHED') ?? 'PUBLISHED';
}

export async function refreshPostStatus(postId: string) {
  const targets = await prisma.postTarget.findMany({ where: { postId }, select: { status: true } });
  const status = aggregateStatus(targets.map((t) => t.status));
  await prisma.post.update({ where: { id: postId }, data: { status } });
  return status;
}

export const PLATFORM_LABEL = { TIKTOK: 'TikTok', INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook' } as const;
