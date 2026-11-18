import { prisma } from '../../lib/prisma.js';
import { DISPATCHABLE } from './processor.js';

/** Destinos vencidos e livres (sem lease ativo), em ordem de horário */
export async function findDueTargets(limit: number) {
  const now = new Date();
  return prisma.postTarget.findMany({
    where: {
      status: { in: DISPATCHABLE },
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: limit,
    select: { id: true, nextAttemptAt: true },
  });
}
