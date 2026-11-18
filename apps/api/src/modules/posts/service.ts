import { z } from 'zod';
import { badRequest, conflict, HttpError, notFound } from '../../lib/errors.js';
import { Prisma, prisma, type PublishStatus } from '../../lib/prisma.js';
import { logActivity, PLATFORM_LABEL, refreshPostStatus } from '../activity/activity.js';
import { validateTarget, type Issue } from '../integrations/validation.js';
import { safeNotify } from '../scheduler/dispatcher.js';

/** Destinos nesses estados já saíram do nosso controle e não podem ser editados */
export const LOCKED: PublishStatus[] = ['PROCESSING', 'PUBLISHED'];
const MIN_LEAD_MS = 60_000;

export const targetInput = z.object({
  accountId: z.string(),
  caption: z.string().max(70000).default(''),
  hashtags: z
    .array(z.string().trim().max(150))
    .max(60)
    .default([])
    .transform((tags) => [...new Set(tags.map((t) => t.replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean))]),
  options: z.record(z.string(), z.any()).default({}),
});

export const postInput = z.object({
  videoId: z.string(),
  title: z.string().trim().max(200).default(''),
  scheduledAt: z.coerce.date().nullable().optional(),
  action: z.enum(['draft', 'schedule', 'publish_now']),
  targets: z.array(targetInput).max(30),
});

export type PostInput = z.infer<typeof postInput>;

const fmt = (d: Date) =>
  d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Valida todos os destinos contra as regras das plataformas */
export async function validatePost(userId: string, input: PostInput) {
  const video = await prisma.video.findFirst({ where: { id: input.videoId, userId, deletedAt: null } });
  if (!video) throw notFound('Vídeo não encontrado');
  const accounts = await prisma.socialAccount.findMany({
    where: { userId, id: { in: input.targets.map((t) => t.accountId) } },
    include: { connection: { select: { scopes: true } } },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const issues: Record<string, Issue[]> = {};
  const general: Issue[] = [];

  for (const t of input.targets) {
    const acc = byId.get(t.accountId);
    if (!acc) {
      general.push({ level: 'error', message: 'Conta de destino não encontrada' });
      continue;
    }
    issues[t.accountId] = validateTarget({ platform: acc.platform, caption: t.caption, hashtags: t.hashtags, options: t.options }, video, acc);
  }
  if (input.action !== 'draft' && input.targets.length === 0) general.push({ level: 'error', message: 'Selecione pelo menos uma conta' });
  if (input.action === 'schedule') {
    if (!input.scheduledAt) general.push({ level: 'error', field: 'scheduledAt', message: 'Escolha data e horário' });
    else if (input.scheduledAt.getTime() < Date.now() + MIN_LEAD_MS) {
      general.push({ level: 'error', field: 'scheduledAt', message: 'O horário precisa estar pelo menos 1 minuto no futuro' });
    }
  }
  const hasErrors = general.some((i) => i.level === 'error') || Object.values(issues).some((l) => l.some((i) => i.level === 'error'));
  return { video, accounts: byId, issues, general, hasErrors };
}

export async function savePost(userId: string, postId: string | null, input: PostInput) {
  const v = await validatePost(userId, input);
  if (input.action !== 'draft' && v.hasErrors) {
    throw new HttpError(422, 'Corrija os itens destacados antes de agendar', 'validation_failed', { issues: v.issues, general: v.general });
  }
  if (input.action === 'draft' && v.general.some((i) => i.message === 'Conta de destino não encontrada')) {
    throw badRequest('Conta de destino não encontrada');
  }

  const existing = postId
    ? await prisma.post.findFirst({ where: { id: postId, userId }, include: { targets: true } })
    : null;
  if (postId && !existing) throw notFound('Publicação não encontrada');

  const now = new Date();
  const scheduledAt = input.action === 'publish_now' ? now : (input.scheduledAt ?? null);
  const targetStatus: PublishStatus = input.action === 'draft' ? 'DRAFT' : input.action === 'publish_now' ? 'QUEUED' : 'SCHEDULED';

  const touched: string[] = [];
  const post = await prisma.$transaction(async (tx) => {
    const post = existing
      ? await tx.post.update({ where: { id: existing.id }, data: { videoId: input.videoId, title: input.title, scheduledAt } })
      : await tx.post.create({ data: { userId, videoId: input.videoId, title: input.title, scheduledAt } });

    const keep = new Set(input.targets.map((t) => t.accountId));
    if (existing) {
      if (existing.videoId !== input.videoId && existing.targets.some((t) => LOCKED.includes(t.status))) {
        throw conflict('Não é possível trocar o vídeo de uma publicação que já começou a ser publicada');
      }
      for (const t of existing.targets) {
        if (keep.has(t.accountId) || LOCKED.includes(t.status)) continue;
        if (t.attemptCount > 0) {
          await tx.postTarget.update({ where: { id: t.id }, data: { status: 'CANCELED', nextAttemptAt: null } });
        } else {
          await tx.postTarget.delete({ where: { id: t.id } });
        }
      }
    }

    for (const t of input.targets) {
      const acc = v.accounts.get(t.accountId)!;
      const current = existing?.targets.find((x) => x.accountId === t.accountId);
      if (current && LOCKED.includes(current.status)) continue; // já publicado/em publicação: intocável
      const data = {
        platform: acc.platform,
        caption: t.caption,
        hashtags: t.hashtags,
        options: t.options as Prisma.InputJsonValue,
        status: targetStatus,
        nextAttemptAt: targetStatus === 'DRAFT' ? null : scheduledAt,
        leaseUntil: null,
        phase: null,
        providerState: Prisma.DbNull,
        attemptCount: 0,
        lastError: null,
        lastErrorCode: null,
      };
      const saved = current
        ? await tx.postTarget.update({ where: { id: current.id }, data })
        : await tx.postTarget.create({ data: { postId: post.id, accountId: t.accountId, ...data } });
      touched.push(saved.id);
    }
    return post;
  });

  await refreshPostStatus(post.id);
  if (targetStatus !== 'DRAFT' && scheduledAt) {
    for (const id of touched) await safeNotify(id, scheduledAt);
  }
  const names = input.targets.map((t) => PLATFORM_LABEL[v.accounts.get(t.accountId)!.platform]);
  const what = `"${input.title || v.video.title}"`;
  await logActivity({
    userId,
    postId: post.id,
    type: `post.${input.action}`,
    level: 'INFO',
    message:
      input.action === 'draft'
        ? `Rascunho salvo: ${what}`
        : input.action === 'publish_now'
          ? `Publicação imediata solicitada: ${what} em ${names.join(', ')}`
          : `Agendado para ${fmt(scheduledAt!)}: ${what} em ${names.join(', ')}`,
  });
  return { id: post.id, warnings: v.issues };
}

/** Arrastar no calendário: muda só o horário */
export async function reschedulePost(userId: string, postId: string, scheduledAt: Date) {
  const post = await prisma.post.findFirst({ where: { id: postId, userId }, include: { targets: true, video: true } });
  if (!post) throw notFound('Publicação não encontrada');
  const movable = post.targets.filter((t) => ['SCHEDULED', 'DRAFT', 'QUEUED'].includes(t.status) && t.attemptCount === 0);
  const blocking = post.targets.filter((t) => ['PROCESSING', 'PUBLISHED'].includes(t.status) || (t.status === 'QUEUED' && t.attemptCount > 0));
  if (blocking.length) throw conflict('Esta publicação já começou a ser processada e não pode ser movida');
  const isScheduled = post.targets.some((t) => t.status === 'SCHEDULED' || t.status === 'QUEUED');
  if (isScheduled && scheduledAt.getTime() < Date.now() + MIN_LEAD_MS) {
    throw badRequest('O novo horário precisa estar pelo menos 1 minuto no futuro');
  }

  await prisma.$transaction([
    prisma.post.update({ where: { id: postId }, data: { scheduledAt } }),
    prisma.postTarget.updateMany({
      where: { id: { in: movable.filter((t) => t.status !== 'DRAFT').map((t) => t.id) } },
      data: { nextAttemptAt: scheduledAt, status: 'SCHEDULED' },
    }),
  ]);
  for (const t of movable) if (t.status !== 'DRAFT') await safeNotify(t.id, scheduledAt);
  await refreshPostStatus(postId);
  await logActivity({ userId, postId, type: 'post.rescheduled', message: `Reagendado para ${fmt(scheduledAt)}: "${post.title || post.video.title}"` });
}

export async function cancelPost(userId: string, postId: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, userId }, include: { targets: true, video: true } });
  if (!post) throw notFound('Publicação não encontrada');
  const cancelable: PublishStatus[] = ['DRAFT', 'SCHEDULED', 'QUEUED', 'FAILED', 'NEEDS_ACTION'];
  // Trava otimista: só cancela quem ainda não foi reivindicado pelo worker
  const res = await prisma.postTarget.updateMany({
    where: { postId, status: { in: cancelable }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
    data: { status: 'CANCELED', nextAttemptAt: null },
  });
  const status = await refreshPostStatus(postId);
  const stillRunning = post.targets.filter((t) => t.status === 'PROCESSING').length;
  await logActivity({ userId, postId, type: 'post.canceled', level: 'WARNING', message: `Publicação cancelada: "${post.title || post.video.title}"` });
  return { canceled: res.count, stillRunning, status };
}

export async function retryTarget(userId: string, targetId: string) {
  const target = await prisma.postTarget.findFirst({
    where: { id: targetId, post: { userId } },
    include: { account: true, post: { include: { video: true } } },
  });
  if (!target) throw notFound('Destino não encontrado');
  if (!['FAILED', 'NEEDS_ACTION'].includes(target.status)) throw conflict('Só é possível tentar novamente publicações com falha ou pendentes');
  if (target.account.status !== 'ACTIVE') throw conflict('Reconecte a conta antes de tentar novamente');
  if (target.post.video.deletedAt) throw conflict('O vídeo desta publicação foi excluído');

  // Consultas de processamento continuam de onde pararam; o resto recomeça do zero
  const resume = target.phase?.startsWith('AWAITING') && target.lastErrorCode === 'processing_timeout';
  const now = new Date();
  await prisma.postTarget.update({
    where: { id: targetId },
    data: {
      status: 'QUEUED',
      nextAttemptAt: now,
      attemptCount: 0,
      leaseUntil: null,
      ...(resume ? {} : { phase: null, providerState: Prisma.DbNull }),
      lastError: null,
      lastErrorCode: null,
    },
  });
  await refreshPostStatus(target.postId);
  await safeNotify(targetId, now);
  await logActivity({ userId, postId: target.postId, targetId, type: 'publish.manual_retry', message: `Nova tentativa solicitada em ${PLATFORM_LABEL[target.platform]}` });
}

/** Confirmação manual (ex.: rascunho finalizado no app do TikTok) */
export async function markPublished(userId: string, targetId: string, permalink?: string) {
  const target = await prisma.postTarget.findFirst({ where: { id: targetId, post: { userId } } });
  if (!target) throw notFound('Destino não encontrado');
  if (!['NEEDS_ACTION', 'FAILED'].includes(target.status)) throw conflict('Este destino não está aguardando ação manual');
  await prisma.postTarget.update({
    where: { id: targetId },
    data: { status: 'PUBLISHED', publishedAt: new Date(), permalink: permalink ?? target.permalink, lastError: null, lastErrorCode: null, phase: 'DONE' },
  });
  await refreshPostStatus(target.postId);
  await logActivity({ userId, postId: target.postId, targetId, type: 'publish.manual_confirm', level: 'SUCCESS', message: `${PLATFORM_LABEL[target.platform]}: publicação confirmada manualmente` });
}

export async function deletePost(userId: string, postId: string) {
  const post = await prisma.post.findFirst({ where: { id: postId, userId }, include: { targets: true } });
  if (!post) throw notFound('Publicação não encontrada');
  if (post.targets.some((t) => ['SCHEDULED', 'QUEUED', 'PROCESSING', 'PUBLISHED'].includes(t.status))) {
    throw conflict('Cancele a publicação antes de excluir. Publicações já realizadas ficam no histórico.');
  }
  await prisma.post.delete({ where: { id: postId } });
}
