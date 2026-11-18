import { PublishError } from '../../lib/errors.js';
import type { ProviderState } from './types.js';

const MAX_POLL_WINDOW_MS = 2 * 3600_000;

/**
 * Atraso progressivo entre consultas de status do processamento na plataforma
 * (5 s → 10 s → 20 s → 30 s → 60 s → ... até 5 min). Depois de 2 h sem conclusão,
 * pede ação manual em vez de ficar consultando para sempre.
 */
export function nextPoll(state: ProviderState): { delayMs: number; state: ProviderState } {
  const polls = (state.polls ?? 0) + 1;
  const pollStartedAt = state.pollStartedAt ?? Date.now();
  if (Date.now() - pollStartedAt > MAX_POLL_WINDOW_MS) {
    throw new PublishError(
      'action',
      'processing_timeout',
      'A plataforma não confirmou o processamento em 2 horas. Verifique a publicação diretamente na rede social.',
    );
  }
  const steps = [5_000, 10_000, 20_000, 30_000, 60_000, 120_000, 300_000];
  const delayMs = steps[Math.min(polls - 1, steps.length - 1)];
  return { delayMs, state: { ...state, polls, pollStartedAt } };
}

export const resetPolling = (state: ProviderState) => {
  const { polls: _p, pollStartedAt: _s, ...rest } = state;
  return rest;
};
