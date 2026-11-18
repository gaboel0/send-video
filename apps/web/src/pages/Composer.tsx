import { AlertTriangle, ArrowLeft, CalendarClock, Check, Copy, Film, Info, Plug, Search, Send, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { HashtagInput } from '../components/HashtagInput';
import { PlatformOptions } from '../components/PlatformOptions';
import { Page } from '../components/Shell';
import { Avatar, Button, Dialog, EmptyState, ErrorState, Field, Skeleton, useConfirm, useToast } from '../components/ui';
import { useUploads } from '../components/Uploads';
import { VideoThumb } from '../components/VideoThumb';
import { api, ApiError } from '../lib/api';
import { handle, PLATFORM_ORDER, PlatformIcon, PLATFORMS } from '../lib/platforms';
import { useAccounts, useIntegrations, useInvalidate, usePost, useVideos } from '../lib/queries';
import { StatusTag } from '../lib/status';
import { addDaysWall, cap, fmtLong, formatBytes, formatDuration, fromInputs, toDateInput, toTimeInput } from '../lib/time';
import type { Issue, Platform, SocialAccount, Video } from '../lib/types';

type Draft = { accountId: string; caption: string; hashtags: string[]; options: Record<string, any> };
type AccountInfo = SocialAccount & { scopes: string[] };

const CAPTION_MAX: Record<Platform, number> = { TIKTOK: 2200, INSTAGRAM: 2200, FACEBOOK: 63206 };
const TAG_MAX: Partial<Record<Platform, number>> = { INSTAGRAM: 30 };

export function ComposerPage() {
  const { postId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();

  const accountsQ = useAccounts();
  const integrations = useIntegrations();
  const existing = usePost(postId);
  const videosQ = useVideos({});

  const [videoId, setVideoId] = useState<string | null>(params.get('video'));
  const [title, setTitle] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [date, setDate] = useState(() => params.get('date') ?? toDateInput(addDaysWall(1)));
  const [time, setTime] = useState(() => params.get('time') ?? '12:00');
  const [picker, setPicker] = useState(false);
  const [issues, setIssues] = useState<{ issues: Record<string, Issue[]>; general: Issue[] }>({ issues: {}, general: [] });
  const [busy, setBusy] = useState<null | 'draft' | 'schedule' | 'publish_now'>(null);
  const loaded = useRef(false);

  // Carrega publicação existente
  useEffect(() => {
    const p = existing.data;
    if (!p || loaded.current) return;
    loaded.current = true;
    setVideoId(p.video.id);
    setTitle(p.title);
    setDrafts(p.targets.filter((t) => t.status !== 'CANCELED').map((t) => ({ accountId: t.accountId, caption: t.caption, hashtags: t.hashtags, options: t.options ?? {} })));
    setActive(p.targets[0]?.accountId ?? null);
    if (p.scheduledAt) {
      setDate(toDateInput(p.scheduledAt));
      setTime(toTimeInput(p.scheduledAt));
    }
  }, [existing.data]);

  const accounts: AccountInfo[] = useMemo(
    () =>
      (accountsQ.data ?? []).flatMap((c) => c.accounts.filter((a) => a.status !== 'REVOKED' && a.enabled).map((a) => ({ ...a, scopes: c.scopes }))),
    [accountsQ.data],
  );
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const video = videosQ.data?.find((v) => v.id === videoId) ?? (existing.data?.video.id === videoId ? existing.data?.video : undefined);
  const lockedTargets = existing.data?.targets.filter((t) => ['PROCESSING', 'PUBLISHED'].includes(t.status)) ?? [];
  const isLocked = (accountId: string) => lockedTargets.some((t) => t.accountId === accountId);

  const scheduledAt = useMemo(() => {
    try {
      return fromInputs(date, time);
    } catch {
      return null;
    }
  }, [date, time]);

  const body = (action: 'draft' | 'schedule' | 'publish_now') => ({
    videoId,
    title,
    scheduledAt: scheduledAt?.toISOString() ?? null,
    action,
    targets: drafts.map((d) => ({ accountId: d.accountId, caption: d.caption, hashtags: d.hashtags, options: d.options })),
  });

  // Validação ao vivo (debounced) contra as regras do servidor
  useEffect(() => {
    if (!videoId || drafts.length === 0) {
      setIssues({ issues: {}, general: [] });
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.post<{ issues: Record<string, Issue[]>; general: Issue[] }>('/api/posts/validate', body('schedule'));
        setIssues(res);
      } catch {
        /* validação é auxiliar */
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, drafts, date, time]);

  const toggleAccount = (a: AccountInfo) => {
    if (isLocked(a.id)) return;
    const exists = drafts.find((d) => d.accountId === a.id);
    if (exists) {
      const next = drafts.filter((d) => d.accountId !== a.id);
      setDrafts(next);
      if (active === a.id) setActive(next[0]?.accountId ?? null);
      return;
    }
    // Começa com a legenda da aba aberta para agilizar; depois cada rede é independente
    const base = drafts.find((d) => d.accountId === active);
    const defaultOptions: Record<string, any> = a.platform === 'FACEBOOK' ? { format: (video?.durationSec ?? 0) > 90 ? 'VIDEO' : 'REEL' } : a.platform === 'INSTAGRAM' ? { shareToFeed: true } : {};
    setDrafts([...drafts, { accountId: a.id, caption: base?.caption ?? '', hashtags: base?.hashtags ?? [], options: defaultOptions }]);
    setActive(a.id);
  };

  const update = (accountId: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.accountId === accountId ? { ...d, ...patch } : d)));

  const copyToAll = (from: Draft) => {
    setDrafts((list) => list.map((d) => (isLocked(d.accountId) ? d : { ...d, caption: from.caption, hashtags: [...from.hashtags] })));
    toast('info', 'Legenda e hashtags copiadas para todas as redes');
  };

  const submit = async (action: 'draft' | 'schedule' | 'publish_now') => {
    if (!videoId) return toast('error', 'Escolha um vídeo');
    if (action === 'publish_now') {
      const ok = await confirm({
        title: 'Publicar agora?',
        body: `O vídeo será enviado imediatamente para ${drafts.length} conta${drafts.length > 1 ? 's' : ''}.`,
        confirm: 'Publicar agora',
      });
      if (!ok) return;
    }
    setBusy(action);
    try {
      const res = postId ? await api.put<{ id: string }>(`/api/posts/${postId}`, body(action)) : await api.post<{ id: string }>('/api/posts', body(action));
      await invalidate('posts', 'dashboard', 'videos', 'post');
      toast('ok', action === 'draft' ? 'Rascunho salvo' : action === 'publish_now' ? 'Enviado para publicação' : `Agendado para ${fmtLong(scheduledAt!)}`);
      navigate(action === 'draft' ? `/publicacoes?post=${res.id}` : `/calendario?date=${date}&post=${res.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.details?.issues) {
        setIssues({ issues: err.details.issues, general: err.details.general ?? [] });
        const first = Object.entries(err.details.issues as Record<string, Issue[]>).find(([, l]) => l.some((i) => i.level === 'error'));
        if (first) setActive(first[0]);
      }
      toast('error', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const errorsFor = (id: string) => (issues.issues[id] ?? []).filter((i) => i.level === 'error');
  const totalErrors = Object.values(issues.issues).flat().filter((i) => i.level === 'error').length + issues.general.filter((i) => i.level === 'error').length;
  const activeDraft = drafts.find((d) => d.accountId === active) ?? null;
  const activeAccount = active ? byId.get(active) : undefined;

  if (postId && existing.error) return <Page><ErrorState error={existing.error} onRetry={() => existing.refetch()} /></Page>;

  return (
    <div className="pb-24">
      <Page>
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={() => navigate(-1)} aria-label="Voltar" />
          <div className="min-w-0">
            <h1 className="text-2xl">{postId ? 'Editar publicação' : 'Nova publicação'}</h1>
            {existing.data && (
              <div className="mt-1">
                <StatusTag status={existing.data.status} />
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            {/* 1. Vídeo */}
            <section className="sheet p-5" aria-labelledby="s-video">
              <h2 id="s-video" className="mb-4 text-md">
                Vídeo
              </h2>
              {videoId && !video && videosQ.isLoading ? (
                <Skeleton className="h-24" />
              ) : video ? (
                <div className="flex items-center gap-4">
                  <VideoThumb src={video.thumbnailUrl} duration={video.durationSec} className="w-16 flex-none" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{video.title}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span className="fig">{formatDuration(video.durationSec)}</span>
                      {video.width && video.height && <span className="fig">{video.width}×{video.height}</span>}
                      <span className="fig">{formatBytes(video.sizeBytes)}</span>
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setPicker(true)} disabled={lockedTargets.length > 0}>
                    Trocar
                  </Button>
                </div>
              ) : (
                <button type="button" onClick={() => setPicker(true)} className="flex w-full items-center gap-4 rounded-[var(--radius-card)] border border-dashed border-rule-2 p-4 text-left hover:bg-paper-2">
                  <span className="flex aspect-[9/16] w-12 items-center justify-center rounded-[var(--radius-input)] bg-paper-3 text-faint">
                    <Film className="size-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-medium">Escolher vídeo da biblioteca</span>
                    <span className="text-sm text-muted">O mesmo vídeo pode ir para várias redes, com legendas diferentes.</span>
                  </span>
                </button>
              )}
              <Field label="Nome interno (opcional)" htmlFor="p-title" className="mt-4" hint="Ajuda a achar a publicação no calendário. Não é publicado.">
                <input id="p-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={video?.title ?? 'Ex.: Dica de segunda'} maxLength={200} />
              </Field>
            </section>

            {/* 2. Contas */}
            <section className="sheet p-5" aria-labelledby="s-accounts">
              <h2 id="s-accounts" className="mb-1 text-md">
                Onde publicar
              </h2>
              <p className="mb-4 text-sm text-muted">Selecione uma ou mais contas.</p>
              {accountsQ.isLoading ? (
                <Skeleton className="h-14" />
              ) : accounts.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-input)] bg-paper-2 p-4">
                  <Plug className="size-5 text-muted" aria-hidden />
                  <p className="flex-1 text-sm text-ink-2">Nenhuma conta conectada ainda.</p>
                  <Link to="/contas" className="btn btn--card btn--sm no-underline">
                    Conectar contas
                  </Link>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {PLATFORM_ORDER.flatMap((p) => accounts.filter((a) => a.platform === p)).map((a) => {
                    const selected = drafts.some((d) => d.accountId === a.id);
                    const locked = isLocked(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleAccount(a)}
                        aria-pressed={selected}
                        disabled={locked}
                        className={`flex min-h-12 items-center gap-2.5 rounded-[var(--radius-card)] py-1.5 pr-3.5 pl-1.5 text-left transition-[box-shadow,background-color] duration-[var(--dur-short)] ${
                          selected ? 'bg-cotton shadow-lift' : 'bg-paper-2 opacity-80 hover:opacity-100'
                        } ${locked ? 'cursor-not-allowed' : ''}`}
                      >
                        <span className="relative">
                          <Avatar src={a.avatarUrl} name={a.name} size={34} />
                          <span className="absolute -right-1 -bottom-1 rounded-full bg-cotton p-0.5 shadow-stock">
                            <PlatformIcon platform={a.platform} size={11} />
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span className="block max-w-40 truncate text-sm font-medium">{handle(a)}</span>
                          <span className="block text-2xs text-muted">
                            {a.status !== 'ACTIVE' ? <span className="text-warn">Reconectar</span> : locked ? 'Já publicado' : PLATFORMS[a.platform].formatLabel}
                          </span>
                        </span>
                        <span className={`ml-1 flex size-4 items-center justify-center rounded-[4px] border ${selected ? 'border-ink bg-ink text-paper' : 'border-rule-2'}`} aria-hidden>
                          {selected && <Check className="size-3" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 3. Legendas por rede */}
            {drafts.length > 0 && (
              <section className="sheet" aria-labelledby="s-captions">
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
                  <h2 id="s-captions" className="text-md">
                    Legenda e opções por rede
                  </h2>
                  {activeDraft && drafts.length > 1 && (
                    <Button variant="ghost" size="sm" icon={<Copy />} onClick={() => copyToAll(activeDraft)}>
                      Copiar esta legenda para todas
                    </Button>
                  )}
                </div>
                <div role="tablist" aria-label="Redes selecionadas" className="scroll-thin mt-3 flex gap-1 overflow-x-auto border-b border-rule px-4">
                  {drafts.map((d) => {
                    const a = byId.get(d.accountId);
                    if (!a) return null;
                    const errs = errorsFor(d.accountId).length;
                    return (
                      <button
                        key={d.accountId}
                        role="tab"
                        type="button"
                        aria-selected={active === d.accountId}
                        onClick={() => setActive(d.accountId)}
                        className={`-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm whitespace-nowrap ${
                          active === d.accountId ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'
                        }`}
                      >
                        <PlatformIcon platform={a.platform} size={14} />
                        {handle(a)}
                        {errs > 0 && (
                          <span className="fig inline-flex size-4.5 items-center justify-center rounded-full border border-danger text-[0.625rem] text-danger" aria-label={`${errs} problema(s)`}>
                            {errs}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {activeDraft && activeAccount && (
                  <div role="tabpanel" className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]" key={activeDraft.accountId}>
                    <div className="min-w-0 space-y-4">
                      {isLocked(activeDraft.accountId) && (
                        <p className="flex items-center gap-2 rounded-[var(--radius-input)] bg-paper-2 px-3 py-2 text-sm text-ink-2">
                          <Info className="size-4 text-muted" aria-hidden /> Já publicado nesta conta. Não é possível editar.
                        </p>
                      )}
                      <Field label={`Legenda para ${PLATFORMS[activeAccount.platform].label}`} htmlFor="caption">
                        <textarea
                          id="caption"
                          className="input"
                          rows={6}
                          value={activeDraft.caption}
                          disabled={isLocked(activeDraft.accountId) || (activeAccount.platform === 'TIKTOK' && activeDraft.options.mode === 'inbox')}
                          onChange={(e) => update(activeDraft.accountId, { caption: e.target.value })}
                          placeholder="Escreva a legenda desta rede"
                        />
                        <CaptionCounter draft={activeDraft} platform={activeAccount.platform} />
                      </Field>
                      <Field label="Hashtags" htmlFor="tags" hint={TAG_MAX[activeAccount.platform] ? `Máximo de ${TAG_MAX[activeAccount.platform]} no ${PLATFORMS[activeAccount.platform].label}.` : 'Adicionadas ao fim da legenda.'}>
                        <HashtagInput id="tags" value={activeDraft.hashtags} max={TAG_MAX[activeAccount.platform]} onChange={(hashtags) => update(activeDraft.accountId, { hashtags })} />
                      </Field>
                      <div className="border-t border-rule pt-4">
                        <h3 className="mb-3 text-sm font-semibold tracking-normal">Opções do {PLATFORMS[activeAccount.platform].label}</h3>
                        <PlatformOptions
                          platform={activeAccount.platform}
                          options={activeDraft.options}
                          onChange={(options) => update(activeDraft.accountId, { options })}
                          creator={activeAccount.metadata?.creatorInfo}
                          canDirect={activeAccount.scopes.includes('video.publish')}
                          canInbox={activeAccount.scopes.includes('video.upload')}
                          defaultMode={integrations.data?.tiktok.postMode ?? 'direct'}
                          errorFields={new Set(errorsFor(activeDraft.accountId).map((i) => i.field ?? ''))}
                        />
                      </div>
                      <IssueList list={issues.issues[activeDraft.accountId] ?? []} />
                    </div>
                    <Preview video={video} account={activeAccount} draft={activeDraft} />
                  </div>
                )}
              </section>
            )}
          </div>

          {/* 4. Quando */}
          <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start">
            <section className="sheet p-5" aria-labelledby="s-when">
              <h2 id="s-when" className="mb-4 text-md">
                Quando publicar
              </h2>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
                <Field label="Data" htmlFor="date">
                  <input id="date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Horário" htmlFor="time">
                  <input id="time" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} step={60} />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[
                  ['Hoje 18h', 0, '18:00'],
                  ['Amanhã 12h', 1, '12:00'],
                  ['Amanhã 19h', 1, '19:00'],
                ].map(([label, days, t]) => (
                  <button
                    key={label as string}
                    type="button"
                    onClick={() => (setDate(toDateInput(addDaysWall(days as number))), setTime(t as string))}
                    className="h-7 rounded-[6px] bg-paper-2 px-2 text-xs text-ink-2 hover:bg-paper-3"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">{scheduledAt ? cap(fmtLong(scheduledAt)) : 'Data inválida'} (horário de Brasília)</p>
              <IssueList list={issues.general} />
              {totalErrors > 0 && drafts.length > 0 && (
                <p className="mt-3 flex items-start gap-2 text-xs text-danger">
                  <AlertTriangle className="mt-px size-3.5 flex-none" aria-hidden />
                  {totalErrors} item{totalErrors > 1 ? 's' : ''} a corrigir antes de agendar
                </p>
              )}
            </section>
          </aside>
        </div>
      </Page>

      {/* Barra de ações */}
      <div className="fixed right-0 bottom-0 left-0 z-30 border-t border-rule bg-[color-mix(in_oklch,var(--color-paper)_92%,transparent)] backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <p className="mr-auto hidden text-xs text-muted sm:block">
            {drafts.length === 0 ? 'Selecione ao menos uma conta' : `${drafts.length} conta${drafts.length > 1 ? 's' : ''} selecionada${drafts.length > 1 ? 's' : ''}`}
          </p>
          <Button variant="ghost" busy={busy === 'draft'} disabled={!videoId || !!busy} onClick={() => submit('draft')}>
            <span className="sm:hidden">Rascunho</span>
            <span className="hidden sm:inline">Salvar rascunho</span>
          </Button>
          <Button busy={busy === 'publish_now'} disabled={!videoId || drafts.length === 0 || totalErrors > 0 || !!busy} onClick={() => submit('publish_now')} icon={<Send />} aria-label="Publicar agora">
            <span className="hidden sm:inline">Publicar agora</span>
          </Button>
          <Button variant="ink" busy={busy === 'schedule'} disabled={!videoId || drafts.length === 0 || totalErrors > 0 || !!busy} onClick={() => submit('schedule')} icon={<CalendarClock />}>
            Agendar
          </Button>
        </div>
      </div>

      <VideoPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(v) => {
          setVideoId(v.id);
          setPicker(false);
          setDrafts((list) => list.map((d) => (byId.get(d.accountId)?.platform === 'FACEBOOK' && !d.options.formatTouched ? { ...d, options: { ...d.options, format: (v.durationSec ?? 0) > 90 ? 'VIDEO' : 'REEL' } } : d)));
        }}
      />
    </div>
  );
}

function CaptionCounter({ draft, platform }: { draft: Draft; platform: Platform }) {
  const full = [draft.caption.trim(), draft.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');
  const max = CAPTION_MAX[platform];
  const over = full.length > max;
  return (
    <p className={`fig mt-1.5 text-right text-2xs ${over ? 'text-danger' : 'text-muted'}`} aria-live="polite">
      {full.length.toLocaleString('pt-BR')} / {max.toLocaleString('pt-BR')}
    </p>
  );
}

function IssueList({ list }: { list: Issue[] }) {
  if (!list.length) return null;
  return (
    <ul className="mt-3 space-y-1.5">
      {list.map((i, n) => (
        <li key={n} className={`flex items-start gap-2 text-xs ${i.level === 'error' ? 'text-danger' : 'text-warn'}`}>
          <AlertTriangle className="mt-px size-3.5 flex-none" aria-hidden />
          {i.message}
        </li>
      ))}
    </ul>
  );
}

/** Prévia: o vídeo no formato da rede com a legenda sobreposta como aparece no app */
function Preview({ video, account, draft }: { video?: Video; account: AccountInfo; draft: Draft }) {
  const caption = [draft.caption.trim(), draft.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join(' ');
  const isFbVideo = account.platform === 'FACEBOOK' && draft.options.format === 'VIDEO';
  return (
    <div className="min-w-0">
      <p className="label">Prévia</p>
      <div className={`relative mx-auto overflow-hidden rounded-[14px] bg-board shadow-lift ${isFbVideo ? 'aspect-video w-full' : 'aspect-[9/16] w-full max-w-[16rem]'}`}>
        {video ? (
          <video key={video.id} src={video.streamUrl} poster={video.thumbnailUrl ?? undefined} muted loop autoPlay playsInline preload="metadata" className="absolute inset-0 size-full object-cover motion-reduce:hidden" />
        ) : null}
        {video?.thumbnailUrl && <img src={video.thumbnailUrl} alt="" className="absolute inset-0 hidden size-full object-cover motion-reduce:block" />}
        {!video && <div className="absolute inset-0 flex items-center justify-center text-sm text-board-type/60">Sem vídeo</div>}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[color-mix(in_oklch,var(--color-board)_80%,transparent)] to-transparent p-3 pt-12 text-board-type dark:from-[color-mix(in_oklch,var(--color-board-type)_85%,transparent)] dark:text-board">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <PlatformIcon platform={account.platform} size={12} style={{ color: 'currentColor' }} />
            {handle(account)}
          </p>
          <p className="mt-1 line-clamp-3 text-[0.6875rem] leading-snug opacity-90">{caption || 'Sua legenda aparece aqui.'}</p>
        </div>
      </div>
    </div>
  );
}

function VideoPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (v: Video) => void }) {
  const [q, setQ] = useState('');
  const videos = useVideos({ search: q || undefined });
  const { add } = useUploads();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onClose={onClose} title="Escolher vídeo" width="max-w-4xl">
      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input className="input pl-9" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar vídeos" autoFocus />
        </div>
        <input ref={input} type="file" hidden multiple accept="video/mp4,video/quicktime,video/webm" onChange={(e) => (e.target.files && add(Array.from(e.target.files)), (e.target.value = ''))} />
        <Button icon={<Upload />} onClick={() => input.current?.click()}>
          Enviar
        </Button>
      </div>
      {videos.isLoading ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="aspect-[9/16]" />
          ))}
        </div>
      ) : !videos.data?.length ? (
        <EmptyState icon={<Film />} title={q ? 'Nada encontrado' : 'Biblioteca vazia'} body={q ? 'Tente outro termo.' : 'Envie um vídeo para começar.'} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8rem),1fr))] gap-3">
          {videos.data.map((v) => (
            <li key={v.id}>
              <button type="button" onClick={() => onPick(v)} className="block w-full rounded-[var(--radius-card)] text-left hover:opacity-90">
                <VideoThumb src={v.thumbnailUrl} duration={v.durationSec} className="w-full rounded-[var(--radius-card)] shadow-stock" />
                <span className="mt-1.5 block truncate text-xs font-medium">{v.title}</span>
                {v.usage.total > 0 && <span className="block text-2xs text-muted">usado {v.usage.total}×</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
