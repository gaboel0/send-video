import { CalendarPlus, Film, Plug, Upload } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Page } from '../components/Shell';
import { Avatar, Button, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { VideoThumb } from '../components/VideoThumb';
import { handle, PLATFORM_ORDER, PlatformIcon, PLATFORMS } from '../lib/platforms';
import { useDashboard } from '../lib/queries';
import { StatusTag } from '../lib/status';
import { cap, dayKey, fmt, fmtTime, nowZoned, parseDayKey, relative } from '../lib/time';
import type { Activity, Dashboard } from '../lib/types';

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useDashboard();
  const navigate = useNavigate();

  return (
    <Page>
      <PageHeader
        title="Painel"
        description={
          data?.nextAt ? (
            <>
              Próxima publicação {relative(data.nextAt)}, às <span className="fig">{fmtTime(data.nextAt)}</span>.
            </>
          ) : data ? (
            'Nenhuma publicação agendada no momento.'
          ) : (
            ' '
          )
        }
        actions={
          <>
            <Button icon={<Upload />} onClick={() => navigate('/biblioteca?upload=1')}>
              Enviar vídeos
            </Button>
            <Button variant="ink" icon={<CalendarPlus />} onClick={() => navigate('/publicar')}>
              Agendar
            </Button>
          </>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-6">
          <StatStrip data={data} loading={isLoading} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 space-y-6">
              <WeekBoard data={data} loading={isLoading} />
              <Upcoming data={data} loading={isLoading} />
            </div>
            <div className="min-w-0 space-y-6">
              <Accounts data={data} loading={isLoading} />
              <ActivityFeed items={data?.activity} loading={isLoading} />
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

function StatStrip({ data, loading }: { data?: Dashboard; loading: boolean }) {
  const s = data?.stats;
  const items = [
    { label: 'Vídeos na biblioteca', value: s?.videos, to: '/biblioteca' },
    { label: 'Agendadas', value: s?.scheduled, to: '/publicacoes?status=SCHEDULED,QUEUED,PROCESSING' },
    { label: 'Publicadas', value: s?.published, to: '/publicacoes?status=PUBLISHED' },
    { label: 'Com erro', value: s ? s.failed + s.needsAction : undefined, to: '/publicacoes?status=FAILED,NEEDS_ACTION', alert: !!s && s.failed + s.needsAction > 0 },
  ];
  return (
    <section aria-label="Resumo" className="sheet grid grid-cols-2 divide-rule md:grid-cols-4 md:divide-x [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-rule md:[&>*:nth-child(-n+2)]:border-b-0">
      {items.map((it) => (
        <Link key={it.label} to={it.to} className="group block px-5 py-4 no-underline transition-colors duration-[var(--dur-micro)] hover:bg-paper-2">
          <p className="text-xs text-muted">{it.label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-14" />
          ) : (
            <p className={`fig mt-1 text-[1.75rem] leading-tight ${it.alert ? 'text-danger' : 'text-ink'}`}>{it.value ?? 0}</p>
          )}
        </Link>
      ))}
    </section>
  );
}

function WeekBoard({ data, loading }: { data?: Dashboard; loading: boolean }) {
  const today = dayKey(nowZoned());
  const max = Math.max(4, ...(data?.week.days.map((d) => d.total) ?? [0]));
  return (
    <section className="sheet p-5" aria-labelledby="week-h">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="week-h" className="text-md">
          Esta semana
        </h2>
        <Link to="/calendario?view=week" className="text-xs text-muted">
          Abrir calendário
        </Link>
      </div>
      <ol className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {(loading ? Array.from({ length: 7 }, () => null) : data!.week.days).map((d, i) => {
          if (!d) return <Skeleton key={i} className="h-36" />;
          const { y, m, d: day } = parseDayKey(d.date);
          const date = new Date(Date.UTC(y, m - 1, day, 15));
          const isToday = d.date === today;
          const empty = d.total === 0;
          return (
            <li key={d.date}>
              <Link
                to={`/calendario?view=day&date=${d.date}`}
                className={`flex h-36 flex-col rounded-[var(--radius-input)] p-2 no-underline transition-colors duration-[var(--dur-micro)] sm:p-2.5 ${
                  isToday ? 'bg-cotton shadow-stock' : empty ? 'border border-dashed border-rule-2 hover:bg-paper-2' : 'bg-paper-2 hover:bg-paper-3'
                }`}
                aria-label={`${fmt(date, "EEEE, d 'de' MMMM")}: ${d.total} publicações`}
              >
                <span className="text-2xs text-muted">{cap(fmt(date, 'EEE'))}</span>
                <span className={`fig text-md ${isToday ? 'text-ink' : 'text-ink-2'}`}>{fmt(date, 'd')}</span>
                <div className="mt-auto flex flex-col gap-1">
                  {empty ? (
                    <span className="text-2xs text-faint">vazio</span>
                  ) : (
                    <>
                      <div className="flex h-12 items-end gap-[3px]" aria-hidden>
                        {PLATFORM_ORDER.map((p) => (
                          <span
                            key={p}
                            className="w-full rounded-t-[2px]"
                            style={{ height: `${(d.platforms[p] / max) * 100}%`, minHeight: d.platforms[p] ? 4 : 0, background: PLATFORMS[p].color }}
                          />
                        ))}
                      </div>
                      <span className="fig text-2xs text-muted">
                        {d.total} {d.published > 0 && <span className="pressed text-2xs">{d.published}✓</span>}
                        {d.failed > 0 && <span className="text-danger"> {d.failed}!</span>}
                      </span>
                    </>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap gap-4 text-2xs text-muted">
        {PLATFORM_ORDER.map((p) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: PLATFORMS[p].color }} aria-hidden />
            {PLATFORMS[p].label}
          </span>
        ))}
      </div>
    </section>
  );
}

function Upcoming({ data, loading }: { data?: Dashboard; loading: boolean }) {
  return (
    <section className="sheet" aria-labelledby="up-h">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-5 pb-3">
        <h2 id="up-h" className="text-md">
          Próximas publicações
        </h2>
        <Link to="/publicacoes?status=SCHEDULED,QUEUED,PROCESSING" className="text-xs text-muted">
          Ver fila
        </Link>
      </div>
      {loading ? (
        <div className="space-y-3 px-5 pb-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : data!.upcoming.length === 0 ? (
        <EmptyState
          icon={<CalendarPlus />}
          title="Nada na fila"
          body="Escolha um vídeo da biblioteca, escreva as legendas e defina o horário."
          action={
            <Link to="/publicar" className="btn btn--ink no-underline">
              Agendar publicação
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-rule">
          {data!.upcoming.map((p) => (
            <li key={p.id}>
              <Link to={`/publicacoes?post=${p.id}`} className="flex items-center gap-4 px-5 py-3 no-underline transition-colors duration-[var(--dur-micro)] hover:bg-paper-2">
                <VideoThumb src={p.thumbnailUrl} duration={null} className="w-9 flex-none" showDuration={false} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <span className="fig">{cap(fmt(p.scheduledAt, "EEE d/MM, HH:mm"))}</span>
                    <span className="flex items-center gap-1">
                      {p.targets.map((t) => (
                        <PlatformIcon key={t.id} platform={t.platform} size={13} aria-label={`${PLATFORMS[t.platform].label} ${handle(t.account)}`} />
                      ))}
                    </span>
                  </p>
                </div>
                <StatusTag status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Accounts({ data, loading }: { data?: Dashboard; loading: boolean }) {
  return (
    <section className="sheet p-5" aria-labelledby="acc-h">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="acc-h" className="text-md">
          Contas conectadas
        </h2>
        <Link to="/contas" className="text-xs text-muted">
          Gerenciar
        </Link>
      </div>
      {loading ? (
        <Skeleton className="h-24" />
      ) : data!.accounts.length === 0 ? (
        <div className="py-2">
          <p className="text-sm text-muted">Conecte TikTok, Instagram ou Facebook para começar a publicar.</p>
          <Link to="/contas" className="btn btn--card btn--sm mt-3 no-underline">
            <Plug aria-hidden /> Conectar contas
          </Link>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {data!.accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              <div className="relative">
                <Avatar src={a.avatarUrl} name={a.name} size={32} />
                <span className="absolute -right-1 -bottom-1 rounded-full bg-cotton p-0.5 shadow-stock">
                  <PlatformIcon platform={a.platform} size={11} />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{handle(a)}</p>
                <p className="text-2xs text-muted">{PLATFORMS[a.platform].label}</p>
              </div>
              {a.status !== 'ACTIVE' && (
                <Link to="/contas" className="tag no-underline" style={{ color: 'var(--color-warn)' }}>
                  Reconectar
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const LEVEL_COLOR: Record<Activity['level'], string> = {
  INFO: 'var(--color-rule-2)',
  SUCCESS: 'var(--color-paid)',
  WARNING: 'var(--color-warn)',
  ERROR: 'var(--color-danger)',
};

export function ActivityFeed({ items, loading, title = 'Atividade recente' }: { items?: Activity[]; loading: boolean; title?: string }) {
  return (
    <section className="sheet p-5" aria-labelledby="act-h">
      <h2 id="act-h" className="mb-3 text-md">
        {title}
      </h2>
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : !items?.length ? (
        <p className="py-4 text-sm text-muted">
          <Film className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
          O histórico aparece aqui conforme você agenda e publica.
        </p>
      ) : (
        <ol className="relative space-y-3.5 border-l border-rule pl-4">
          {items.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full ring-2 ring-cotton" style={{ background: LEVEL_COLOR[a.level] }} aria-hidden />
              <p className="text-sm leading-snug text-ink-2">
                {a.postId ? (
                  <Link to={`/publicacoes?post=${a.postId}`} className="no-underline hover:underline">
                    {a.message}
                  </Link>
                ) : (
                  a.message
                )}
              </p>
              <p className="mt-0.5 text-2xs text-muted">{relative(a.createdAt)}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
