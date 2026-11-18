/**
 * Despacho de execuções do worker.
 *
 * O PostgreSQL é a fonte da verdade: cada destino tem `status` e `nextAttemptAt`.
 * O despachante só serve para acordar o worker na hora certa.
 *
 *  - bullmq: cria um job atrasado no Redis para o instante exato (produção).
 *  - pg:     sem Redis; o worker consulta o banco a cada poucos segundos.
 *
 * Em ambos os modos, o "sweeper" do worker varre o banco periodicamente e recoloca
 * na fila qualquer destino vencido. Assim nada se perde se o Redis for limpo
 * ou se o servidor reiniciar.
 */
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../../config/env.js';

export const QUEUE_NAME = 'publish';

export interface Dispatcher {
  notify(targetId: string, runAt: Date): Promise<void>;
  close(): Promise<void>;
}

let redis: Redis | undefined;
export function redisConnection() {
  redis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  return redis;
}

class BullDispatcher implements Dispatcher {
  queue = new Queue(QUEUE_NAME, {
    connection: redisConnection(),
    defaultJobOptions: { removeOnComplete: true, removeOnFail: { count: 2000 }, attempts: 1 },
  });

  async notify(targetId: string, runAt: Date) {
    const delay = Math.max(0, runAt.getTime() - Date.now());
    await this.queue.add('target', { targetId }, { jobId: `${targetId}-${runAt.getTime()}`, delay });
  }

  async close() {
    await this.queue.close();
  }
}

class PgDispatcher implements Dispatcher {
  async notify() {
    // O worker em modo pg encontra o destino sozinho consultando nextAttemptAt.
  }
  async close() {}
}

let instance: Dispatcher | undefined;
export function dispatcher(): Dispatcher {
  instance ??= env.QUEUE_DRIVER === 'bullmq' ? new BullDispatcher() : new PgDispatcher();
  return instance;
}

/** Notifica sem derrubar a requisição se o Redis estiver fora: o sweeper cobre. */
export async function safeNotify(targetId: string, runAt: Date) {
  try {
    await dispatcher().notify(targetId, runAt);
  } catch (err) {
    console.warn(`[dispatcher] falha ao enfileirar ${targetId}; o sweeper vai recuperar.`, (err as Error).message);
  }
}
