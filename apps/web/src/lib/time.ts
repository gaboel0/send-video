import { TZDate } from '@date-fns/tz';
import { addDays, format, isSameDay, startOfMonth, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/** Todo o app trabalha no horário de Brasília, independentemente do fuso do computador */
export const TZ = 'America/Sao_Paulo';

export const zoned = (d: Date | string | number) => new TZDate(new Date(d).getTime(), TZ);
export const nowZoned = () => TZDate.tz(TZ);

/** Instante UTC a partir de data/hora "de parede" em São Paulo */
export const fromWall = (y: number, m: number, d: number, h = 0, min = 0) => new Date(new TZDate(y, m - 1, d, h, min, TZ).getTime());

export const fmt = (d: Date | string, pattern: string) => format(zoned(d), pattern, { locale: ptBR });
/** Primeira letra maiúscula ("segunda-feira" → "Segunda-feira") sem text-transform */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const fmtTime = (d: Date | string) => fmt(d, 'HH:mm');
export const fmtDay = (d: Date | string) => fmt(d, "d 'de' MMM");
export const fmtDateTime = (d: Date | string) => fmt(d, "d 'de' MMM, HH:mm");
export const fmtLong = (d: Date | string) => fmt(d, "EEEE, d 'de' MMMM 'às' HH:mm");
export const dayKey = (d: Date | string) => fmt(d, 'yyyy-MM-dd');

export function parseDayKey(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

export function relative(d: Date | string) {
  const diff = new Date(d).getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  if (abs < 60_000) return diff >= 0 ? 'em instantes' : 'agora há pouco';
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
  if (abs < 7 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return fmtDay(d);
}

/** Grade do mês: 6 semanas começando na segunda-feira */
export function monthGrid(anchor: Date) {
  const first = startOfMonth(zoned(anchor));
  const start = startOfWeek(first, { weekStartsOn: 1 });
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekDays(anchor: Date) {
  const start = startOfWeek(zoned(anchor), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const addDaysWall = (n: number) => addDays(nowZoned(), n);

export const sameDay =(a: Date, b: Date) => isSameDay(zoned(a), zoned(b));

export function formatDuration(sec: number | null | undefined) {
  if (sec == null) return '';
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 100 * 1024 * 1024 ? 1 : 0).replace('.', ',')} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
}

/** "2026-11-18" e "14:30" → valores para inputs date/time no fuso de SP */
export const toDateInput = (d: Date | string) => fmt(d, 'yyyy-MM-dd');
export const toTimeInput = (d: Date | string) => fmt(d, 'HH:mm');
export function fromInputs(date: string, time: string) {
  const { y, m, d } = parseDayKey(date);
  const [h, min] = time.split(':').map(Number);
  return fromWall(y, m, d, h || 0, min || 0);
}
