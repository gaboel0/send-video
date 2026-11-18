import { Ban, CheckCheck, ExternalLink, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../lib/api';
import { handle, PlatformIcon, PLATFORMS } from '../lib/platforms';
import { useInvalidate, usePost } from '../lib/queries';
import { StatusTag } from '../lib/status';
import { cap, fmtDateTime, fmtLong, relative } from '../lib/time';
import type { Attempt, PostDetail, PostTarget } from '../lib/types';
import { ActivityFeed } from '../pages/Dashboard';
import { Button, Drawer, ErrorState, Skeleton, useConfirm, useToast } from './ui';
import { VideoThumb } from './VideoThumb';

const OUTCOME: Record<Attempt['outcome'], string> = {
  IN_PROGRESS: 'Em andamento',
  CONTINUE: 'Aguardando a rede',
  SUCCESS: 'Publicado',
  RETRY: 'Falhou, nova tentativa agendada',
  FAILED: 'Falhou',
  NEEDS_ACTION: 'Requer ação',
};

export function PostDrawer({ postId, onClose }: { postId: string | null; onClose: () => void }) {
  const { data, isLoading, error, refetch } = usePost(postId);
  return (
    <Drawer open={!!postId} onClose={onClose} label="Detalhes da publicação">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-4">
        <h2 className="text-lg">Publicação</h2>
        <Button variant="ghost" size="sm" onClick={onClose} icon={<X />} aria-label="Fechar" />
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto">
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading || !data ? <DrawerSkeleton /> : <Detail post={data} onClose={onClose} />}
      </div>
    </Drawer>
  );
}

function DrawerSkeleton() {
  return (
    <div className="space-y-4 p-5">
      <div className="flex gap-4">
        <Skeleton className="aspect-[9/16] w-24" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
    </div>
  );
}

function Detail({ post, onClose }: { post: PostDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      await invalidate('post', 'posts', 'dashboard', 'videos');
      toast('ok', ok);
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setBusy(null);
    }
  };

  const cancellable = post.targets.some((t) => ['DRAFT', 'SCHEDULED', 'QUEUED', 'FAILED', 'NEEDS_ACTION'].includes(t.status));
  const editable = !post.targets.every((t) => ['PROCESSING', 'PUBLISHED', 'CANCELED'].includes(t.status)) || post.status === 'CANCELED';
  const deletable = !post.targets.some((t) => ['SCHEDULED', 'QUEUED', 'PROCESSING', 'PUBLISHED'].includes(t.status));

  return (
    <div className="space-y-6 p-5">
      <div className="flex gap-4">
        <VideoThumb src={post.video.thumbnailUrl} duration={post.video.durationSec} className="w-24 flex-none shadow-stock" />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg">{post.title || post.video.title}</h3>
          <div className="mt-1.5">
            <StatusTag status={post.status} />
          </div>
          <p className="mt-2 text-sm text-ink-2">
            {post.scheduledAt ? cap(fmtLong(post.scheduledAt)) : 'Sem data definida'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {editable && (
              <Button size="sm" icon={<Pencil />} onClick={() => navigate(`/publicar/${post.id}`)}>
                Editar
              </Button>
            )}
            {cancellable && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Ban />}
                busy={busy === 'cancel'}
                onClick={async () => {
                  if (!(await confirm({ title: 'Cancelar publicação?', body: 'Os destinos que ainda não foram publicados não serão enviados. Você pode editar e agendar de novo depois.', confirm: 'Cancelar publicação', danger: true }))) return;
                  run('cancel', () => api.post(`/api/posts/${post.id}/cancel`), 'Publicação cancelada');
                }}
              >
                Cancelar
              </Button>
            )}
            {deletable && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 />}
                busy={busy === 'delete'}
                onClick={async () => {
                  if (!(await confirm({ title: 'Excluir publicação?', body: 'O vídeo continua na biblioteca. O histórico desta publicação será apagado.', confirm: 'Excluir', danger: true }))) return;
                  await run('delete', () => api.del(`/api/posts/${post.id}`), 'Publicação excluída');
                  onClose();
                }}
              >
                Excluir
              </Button>
            )}
          </div>
        </div>
      </div>

      <section aria-labelledby="dest-h">
        <h4 id="dest-h" className="mb-3 text-sm font-semibold tracking-normal">
          Destinos
        </h4>
        <ul className="space-y-3">
          {post.targets.map((t) => (
            <TargetCard key={t.id} t={t} attempts={post.attempts.filter((a) => a.targetId === t.id)} busy={busy} run={run} />
          ))}
        </ul>
      </section>

      <ActivityFeed items={post.activity} loading={false} title="Histórico" />
    </div>
  );
}

function TargetCard({
  t,
  attempts,
  busy,
  run,
}: {
  t: PostTarget;
  attempts: Attempt[];
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [showAttempts, setShowAttempts] = useState(false);
  const caption = [t.caption, t.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');
  return (
    <li className="stock p-4">
      <div className="flex items-center gap-2.5">
        <PlatformIcon platform={t.platform} size={16} />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">
          {PLATFORMS[t.platform].label} <span className="font-normal text-muted">{handle(t.account)}</span>
        </p>
        {t.status === 'PUBLISHED' ? <span className="pressed text-sm">publicado</span> : <StatusTag status={t.status} />}
      </div>

      {t.status === 'PUBLISHED' && t.publishedAt && (
        <p className="mt-2 text-xs text-muted">
          Publicado em {fmtDateTime(t.publishedAt)}
          {t.permalink && (
            <>
              {' '}
              <a href={t.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-2">
                Ver na rede <ExternalLink className="size-3" aria-hidden />
              </a>
            </>
          )}
        </p>
      )}
      {(t.status === 'QUEUED' || t.status === 'PROCESSING') && t.nextAttemptAt && (
        <p className="mt-2 text-xs text-muted">
          {t.status === 'PROCESSING' ? 'Aguardando confirmação da rede' : 'Próxima tentativa'} {relative(t.nextAttemptAt)}
          {t.attemptCount > 0 && <span className="fig"> (tentativa {t.attemptCount} de {t.maxAttempts})</span>}
        </p>
      )}
      {t.lastError && ['FAILED', 'NEEDS_ACTION', 'QUEUED'].includes(t.status) && (
        <p className={`mt-3 rounded-[var(--radius-input)] px-3 py-2 text-sm ${t.status === 'FAILED' ? 'bg-danger-wash text-danger' : 'bg-warn-wash text-ink-2'}`} role="status">
          {t.lastError}
        </p>
      )}

      {caption && <p className="mt-3 line-clamp-4 text-sm whitespace-pre-line text-ink-2">{caption}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {['FAILED', 'NEEDS_ACTION'].includes(t.status) && t.account.status === 'ACTIVE' && (
          <Button size="sm" icon={<RotateCcw />} busy={busy === `retry-${t.id}`} onClick={() => run(`retry-${t.id}`, () => api.post(`/api/targets/${t.id}/retry`), 'Nova tentativa enfileirada')}>
            Tentar novamente
          </Button>
        )}
        {t.status === 'NEEDS_ACTION' && (
          <Button size="sm" variant="ghost" icon={<CheckCheck />} busy={busy === `mark-${t.id}`} onClick={() => run(`mark-${t.id}`, () => api.post(`/api/targets/${t.id}/mark-published`), 'Marcado como publicado')}>
            Já publiquei
          </Button>
        )}
        {t.account.status !== 'ACTIVE' && ['FAILED', 'NEEDS_ACTION'].includes(t.status) && (
          <a href="/contas" className="btn btn--card btn--sm no-underline">
            Reconectar conta
          </a>
        )}
        {attempts.length > 0 && (
          <button type="button" className="ml-auto text-xs text-muted underline-offset-2 hover:underline" onClick={() => setShowAttempts((s) => !s)} aria-expanded={showAttempts}>
            {showAttempts ? 'Ocultar tentativas' : `${attempts.length} tentativa${attempts.length > 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {showAttempts && (
        <table className="mt-3 w-full text-left text-xs">
          <thead className="text-muted">
            <tr className="border-b border-rule">
              <th className="py-1.5 pr-2 font-medium">Nº</th>
              <th className="py-1.5 pr-2 font-medium">Início</th>
              <th className="py-1.5 font-medium">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.id} className="border-b border-rule align-top last:border-0">
                <td className="fig py-2 pr-2">{a.attemptNo}</td>
                <td className="fig py-2 pr-2 whitespace-nowrap">{fmtDateTime(a.startedAt)}</td>
                <td className="py-2">
                  <span className={a.outcome === 'SUCCESS' ? 'text-paid' : ['FAILED'].includes(a.outcome) ? 'text-danger' : 'text-ink-2'}>{OUTCOME[a.outcome]}</span>
                  {a.phase && <span className="text-faint"> em {a.phase.toLowerCase()}</span>}
                  {a.errorMessage && <span className="mt-0.5 block text-muted">{a.errorMessage}</span>}
                  {a.errorCode && <span className="fig block text-faint">{a.errorCode}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}
