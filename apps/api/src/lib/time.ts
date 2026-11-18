import { env } from '../config/env.js';

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: env.APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "2026-11-18" no fuso da aplicação */
export const zonedDayKey = (d: Date) => dayFmt.format(d);

/** Deslocamento (ms) do fuso em relação a UTC num instante */
function tzOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: env.APP_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Converte data/hora "de parede" no fuso da aplicação para um instante UTC */
export function zonedToUtc(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offset = tzOffsetMs(guess);
  const result = new Date(guess.getTime() - offset);
  // Ajuste se o deslocamento mudou no intervalo (transição de horário de verão)
  const offset2 = tzOffsetMs(result);
  return offset2 === offset ? result : new Date(guess.getTime() - offset2);
}

/** Início da semana (segunda-feira 00:00) no fuso da aplicação, como instante UTC */
export function startOfZonedWeek(now = new Date()): Date {
  const [y, m, d] = zonedDayKey(now).split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  const diff = (weekday + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - diff));
  return zonedToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
