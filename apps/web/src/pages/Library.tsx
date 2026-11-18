import { CalendarPlus, Folder as FolderIcon, FolderPlus, MoreHorizontal, Pencil, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Page } from '../components/Shell';
import { Button, Dialog, EmptyState, ErrorState, Field, PageHeader, Skeleton, useConfirm, useToast } from '../components/ui';
import { useUploads } from '../components/Uploads';
import { VideoThumb } from '../components/VideoThumb';
import { api, ApiError } from '../lib/api';
import { useFolders, useInvalidate, useVideos } from '../lib/queries';
import { StatusTag } from '../lib/status';
import { fmtDay, formatBytes, formatDuration } from '../lib/time';
import type { Folder, PublishStatus, Video } from '../lib/types';

const FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'unused', label: 'Não usados' },
  { value: 'scheduled', label: 'Agendados' },
  { value: 'published', label: 'Publicados' },
  { value: 'attention', label: 'Com erro' },
];

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const folderId = params.get('pasta') ?? '';
  const status = params.get('status') ?? '';
  const sort = params.get('ordem') ?? 'recent';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const videos = useVideos({ search: debounced || undefined, folderId: folderId || undefined, status: status || undefined, sort });
  const folders = useFolders();
  const { add } = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<Folder | 'new' | null>(null);

  useEffect(() => {
    if (params.get('upload') === '1') {
      fileInput.current?.click();
      set('upload', '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (files: FileList | null) => {
    if (!files?.length) return;
    add(Array.from(files), folderId && folderId !== 'none' ? folderId : undefined);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  };

  const opened = videos.data?.find((v) => v.id === openId) ?? null;
  const currentFolder = folders.data?.folders.find((f) => f.id === folderId);

  return (
    <div
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
      className="relative min-h-dvh"
    >
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-[color-mix(in_oklch,var(--color-paper)_80%,transparent)] lg:left-60">
          <div className="stock flex flex-col items-center gap-2 border-2 border-dashed border-rule-2 px-10 py-8">
            <Upload className="size-6 text-muted" aria-hidden />
            <p className="text-md font-medium">Solte para enviar{currentFolder ? ` para ${currentFolder.name}` : ''}</p>
            <p className="text-xs text-muted">MP4, MOV ou WebM, até 1 GB cada</p>
          </div>
        </div>
      )}
      <Page wide>
        <PageHeader
          title="Biblioteca"
          description={folders.data ? `${folders.data.total} vídeo${folders.data.total === 1 ? '' : 's'}. Arraste arquivos para cá para enviar.` : ' '}
          actions={
            <>
              <input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v" multiple hidden onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />
              <Button variant="ink" icon={<Upload />} onClick={() => fileInput.current?.click()}>
                Enviar vídeos
              </Button>
            </>
          }
        />

        <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          {/* Pastas */}
          <aside aria-label="Pastas" className="min-w-0">
            <div className="lg:hidden">
              <select className="input" value={folderId} onChange={(e) => set('pasta', e.target.value)} aria-label="Pasta">
                <option value="">Todas as pastas</option>
                <option value="none">Sem pasta</option>
                {folders.data?.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <nav className="hidden flex-col gap-0.5 lg:flex">
              <FolderLink active={!folderId} onClick={() => set('pasta', '')} label="Todos os vídeos" count={folders.data?.total} />
              <FolderLink active={folderId === 'none'} onClick={() => set('pasta', 'none')} label="Sem pasta" count={folders.data?.unfiled} />
              <p className="mt-4 mb-1 px-3 text-2xs text-muted">Pastas</p>
              {folders.isLoading && <Skeleton className="mx-3 h-8" />}
              {folders.data?.folders.map((f) => (
                <FolderLink key={f.id} active={folderId === f.id} onClick={() => set('pasta', f.id)} label={f.name} count={f.count} onEdit={() => setFolderDialog(f)} />
              ))}
              <button type="button" onClick={() => setFolderDialog('new')} className="mt-1 flex min-h-9 items-center gap-2 rounded-[var(--radius-input)] px-3 text-sm text-muted hover:bg-paper-2 hover:text-ink">
                <FolderPlus className="size-4" aria-hidden /> Nova pasta
              </button>
            </nav>
          </aside>

          <section className="min-w-0">
            {/* Barra de filtros */}
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <div className="relative min-w-52 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
                <input className="input pl-9" placeholder="Buscar por nome ou descrição" value={search} onChange={(e) => (setSearch(e.target.value), set('q', e.target.value))} aria-label="Buscar vídeos" />
              </div>
              <div className="seg scroll-thin max-w-full overflow-x-auto" role="group" aria-label="Filtrar por situação">
                {FILTERS.map((f) => (
                  <button key={f.value} type="button" aria-pressed={status === f.value} onClick={() => set('status', f.value)}>
                    {f.label}
                  </button>
                ))}
              </div>
              <select className="input w-auto" value={sort} onChange={(e) => set('ordem', e.target.value === 'recent' ? '' : e.target.value)} aria-label="Ordenar">
                <option value="recent">Mais recentes</option>
                <option value="oldest">Mais antigos</option>
                <option value="name">Nome</option>
                <option value="size">Tamanho</option>
              </select>
              <Button variant="ghost" className="lg:hidden" icon={<FolderPlus />} onClick={() => setFolderDialog('new')}>
                Pasta
              </Button>
            </div>

            {videos.error ? (
              <ErrorState error={videos.error} onRetry={() => videos.refetch()} />
            ) : videos.isLoading ? (
              <Grid>
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={i}>
                    <Skeleton className="aspect-[9/16]" />
                    <Skeleton className="mt-2 h-4 w-3/4" />
                  </div>
                ))}
              </Grid>
            ) : videos.data!.length === 0 ? (
              debounced || status || folderId ? (
                <EmptyState icon={<Search />} title="Nenhum vídeo encontrado" body="Tente outra busca ou limpe os filtros." action={<Button onClick={() => (setSearch(''), setParams({}, { replace: true }))}>Limpar filtros</Button>} />
              ) : (
                <div className="desk rounded-[var(--radius-card)] border border-dashed border-rule-2">
                  <EmptyState
                    icon={<Upload />}
                    title="Sua biblioteca está vazia"
                    body="Envie de uma vez todos os vídeos da semana. Eles ficam aqui para você reutilizar em quantas publicações quiser."
                    action={
                      <Button variant="ink" icon={<Upload />} onClick={() => fileInput.current?.click()}>
                        Escolher arquivos
                      </Button>
                    }
                  />
                </div>
              )
            ) : (
              <Grid>
                {videos.data!.map((v) => (
                  <VideoCard key={v.id} video={v} onOpen={() => setOpenId(v.id)} />
                ))}
              </Grid>
            )}
          </section>
        </div>
      </Page>

      <VideoDialog video={opened} folders={folders.data?.folders ?? []} onClose={() => setOpenId(null)} />
      <FolderDialog value={folderDialog} onClose={() => setFolderDialog(null)} onDeleted={() => set('pasta', '')} />
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] sm:gap-x-4 sm:gap-y-6">{children}</div>;
}

function FolderLink({ active, onClick, label, count, onEdit }: { active: boolean; onClick: () => void; label: string; count?: number; onEdit?: () => void }) {
  return (
    <div className={`group flex min-h-9 items-center rounded-[var(--radius-input)] ${active ? 'bg-cotton shadow-stock' : 'hover:bg-paper-2'}`}>
      <button type="button" onClick={onClick} aria-current={active || undefined} className={`flex min-h-9 min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm ${active ? 'font-medium text-ink' : 'text-ink-2'}`}>
        <FolderIcon className="size-4 flex-none text-faint" aria-hidden />
        <span className="truncate">{label}</span>
        <span className="fig ml-auto text-2xs text-muted">{count ?? ''}</span>
      </button>
      {onEdit && (
        <button type="button" onClick={onEdit} aria-label={`Editar pasta ${label}`} className="mr-1 rounded p-1 text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-ink">
          <MoreHorizontal className="size-4" />
        </button>
      )}
    </div>
  );
}

function usageStatus(v: Video): PublishStatus | null {
  if (v.usage.attention) return 'FAILED';
  if (v.usage.scheduled) return 'SCHEDULED';
  if (v.usage.published) return 'PUBLISHED';
  if (v.usage.drafts) return 'DRAFT';
  return null;
}

function VideoCard({ video, onOpen }: { video: Video; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  const status = usageStatus(video);
  return (
    <article className="group min-w-0">
      <button
        type="button"
        onClick={onOpen}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className="relative block w-full rounded-[var(--radius-card)] text-left shadow-stock transition-[transform,box-shadow] duration-[var(--dur-short)] ease-[var(--ease-out)] hover:-translate-y-0.5 hover:shadow-lift"
        aria-label={`Abrir ${video.title}`}
      >
        <VideoThumb src={video.thumbnailUrl} duration={video.durationSec} className="w-full rounded-[var(--radius-card)]" />
        {hover && (
          <video src={video.streamUrl} poster={video.thumbnailUrl ?? undefined} muted autoPlay loop playsInline preload="none" className="pointer-events-none absolute inset-0 size-full rounded-[var(--radius-card)] object-cover motion-reduce:hidden" aria-hidden />
        )}
        {status && (
          <span className="absolute top-1.5 left-1.5 rounded-[6px] bg-cotton">
            <StatusTag status={status} />
          </span>
        )}
      </button>
      <h3 className="mt-2 truncate text-sm font-medium tracking-normal" title={video.title}>
        {video.title}
      </h3>
      <p className="mt-0.5 flex gap-2 text-2xs text-muted">
        <span>{fmtDay(video.createdAt)}</span>
        <span className="fig">{formatBytes(video.sizeBytes)}</span>
        {video.folder && <span className="truncate">{video.folder.name}</span>}
      </p>
    </article>
  );
}

function VideoDialog({ video, folders, onClose }: { video: Video | null; folders: Folder[]; onClose: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', folderId: '' });
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidate();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  useEffect(() => {
    if (video) setForm({ title: video.title, description: video.description, folderId: video.folderId ?? '' });
  }, [video]);
  if (!video) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>;

  const dirty = form.title !== video.title || form.description !== video.description || form.folderId !== (video.folderId ?? '');
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/videos/${video.id}`, { title: form.title, description: form.description, folderId: form.folderId || null });
      await invalidate('videos', 'folders');
      toast('ok', 'Vídeo atualizado');
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const ok = await confirm({
      title: 'Excluir vídeo?',
      body: video.usage.total > 0 ? 'O arquivo será removido. As publicações já feitas continuam no histórico.' : 'O arquivo será removido da biblioteca. Esta ação não pode ser desfeita.',
      confirm: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/videos/${video.id}`);
      await invalidate('videos', 'folders', 'dashboard');
      toast('ok', 'Vídeo excluído');
      onClose();
    } catch (err) {
      toast('error', (err as ApiError).message);
    }
  };

  return (
    <Dialog
      open={!!video}
      onClose={onClose}
      title={video.title}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="danger" icon={<Trash2 />} onClick={remove} className="mr-auto">
            Excluir
          </Button>
          <Button onClick={save} busy={busy} disabled={!dirty || !form.title.trim()} icon={<Pencil />}>
            Salvar
          </Button>
          <Button variant="ink" icon={<CalendarPlus />} onClick={() => navigate(`/publicar?video=${video.id}`)}>
            Criar publicação
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <video src={video.streamUrl} poster={video.thumbnailUrl ?? undefined} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-[var(--radius-card)] bg-board object-contain" />
        <div className="min-w-0 space-y-4">
          <Field label="Nome" htmlFor="v-title">
            <input id="v-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} />
          </Field>
          <Field label="Descrição interna" htmlFor="v-desc" hint="Só para você. Não é publicada.">
            <textarea id="v-desc" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          </Field>
          <Field label="Pasta" htmlFor="v-folder">
            <select id="v-folder" className="input" value={form.folderId} onChange={(e) => setForm({ ...form, folderId: e.target.value })}>
              <option value="">Sem pasta</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-rule pt-4 text-sm">
            <dt className="text-muted">Duração</dt>
            <dd className="fig">{video.durationSec ? formatDuration(video.durationSec) : '—'}</dd>
            <dt className="text-muted">Resolução</dt>
            <dd className="fig">{video.width && video.height ? `${video.width}×${video.height}` : '—'}</dd>
            <dt className="text-muted">Tamanho</dt>
            <dd className="fig">{formatBytes(video.sizeBytes)}</dd>
            <dt className="text-muted">Enviado em</dt>
            <dd>{fmtDay(video.createdAt)}</dd>
            <dt className="text-muted">Arquivo</dt>
            <dd className="truncate" title={video.originalName}>
              {video.originalName}
            </dd>
            <dt className="text-muted">Uso</dt>
            <dd>
              {video.usage.total === 0 ? (
                'Ainda não usado'
              ) : (
                <Link to={`/publicacoes?video=${video.id}`}>
                  {video.usage.total} publicaç{video.usage.total === 1 ? 'ão' : 'ões'}
                </Link>
              )}
            </dd>
          </dl>
        </div>
      </div>
    </Dialog>
  );
}

const COLORS = ['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'];

function FolderDialog({ value, onClose, onDeleted }: { value: Folder | 'new' | null; onClose: () => void; onDeleted: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidate();
  const confirm = useConfirm();
  const toast = useToast();
  useEffect(() => {
    setName(value && value !== 'new' ? value.name : '');
    setError(undefined);
  }, [value]);
  const editing = value && value !== 'new' ? value : null;
  const save = async () => {
    setBusy(true);
    try {
      if (editing) await api.patch(`/api/folders/${editing.id}`, { name });
      else await api.post('/api/folders', { name, color: COLORS[0] });
      await invalidate('folders', 'videos');
      onClose();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!editing) return;
    if (!(await confirm({ title: `Excluir a pasta "${editing.name}"?`, body: 'Os vídeos não são apagados: eles voltam para "Sem pasta".', confirm: 'Excluir pasta', danger: true }))) return;
    await api.del(`/api/folders/${editing.id}`);
    await invalidate('folders', 'videos');
    toast('ok', 'Pasta excluída');
    onDeleted();
    onClose();
  };
  return (
    <Dialog
      open={!!value}
      onClose={onClose}
      title={editing ? 'Editar pasta' : 'Nova pasta'}
      width="max-w-sm"
      footer={
        <>
          {editing && (
            <Button variant="danger" onClick={remove} className="mr-auto" icon={<Trash2 />}>
              Excluir
            </Button>
          )}
          <Button variant="ink" onClick={save} busy={busy} disabled={!name.trim()}>
            {editing ? 'Salvar' : 'Criar pasta'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save();
        }}
      >
        <Field label="Nome da pasta" htmlFor="folder-name" error={error}>
          <input id="folder-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Campanha de dezembro" autoFocus maxLength={60} aria-invalid={!!error} />
        </Field>
      </form>
    </Dialog>
  );
}
