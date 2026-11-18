/**
 * Execução de um destino de publicação (uma conta). Chamado pelo worker (BullMQ ou pg).
 *
 * Garantias:
 *  - Exclusão mútua: o destino é "reivindicado" com trava otimista (updatedAt) + lease.
 *    Dois workers, jobs duplicados ou o sweeper nunca processam o mesmo destino ao mesmo tempo.
 *  - Sem publicação duplicada: o publicador grava checkpoints antes de chamadas não idempotentes;
 *    se o processo cair no meio, a retomada consulta a plataforma em vez de publicar de novo.
 *  - Tentativas com backoff exponencial para falhas transitórias; histórico em PublishAttempt.
 */
import { PublishError, TokenExpiredError } from '../../lib/errors.js';
import { Prisma, prisma, type PostTarget, type PublishStatus } from '../../lib/prisma.js';
import { logActivity, PLATFORM_LABEL, refreshPostStatus } from '../activity/activity.js';
import { publishers } from '../integrations/registry.js';
import { markConnectionExpired } from '../integrations/tokens.js';
import type { ProviderState, PublishContext, StepResult, TargetWithRelations } from '../integrations/types.js';
import { safeNotify } from './dispatcher.js';

export const LEASE_MS = 20 * 60_000;
const BACKOFF_MIN = [1, 5, 15, 30, 60];
export const DISPATCHABLE: PublishStatus[] = ['SCHEDULED', 'QUEUED', 'PROCESSING'];

export function isDue(t: Pick<PostTarget, 'status' | 'nextAttemptAt' | 'leaseUntil'>, now = new Date()) {
  return (
    DISPATCHABLE.includes(t.status) &&
    t.nextAttemptAt !== null &&
    t.nextAttemptAt <= now &&
    (t.leaseUntil === null || t.leaseUntil < now)
  );
}

const json = (v: ProviderState | null | undefined) => (v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue));

export async function processTarget(targetId: string): Promise<void> {
  const now = new Date();
  const current = await prisma.postTarget.findUnique({ where: { id: targetId } });
  if (!current || !isDue(current, now)) return;

  // Nova tentativa quando vem da fila/agenda ou quando um worker anterior caiu (lease vencido).
  // Uma consulta de status agendada (PROCESSING sem lease) continua a mesma tentativa.
  const isNewAttempt = current.status !== 'PROCESSING' || current.leaseUntil !== null;

  const claim = await prisma.postTarget.updateMany({
    where: { id: targetId, updatedAt: current.updatedAt, status: current.status },
    data: {
      status: 'PROCESSING',
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      ...(isNewAttempt ? { attemptCount: { increment: 1 } } : {}),
    },
  });
  if (claim.count === 0) return; // outro worker pegou

  const target = (await prisma.postTarget.findUniqueOrThrow({
    where: { id: targetId },
    include: { post: { include: { video: true } }, account: { include: { connection: true } } },
  })) as TargetWithRelations;
  const userId = target.post.userId;
  const label = `${PLATFORM_LABEL[target.platform]} (${target.account.username ? '@' + target.account.username.replace(/^@/, '') : target.account.name})`;

  let attempt = isNewAttempt
    ? null
    : await prisma.publishAttempt.findFirst({ where: { targetId, finishedAt: null }, orderBy: { startedAt: 'desc' } });
  attempt ??= await prisma.publishAttempt.create({
    data: { targetId, attemptNo: target.attemptCount, phase: target.phase },
  });

  if (isNewAttempt) {
    await refreshPostStatus(target.postId);
    await logActivity({
      userId,
      postId: target.postId,
      targetId,
      type: 'publish.started',
      message: target.attemptCount > 1 ? `Tentativa ${target.attemptCount} de publicação em ${label}` : `Publicação iniciada em ${label}`,
    });
  }

  let phase = target.phase;
  let state: ProviderState = (target.providerState as ProviderState) ?? {};

  const ctx: PublishContext = {
    target,
    phase,
    state,
    async checkpoint(nextPhase, nextState) {
      phase = nextPhase;
      if (nextState) state = nextState;
      await prisma.postTarget.update({
        where: { id: targetId },
        data: { phase, providerState: json(state), leaseUntil: new Date(Date.now() + LEASE_MS) },
      });
      await prisma.publishAttempt.update({ where: { id: attempt!.id }, data: { phase } });
    },
    async log(message) {
      await logActivity({ userId, postId: target.postId, targetId, type: 'publish.progress', message });
    },
  };

  let result: StepResult;
  try {
    result = await publishers[target.platform].step(ctx);
  } catch (err) {
    await handleError(err, target, attempt.id, label, phase, state);
    return;
  }

  const finishedAt = new Date();
  switch (result.type) {
    case 'continue': {
      const runAt = new Date(Date.now() + result.delayMs);
      await prisma.postTarget.update({
        where: { id: targetId },
        data: { phase: result.phase, providerState: json(result.state), status: 'PROCESSING', nextAttemptAt: runAt, leaseUntil: null },
      });
      await prisma.publishAttempt.update({ where: { id: attempt.id }, data: { phase: result.phase, outcome: 'CONTINUE' } });
      await safeNotify(targetId, runAt);
      break;
    }
    case 'published': {
      await prisma.postTarget.update({
        where: { id: targetId },
        data: {
          status: 'PUBLISHED',
          phase: 'DONE',
          providerState: json(result.state),
          externalId: result.externalId,
          permalink: result.permalink ?? null,
          publishedAt: finishedAt,
          nextAttemptAt: null,
          leaseUntil: null,
          lastError: null,
          lastErrorCode: null,
        },
      });
      await prisma.publishAttempt.update({
        where: { id: attempt.id },
        data: { outcome: 'SUCCESS', finishedAt, phase: 'DONE', details: { externalId: result.externalId, permalink: result.permalink ?? null } },
      });
      await logActivity({ userId, postId: target.postId, targetId, type: 'publish.success', level: 'SUCCESS', message: `Publicado em ${label}` });
      break;
    }
    case 'needs_action': {
      await prisma.postTarget.update({
        where: { id: targetId },
        data: {
          status: 'NEEDS_ACTION',
          providerState: json(result.state),
          lastErrorCode: result.code,
          lastError: result.message,
          nextAttemptAt: null,
          leaseUntil: null,
        },
      });
      await prisma.publishAttempt.update({
        where: { id: attempt.id },
        data: { outcome: 'NEEDS_ACTION', finishedAt, errorCode: result.code, errorMessage: result.message },
      });
      await logActivity({ userId, postId: target.postId, targetId, type: 'publish.needs_action', level: 'WARNING', message: `${label}: ${result.message}` });
      break;
    }
  }
  await refreshPostStatus(target.postId);
}

async function handleError(
  err: unknown,
  target: TargetWithRelations,
  attemptId: string,
  label: string,
  phase: string | null,
  state: ProviderState,
) {
  const userId = target.post.userId;
  const finishedAt = new Date();
  const perr =
    err instanceof PublishError
      ? err
      : new PublishError('retry', 'unexpected_error', `Erro inesperado: ${(err as Error)?.message ?? String(err)}`);

  if (perr instanceof TokenExpiredError) {
    await markConnectionExpired(target.account.connectionId, perr.message).catch(() => {});
  }

  let status: PublishStatus;
  let nextAttemptAt: Date | null = null;
  let outcome: 'RETRY' | 'FAILED' | 'NEEDS_ACTION';
  let message = perr.message;

  if (perr.kind === 'retry' && target.attemptCount < target.maxAttempts) {
    const backoffMs = BACKOFF_MIN[Math.min(target.attemptCount - 1, BACKOFF_MIN.length - 1)] * 60_000;
    nextAttemptAt = new Date(Date.now() + Math.max(backoffMs, perr.retryAfterMs ?? 0));
    status = 'QUEUED';
    outcome = 'RETRY';
  } else if (perr.kind === 'action') {
    status = 'NEEDS_ACTION';
    outcome = 'NEEDS_ACTION';
  } else {
    status = 'FAILED';
    outcome = 'FAILED';
    if (perr.kind === 'retry') message = `${perr.message} (falhou após ${target.attemptCount} tentativas)`;
  }

  await prisma.postTarget.update({
    where: { id: target.id },
    data: {
      status,
      nextAttemptAt,
      leaseUntil: null,
      phase,
      providerState: json(state),
      lastErrorCode: perr.code,
      lastError: message,
    },
  });
  await prisma.publishAttempt.update({
    where: { id: attemptId },
    data: { outcome, finishedAt, errorCode: perr.code, errorMessage: message, phase, details: (perr.details as any) ?? undefined },
  });

  const when = nextAttemptAt
    ? ` Nova tentativa às ${nextAttemptAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}.`
    : '';
  await logActivity({
    userId,
    postId: target.postId,
    targetId: target.id,
    type: status === 'QUEUED' ? 'publish.retry' : status === 'FAILED' ? 'publish.failed' : 'publish.needs_action',
    level: status === 'QUEUED' ? 'WARNING' : status === 'FAILED' ? 'ERROR' : 'WARNING',
    message: `${label}: ${message}${when}`,
  });
  await refreshPostStatus(target.postId);
  if (nextAttemptAt) await safeNotify(target.id, nextAttemptAt);
}
