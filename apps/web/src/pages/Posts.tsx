import { CalendarPlus, ListChecks } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { PostDrawer } from '../components/PostDrawer';
import { Page } from '../components/Shell';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { VideoThumb } from '../components/VideoThumb';
import { handle, PLATFORM_ORDER, PlatformIcon, PLATFORMS } from '../lib/platforms';
import { usePosts } from '../lib/queries';
import { STATUS, StatusTag } from '../lib/status';
import { cap, fmt, relative } from '../lib/time';
import type { Platform } from '../lib/types';

const TABS = [
  { value: '', label: 'Todas' },
  { value: 'SCHEDULED,QUEUED,PROCESSING', label: 'Na fila' },
  { value: 'PUBLISHED', label: 'Publicadas' },
  { value: 'FAILED,NEEDS_ACTION', label: 'Com erro' },
  { value: 'DRAFT', label: 'Rascunhos' },
  { value: 'CANCELED', label: 'Canceladas' },
];

export function PostsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const platform = (params.get('rede') as Platform | null) ?? undefined;
  const videoId = params.get('video') ?? undefined;
  const openPost = params.get('post');
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: k === 'post' ? false : true });
  };
  const q = usePosts({ status: status || undefined, platform, videoId });
  const list = q.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Publicações"
        description="Acompanhe cada envio, veja o motivo de falhas e tente novamente."
        actions={
          <Link to="/publicar" className="btn btn--ink no-underline">
            <CalendarPlus aria-hidden /> Nova publicação
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="seg scroll-thin max-w-full overflow-x-auto" role="group" aria-label="Filtrar por situação">
          {TABS.map((t) => (
            <button key={t.label} type="button" aria-pressed={status === t.value} onClick={() => set('status', t.value || null)}>
              {t.label}
            </button>
          ))}
        </div>
        <select className="input w-auto" value={platform ?? ''} onChange={(e) => set('rede', e.target.value || null)} aria-label="Filtrar por rede">
          <option value="">Todas as redes</option>
          {PLATFORM_ORDER.map((p) => (
            <option key={p} value={p}>
              {PLATFORMS[p].label}
            </option>
          ))}
        </select>
        {videoId && (
          <button type="button" className="tag text-muted" onClick={() => set('video', null)}>
            Filtrando por vídeo ✕
          </button>
        )}
      </div>

      <div className="sheet overflow-hidden">
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <div className="space-y-px">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 rounded-none" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<ListChecks />}
            title={status ? `Nenhuma publicação ${TABS.find((t) => t.value === status)?.label.toLowerCase() ?? ''}` : 'Nenhuma publicação ainda'}
            body={status ? 'Troque o filtro para ver outras.' : 'Crie a primeira a partir de um vídeo da biblioteca.'}
            action={!status ? <Link to="/publicar" className="btn btn--ink no-underline">Nova publicação</Link> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-rule bg-paper-2 text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Vídeo</th>
                  <th className="px-4 py-2.5 font-medium">Quando</th>
                  <th className="px-4 py-2.5 font-medium">Destinos</th>
                  <th className="px-4 py-2.5 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {list.map((p) => (
                  <tr key={p.id} className="cursor-pointer transition-colors duration-[var(--dur-micro)] hover:bg-paper-2" onClick={() => set('post', p.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <VideoThumb src={p.video.thumbnailUrl} className="w-8 flex-none" showDuration={false} />
                        <button type="button" className="min-w-0 truncate text-left font-medium" onClick={(e) => (e.stopPropagation(), set('post', p.id))}>
                          {p.title || p.video.title}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {p.scheduledAt ? (
                        <>
                          <span className="fig block">{cap(fmt(p.scheduledAt, "EEE dd/MM HH:mm"))}</span>
                          <span className="text-2xs text-muted">{relative(p.scheduledAt)}</span>
                        </>
                      ) : (
                        <span className="text-muted">Sem data</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ul className="flex flex-col gap-1">
                        {p.targets.map((t) => (
                          <li key={t.id} className="flex items-center gap-1.5 text-xs">
                            <PlatformIcon platform={t.platform} size={12} />
                            <span className="max-w-36 truncate text-ink-2">{handle(t.account)}</span>
                            <span style={{ color: STATUS[t.status].color }}>{t.status === 'PUBLISHED' ? <span className="pressed text-2xs">publicado</span> : STATUS[t.status].label.toLowerCase()}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-3">
                      <StatusTag status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <PostDrawer postId={openPost} onClose={() => set('post', null)} />
    </Page>
  );
}
