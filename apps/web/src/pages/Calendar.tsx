import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, addMonths, addWeeks, getHours, getMinutes, isSameMonth } from 'date-fns';
import { ChevronLeft, ChevronRight, FileEdit, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { PostDrawer } from '../components/PostDrawer';
import { Page } from '../components/Shell';
import { Button, ErrorState, Skeleton, useToast } from '../components/ui';
import { VideoThumb } from '../components/VideoThumb';
import { api, ApiError } from '../lib/api';
import { PLATFORM_ORDER, PlatformIcon, PLATFORMS } from '../lib/platforms';
import { keys, useInvalidate, usePosts } from '../lib/queries';
import { STATUS } from '../lib/status';
import { cap, dayKey, fmt, fmtTime, fromWall, monthGrid, nowZoned, parseDayKey, weekDays, zoned } from '../lib/time';
import type { Platform, Post } from '../lib/types';

type View = 'month' | 'week' | 'day';
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const BUSY_DAY = 4;

const movable = (p: Post) => p.targets.every((t) => ['DRAFT', 'SCHEDULED'].includes(t.status) || (t.status === 'QUEUED' && t.attemptCount === 0)) && p.status !== 'CANCELED';

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View) || 'month';
  const anchorKey = params.get('date') ?? dayKey(nowZoned());
  const platform = (params.get('rede') as Platform | null) ?? null;
  const openPost = params.get('post');
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const invalidate = useInvalidate();

  const { y, m, d } = parseDayKey(anchorKey);
  const anchor = useMemo(() => zoned(fromWall(y, m, d, 12)), [y, m, d]);

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: k_isNav(patch) ? false : true });
  };

  // Intervalo visível
  const days = view === 'month' ? monthGrid(anchor) : view === 'week' ? weekDays(anchor) : [anchor];
  const first = days[0];
  const last = days[days.length - 1];
  const from = fromWall(first.getFullYear(), first.getMonth() + 1, first.getDate());
  const to = fromWall(last.getFullYear(), last.getMonth() + 1, last.getDate() + 1);
  const range = { from: from.toISOString(), to: to.toISOString(), ...(platform ? { platform } : {}) };
  const postsQ = usePosts(range);
  const drafts = usePosts({ unscheduled: 'true', status: 'DRAFT' }, false);

  const posts = useMemo(() => (postsQ.data ?? []).filter((p) => p.status !== 'CANCELED' && p.scheduledAt), [postsQ.data]);
  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of posts) {
      const k = dayKey(p.scheduledAt!);
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    for (const list of map.values()) list.sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
    return map;
  }, [posts]);

  const shift = (dir: 1 | -1) => {
    const next = view === 'month' ? addMonths(anchor, dir) : view === 'week' ? addWeeks(anchor, dir) : addDays(anchor, dir);
    setParam({ date: dayKey(next) });
  };

  // ── Arrastar e soltar ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const [dragging, setDragging] = useState<Post | null>(null);
  const allKnown = useMemo(() => [...(postsQ.data ?? []), ...(drafts.data ?? [])], [postsQ.data, drafts.data]);

  const onDragStart = (e: DragStartEvent) => setDragging(allKnown.find((p) => p.id === e.active.id) ?? null);
  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const post = allKnown.find((p) => p.id === e.active.id);
    const over = e.over?.id as string | undefined;
    if (!post || !over) return;
    const [kind, key, hourStr] = over.split('|');
    const { y, m, d } = parseDayKey(key);
    const prev = post.scheduledAt ? zoned(post.scheduledAt) : null;
    const hour = kind === 'slot' ? Number(hourStr) : (prev ? getHours(prev) : 12);
    const minute = prev ? getMinutes(prev) : 0;
    const when = fromWall(y, m, d, hour, minute);
    if (post.scheduledAt && new Date(post.scheduledAt).getTime() === when.getTime()) return;

    // Atualização otimista
    const listKey = keys.posts(range);
    const snapshot = qc.getQueryData<Post[]>(listKey);
    qc.setQueryData<Post[]>(listKey, (old) => {
      const without = (old ?? []).filter((p) => p.id !== post.id);
      return [...without, { ...post, scheduledAt: when.toISOString() }];
    });
    try {
      await api.patch(`/api/posts/${post.id}/schedule`, { scheduledAt: when.toISOString() });
      toast('ok', `Movido para ${fmt(when, "EEE d/MM 'às' HH:mm")}`);
    } catch (err) {
      qc.setQueryData(listKey, snapshot);
      toast('error', (err as ApiError).message);
    } finally {
      invalidate('posts', 'dashboard');
    }
  };

  const title = view === 'day' ? fmt(anchor, "EEEE, d 'de' MMMM") : view === 'week' ? weekTitle(days) : fmt(anchor, "MMMM 'de' yyyy");
  const create = (key: string, hour?: number) => navigate(`/publicar?date=${key}${hour !== undefined ? `&time=${String(hour).padStart(2, '0')}:00` : ''}`);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <Page wide>
        {/* Barra do calendário */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h1 className="mr-auto min-w-0 text-2xl">{cap(title)}</h1>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" icon={<ChevronLeft />} onClick={() => shift(-1)} aria-label="Anterior" />
            <Button size="sm" onClick={() => setParam({ date: dayKey(nowZoned()) })}>
              Hoje
            </Button>
            <Button variant="ghost" size="sm" icon={<ChevronRight />} onClick={() => shift(1)} aria-label="Próximo" />
          </div>
          <div className="seg" role="group" aria-label="Visualização">
            {(['month', 'week', 'day'] as View[]).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setParam({ view: v === 'month' ? null : v })}>
                {v === 'month' ? 'Mês' : v === 'week' ? 'Semana' : 'Dia'}
              </button>
            ))}
          </div>
          <select className="input w-auto" value={platform ?? ''} onChange={(e) => setParam({ rede: e.target.value || null })} aria-label="Filtrar por rede">
            <option value="">Todas as redes</option>
            {PLATFORM_ORDER.map((p) => (
              <option key={p} value={p}>
                {PLATFORMS[p].label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0">
            {postsQ.error ? (
              <ErrorState error={postsQ.error} onRetry={() => postsQ.refetch()} />
            ) : postsQ.isLoading ? (
              <Skeleton className="h-[36rem]" />
            ) : view === 'month' ? (
              <MonthView days={days} anchor={anchor} byDay={byDay} onOpen={(id) => setParam({ post: id })} onCreate={create} />
            ) : (
              <TimeGridView days={days} byDay={byDay} onOpen={(id) => setParam({ post: id })} onCreate={create} compact={view === 'week'} />
            )}
          </div>
          <DraftShelf posts={drafts.data ?? []} loading={drafts.isLoading} onOpen={(id) => setParam({ post: id })} />
        </div>
      </Page>

      <DragOverlay dropAnimation={null}>{dragging ? <PostCard post={dragging} overlay /> : null}</DragOverlay>
      <PostDrawer postId={openPost} onClose={() => setParam({ post: null })} />
    </DndContext>
  );
}

const k_isNav = (patch: Record<string, string | null>) => 'date' in patch || 'view' in patch;

function weekTitle(days: Date[]) {
  const a = days[0];
  const b = days[6];
  return isSameMonth(a, b) ? `${fmt(a, 'd')} a ${fmt(b, "d 'de' MMMM")}` : `${fmt(a, "d 'de' MMM")} a ${fmt(b, "d 'de' MMM")}`;
}

// ── Mês ──────────────────────────────────────────────────────

function MonthView({
  days,
  anchor,
  byDay,
  onOpen,
  onCreate,
}: {
  days: Date[];
  anchor: Date;
  byDay: Map<string, Post[]>;
  onOpen: (id: string) => void;
  onCreate: (key: string) => void;
}) {
  const today = dayKey(nowZoned());
  return (
    <div className="desk overflow-hidden rounded-[var(--radius-card)] shadow-stock">
      <div className="grid grid-cols-7 border-b border-rule bg-paper-2">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISOString()} className="px-2 py-2 text-xs text-muted">
            <span className="hidden sm:inline">{cap(fmt(d, 'EEEE'))}</span>
            <span className="sm:hidden">{cap(fmt(d, 'EEEEE'))}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const key = dayKey(d);
          const list = byDay.get(key) ?? [];
          return <MonthCell key={key} dayKeyStr={key} date={d} posts={list} inMonth={isSameMonth(d, anchor)} isToday={key === today} isPast={key < today} onOpen={onOpen} onCreate={onCreate} />;
        })}
      </div>
    </div>
  );
}

function MonthCell({
  dayKeyStr,
  date,
  posts,
  inMonth,
  isToday,
  isPast,
  onOpen,
  onCreate,
}: {
  dayKeyStr: string;
  date: Date;
  posts: Post[];
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  onOpen: (id: string) => void;
  onCreate: (key: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day|${dayKeyStr}` });
  const busy = posts.length >= BUSY_DAY;
  const empty = posts.length === 0 && !isPast && inMonth;
  const visible = posts.slice(0, 3);
  return (
    <div
      ref={setNodeRef}
      className={`group relative flex min-h-[7.5rem] min-w-0 flex-col gap-1 border-r border-b border-rule p-1 transition-colors duration-[var(--dur-micro)] sm:min-h-[9rem] sm:p-1.5 [&:nth-child(7n)]:border-r-0 ${
        isOver ? 'bg-paper-3' : !inMonth ? 'bg-[color-mix(in_oklch,var(--color-paper-2)_70%,transparent)]' : busy ? 'bg-[color-mix(in_oklch,var(--color-accent)_9%,var(--color-desk))]' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-1 px-0.5">
        <span
          className={`fig inline-flex size-6 items-center justify-center rounded-full text-xs ${
            isToday ? 'bg-board text-board-type' : inMonth ? 'text-ink-2' : 'text-faint'
          }`}
        >
          {fmt(date, 'd')}
        </span>
        {posts.length > 0 ? (
          <span className={`fig text-2xs ${busy ? 'font-medium text-accent-2' : 'text-muted'}`} title={busy ? 'Dia cheio' : undefined}>
            {posts.length}
            <span className="sr-only"> publicações</span>
          </span>
        ) : empty ? (
          <button
            type="button"
            onClick={() => onCreate(dayKeyStr)}
            className="flex size-6 items-center justify-center rounded-[5px] text-faint opacity-60 hover:bg-cotton hover:text-ink hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={`Agendar em ${fmt(date, "d 'de' MMMM")}`}
          >
            <Plus className="size-3.5" />
          </button>
        ) : null}
      </div>
      {empty && <span className="mt-auto hidden px-1 pb-0.5 text-2xs text-faint sm:block">livre</span>}
      <div className="flex min-w-0 flex-col gap-1">
        {visible.map((p) => (
          <DraggablePost key={p.id} post={p} onOpen={onOpen} size="mini" />
        ))}
        {posts.length > visible.length && (
          <a href={`/calendario?view=day&date=${dayKeyStr}`} className="px-1 text-2xs text-muted">
            mais {posts.length - visible.length}
          </a>
        )}
      </div>
    </div>
  );
}

// ── Semana e dia ─────────────────────────────────────────────

function TimeGridView({
  days,
  byDay,
  onOpen,
  onCreate,
  compact,
}: {
  days: Date[];
  byDay: Map<string, Post[]>;
  onOpen: (id: string) => void;
  onCreate: (key: string, hour: number) => void;
  compact: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const today = dayKey(nowZoned());
  const nowHour = getHours(nowZoned());
  useEffect(() => {
    // rola até o primeiro horário com conteúdo (ou 7h)
    const hours = days.flatMap((d) => (byDay.get(dayKey(d)) ?? []).map((p) => getHours(zoned(p.scheduledAt!))));
    const target = Math.max(0, Math.min(7, ...hours) - 1);
    const row = scroller.current?.querySelector<HTMLElement>(`[data-hour="${target}"]`);
    if (row && scroller.current) scroller.current.scrollTop = row.offsetTop - 44;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]?.toISOString()]);

  const cols = `3.5rem repeat(${days.length}, minmax(${compact ? '6.5rem' : '0'}, 1fr))`;
  return (
    <div className="desk overflow-hidden rounded-[var(--radius-card)] shadow-stock">
      <div ref={scroller} className="scroll-thin max-h-[calc(100dvh-12rem)] min-h-[28rem] overflow-auto">
        <div className="min-w-max" style={{ minWidth: compact ? '100%' : undefined }}>
          <div className="sticky top-0 z-10 grid border-b border-rule bg-paper-2" style={{ gridTemplateColumns: cols }}>
            <div />
            {days.map((d) => {
              const key = dayKey(d);
              const count = byDay.get(key)?.length ?? 0;
              return (
                <div key={key} className="flex items-baseline gap-2 border-l border-rule px-2 py-2">
                  <span className="text-xs text-muted">{cap(fmt(d, compact ? 'EEE' : 'EEEE'))}</span>
                  <span className={`fig text-sm ${key === today ? 'rounded-full bg-board px-1.5 text-board-type' : 'text-ink-2'}`}>{fmt(d, 'd')}</span>
                  <span className={`fig ml-auto text-2xs ${count >= BUSY_DAY ? 'text-accent-2' : 'text-faint'}`}>{count || ''}</span>
                </div>
              );
            })}
          </div>
          {HOURS.map((h) => (
            <div key={h} data-hour={h} className="grid" style={{ gridTemplateColumns: cols }}>
              <div className="fig relative -top-2 pr-2 text-right text-2xs text-faint">{h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}</div>
              {days.map((d) => {
                const key = dayKey(d);
                const list = (byDay.get(key) ?? []).filter((p) => getHours(zoned(p.scheduledAt!)) === h);
                const past = key < today || (key === today && h < nowHour);
                return <HourSlot key={key} dayKeyStr={key} hour={h} posts={list} past={past} onOpen={onOpen} onCreate={onCreate} compact={compact} />;
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HourSlot({
  dayKeyStr,
  hour,
  posts,
  past,
  onOpen,
  onCreate,
  compact,
}: {
  dayKeyStr: string;
  hour: number;
  posts: Post[];
  past: boolean;
  onOpen: (id: string) => void;
  onCreate: (key: string, hour: number) => void;
  compact: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot|${dayKeyStr}|${hour}` });
  return (
    <div
      ref={setNodeRef}
      className={`group relative flex min-h-12 min-w-0 flex-col gap-1 border-b border-l border-rule p-1 ${isOver ? 'bg-paper-3' : past ? 'bg-[color-mix(in_oklch,var(--color-paper-2)_55%,transparent)]' : ''}`}
    >
      {posts.map((p) => (
        <DraggablePost key={p.id} post={p} onOpen={onOpen} size={compact ? 'mini' : 'full'} />
      ))}
      {!past && posts.length === 0 && (
        <button
          type="button"
          onClick={() => onCreate(dayKeyStr, hour)}
          className="absolute inset-0 flex items-center justify-center text-faint opacity-0 hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Agendar às ${String(hour).padStart(2, '0')}:00`}
        >
          <Plus className="size-4" />
        </button>
      )}
    </div>
  );
}

// ── Cartões ──────────────────────────────────────────────────

function DraggablePost({ post, onOpen, size }: { post: Post; onOpen: (id: string) => void; size: 'mini' | 'full' }) {
  const canMove = movable(post);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: post.id, disabled: !canMove });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`min-w-0 ${isDragging ? 'opacity-30' : ''}`} style={{ touchAction: canMove ? 'none' : undefined }}>
      <PostCard post={post} size={size} onClick={() => onOpen(post.id)} canMove={canMove} />
    </div>
  );
}

/** Ficha de cartolina: a publicação no calendário */
function PostCard({ post, size = 'mini', onClick, overlay, canMove = true }: { post: Post; size?: 'mini' | 'full'; onClick?: () => void; overlay?: boolean; canMove?: boolean }) {
  const platforms = [...new Set(post.targets.filter((t) => t.status !== 'CANCELED').map((t) => t.platform))];
  const published = post.status === 'PUBLISHED';
  const problem = post.status === 'FAILED' || post.status === 'NEEDS_ACTION';
  const draft = post.status === 'DRAFT';
  const s = STATUS[post.status];
  const name = post.title || post.video.title;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${name} — ${s.label}`}
      className={`relative flex w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-[6px] text-left transition-[transform,box-shadow] duration-[var(--dur-short)] ease-[var(--ease-out)] ${
        draft ? 'border border-dashed border-rule-2 bg-[color-mix(in_oklch,var(--color-cotton)_60%,transparent)]' : 'stock'
      } ${overlay ? 'rotate-[-2deg] shadow-lift' : canMove ? 'cursor-grab hover:-translate-y-px hover:shadow-lift active:cursor-grabbing' : ''} ${size === 'full' ? 'p-1.5' : 'py-1 pr-1.5 pl-1'}`}
    >
      {problem && <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: s.color }} aria-hidden />}
      {size === 'full' && <VideoThumb src={post.video.thumbnailUrl} className="w-9 flex-none" showDuration={false} />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          {post.scheduledAt && <span className="fig text-[0.6875rem] text-muted">{fmtTime(post.scheduledAt)}</span>}
          <span className="flex items-center gap-0.5">
            {platforms.map((p) => (
              <PlatformIcon key={p} platform={p} size={10} aria-label={PLATFORMS[p].label} />
            ))}
          </span>
          {published && <span className="pressed ml-auto text-[0.625rem] leading-none">publicado</span>}
          {draft && <FileEdit className="ml-auto size-3 text-faint" aria-label="Rascunho" />}
        </span>
        <span className={`block truncate text-[0.75rem] leading-tight ${problem ? 'text-danger' : 'text-ink'} ${size === 'full' ? 'mt-0.5 text-xs font-medium' : ''}`}>{name}</span>
        {size === 'full' && <span className="block text-2xs" style={{ color: s.color }}>{s.label}</span>}
      </span>
    </button>
  );
}

function DraftShelf({ posts, loading, onOpen }: { posts: Post[]; loading: boolean; onOpen: (id: string) => void }) {
  return (
    <aside className="sheet h-fit p-4" aria-labelledby="drafts-h">
      <h2 id="drafts-h" className="text-sm font-semibold tracking-normal">
        Rascunhos sem data
      </h2>
      <p className="mt-0.5 mb-3 text-xs text-muted">Arraste para um dia do calendário.</p>
      {loading ? (
        <Skeleton className="h-16" />
      ) : posts.length === 0 ? (
        <p className="text-xs text-faint">Nenhum rascunho pendente.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {posts.map((p) => (
            <DraggablePost key={p.id} post={p} onOpen={onOpen} size="full" />
          ))}
        </div>
      )}
    </aside>
  );
}
