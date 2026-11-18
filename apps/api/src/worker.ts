/**
 * Worker de publicação. Processo separado da API: deve ficar rodando 24/7 no servidor.
 *
 *   npm run start:worker
 */
import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { dispatcher, QUEUE_NAME, redisConnection } from './modules/scheduler/dispatcher.js';
import { runMaintenance } from './modules/scheduler/maintenance.js';
import { processTarget } from './modules/scheduler/processor.js';
import { findDueTargets } from './modules/scheduler/sweeper.js';

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);
const timers: NodeJS.Timeout[] = [];
let stopping = false;
let bullWorker: Worker | undefined;

async function main() {
  log(`[worker] iniciando (driver=${env.QUEUE_DRIVER}, concorrência=${env.WORKER_CONCURRENCY}, tz=${env.APP_TIMEZONE})`);
  await prisma.$queryRaw`SELECT 1`;

  if (env.QUEUE_DRIVER === 'bullmq') {
    bullWorker = new Worker(
      QUEUE_NAME,
      async (job) => {
        await processTarget(job.data.targetId);
      },
      {
        connection: redisConnection(),
        concurrency: env.WORKER_CONCURRENCY,
        // Limita a vazão para respeitar limites das APIs (ex.: TikTok 6 inits/min por usuário)
        limiter: { max: 20, duration: 60_000 },
      },
    );
    bullWorker.on('failed', (job, err) => log(`[worker] job ${job?.id} falhou: ${err.message}`));
    bullWorker.on('error', (err) => log(`[worker] erro BullMQ: ${err.message}`));

    // Sweeper: recoloca na fila destinos vencidos que não tenham job (Redis limpo, reinício, etc.)
    const sweep = async () => {
      try {
        const due = await findDueTargets(200);
        const bucket = Math.floor(Date.now() / 60_000);
        for (const t of due) {
          await (dispatcher() as any).queue.add('target', { targetId: t.id }, { jobId: `${t.id}-sweep-${bucket}` });
        }
        if (due.length) log(`[sweeper] ${due.length} destino(s) recolocado(s) na fila`);
      } catch (err) {
        log(`[sweeper] erro: ${(err as Error).message}`);
      }
    };
    await sweep();
    timers.push(setInterval(sweep, 30_000));
  } else {
    // Modo pg: o próprio banco é a fila. Varre a cada 5 s e processa com concorrência limitada.
    const running = new Set<string>();
    const tick = async () => {
      if (stopping) return;
      try {
        const free = env.WORKER_CONCURRENCY - running.size;
        if (free <= 0) return;
        const due = (await findDueTargets(free + running.size)).filter((t) => !running.has(t.id)).slice(0, free);
        for (const t of due) {
          running.add(t.id);
          processTarget(t.id)
            .catch((err) => log(`[worker] erro ao processar ${t.id}: ${(err as Error).message}`))
            .finally(() => running.delete(t.id));
        }
      } catch (err) {
        log(`[worker] erro na varredura: ${(err as Error).message}`);
      }
    };
    await tick();
    timers.push(setInterval(tick, 5_000));
  }

  const maintenance = () => runMaintenance(log).catch((err) => log(`[maintenance] erro: ${(err as Error).message}`));
  await maintenance();
  timers.push(setInterval(maintenance, 30 * 60_000));
  log('[worker] pronto');
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`[worker] ${signal} recebido, finalizando...`);
  timers.forEach(clearInterval);
  // Aguarda jobs em andamento terminarem a etapa atual (lease protege o restante)
  await bullWorker?.close().catch(() => {});
  await dispatcher().close().catch(() => {});
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((err) => {
  console.error('[worker] falha ao iniciar', err);
  process.exit(1);
});
