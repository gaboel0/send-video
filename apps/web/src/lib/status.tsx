import { AlertTriangle, Ban, CircleDashed, Clock, FileEdit, Hand, Loader2, Send } from 'lucide-react';
import type { PublishStatus } from './types';

export const STATUS: Record<PublishStatus, { label: string; color: string; icon: typeof Clock; hint: string }> = {
  DRAFT: { label: 'Rascunho', color: 'var(--color-muted)', icon: FileEdit, hint: 'Ainda não agendada' },
  SCHEDULED: { label: 'Agendada', color: 'var(--color-ink-2)', icon: Clock, hint: 'Será publicada no horário definido' },
  QUEUED: { label: 'Na fila', color: 'var(--color-live)', icon: CircleDashed, hint: 'Aguardando o worker' },
  PROCESSING: { label: 'Processando', color: 'var(--color-live)', icon: Loader2, hint: 'Enviando para a rede social' },
  PUBLISHED: { label: 'Publicada', color: 'var(--color-paid)', icon: Send, hint: 'Publicação confirmada pela rede' },
  FAILED: { label: 'Falhou', color: 'var(--color-danger)', icon: AlertTriangle, hint: 'Veja o motivo e tente novamente' },
  NEEDS_ACTION: { label: 'Requer ação', color: 'var(--color-warn)', icon: Hand, hint: 'Precisa de uma ação sua' },
  CANCELED: { label: 'Cancelada', color: 'var(--color-faint)', icon: Ban, hint: 'Não será publicada' },
};

export const STATUS_ORDER: PublishStatus[] = ['DRAFT', 'SCHEDULED', 'QUEUED', 'PROCESSING', 'PUBLISHED', 'FAILED', 'NEEDS_ACTION', 'CANCELED'];

export function StatusTag({ status, compact = false }: { status: PublishStatus; compact?: boolean }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className="tag" style={{ color: s.color }} title={s.hint}>
      <Icon className={status === 'PROCESSING' ? 'animate-spin motion-reduce:animate-none' : undefined} aria-hidden />
      {!compact && s.label}
      {compact && <span className="sr-only">{s.label}</span>}
    </span>
  );
}

export const isEditable = (s: PublishStatus) => !['PROCESSING', 'PUBLISHED'].includes(s);
