import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ApiError, uploadWithProgress } from '../lib/api';
import { formatBytes } from '../lib/time';
import type { Video } from '../lib/types';
import { Button } from './ui';

const ACCEPT = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
const MAX_MB = 1024;
const CONCURRENCY = 2;

type Item = {
  id: string;
  file: File;
  folderId?: string;
  progress: number;
  stage: 'waiting' | 'reading' | 'uploading' | 'done' | 'error';
  error?: string;
  video?: Video;
  abort?: AbortController;
};

const Ctx = createContext<{ add: (files: File[], folderId?: string) => void; active: number }>({ add: () => {}, active: 0 });
export const useUploads = () => useContext(Ctx);

/** Lê duração, dimensões e gera uma miniatura no navegador (sem ffmpeg no servidor) */
export function extractVideoMeta(file: File): Promise<{ duration?: number; width?: number; height?: number; thumb?: Blob }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    let meta: { duration?: number; width?: number; height?: number } = {};
    const finish = (thumb?: Blob) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
      resolve({ ...meta, thumb });
    };
    const timer = setTimeout(() => finish(), 10_000);
    video.onloadedmetadata = () => {
      meta = {
        duration: Number.isFinite(video.duration) ? video.duration : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      };
      video.currentTime = Math.min(1, (video.duration || 2) * 0.15);
    };
    video.onseeked = () => {
      try {
        const w = 360;
        const h = Math.round((video.videoHeight / video.videoWidth) * w) || 640;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
        canvas.toBlob((b) => finish(b ?? undefined), 'image/jpeg', 0.82);
      } catch {
        finish();
      }
    };
    video.onerror = () => finish();
  });
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const running = useRef(0);
  const queue = useRef<Item[]>([]);
  const qc = useQueryClient();

  const patch = (id: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const pump = useCallback(() => {
    while (running.current < CONCURRENCY && queue.current.length) {
      const item = queue.current.shift()!;
      running.current++;
      (async () => {
        try {
          patch(item.id, { stage: 'reading' });
          const meta = await extractVideoMeta(item.file);
          const form = new FormData();
          form.append('title', item.file.name.replace(/\.[^.]+$/, ''));
          if (item.folderId) form.append('folderId', item.folderId);
          if (meta.duration) form.append('durationSec', String(meta.duration));
          if (meta.width) form.append('width', String(meta.width));
          if (meta.height) form.append('height', String(meta.height));
          if (meta.thumb) form.append('thumbnail', meta.thumb, 'thumb.jpg');
          form.append('file', item.file, item.file.name); // por último: o servidor lê os campos antes
          patch(item.id, { stage: 'uploading' });
          const video = await uploadWithProgress<Video>('/api/videos', form, (f) => patch(item.id, { progress: f }), item.abort?.signal);
          patch(item.id, { stage: 'done', progress: 1, video });
          qc.invalidateQueries({ queryKey: ['videos'] });
          qc.invalidateQueries({ queryKey: ['folders'] });
          qc.invalidateQueries({ queryKey: ['dashboard'] });
        } catch (err) {
          patch(item.id, { stage: 'error', error: err instanceof ApiError ? err.message : 'Falha no envio' });
        } finally {
          running.current--;
          pump();
        }
      })();
    }
  }, [qc]);

  const add = useCallback(
    (files: File[], folderId?: string) => {
      const next: Item[] = files.map((file) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const tooBig = file.size > MAX_MB * 1024 * 1024;
        const badType = file.type && !ACCEPT.includes(file.type);
        return {
          id,
          file,
          folderId,
          progress: 0,
          stage: tooBig || badType ? 'error' : 'waiting',
          error: tooBig ? `Maior que ${MAX_MB} MB` : badType ? 'Formato não suportado (use MP4, MOV ou WebM)' : undefined,
          abort: new AbortController(),
        };
      });
      setItems((list) => [...list.filter((i) => i.stage !== 'done'), ...next]);
      setCollapsed(false);
      queue.current.push(...next.filter((i) => i.stage === 'waiting'));
      pump();
    },
    [pump],
  );

  const active = items.filter((i) => ['waiting', 'reading', 'uploading'].includes(i.stage)).length;

  return (
    <Ctx.Provider value={{ add, active }}>
      {children}
      {items.length > 0 && (
        <div className="stock fade-in fixed right-4 bottom-4 left-4 z-40 sm:left-auto sm:w-96" role="region" aria-label="Envios">
          <div className="flex items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
            <p className="text-sm font-medium">{active > 0 ? `Enviando ${active} vídeo${active > 1 ? 's' : ''}` : 'Envios concluídos'}</p>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setCollapsed((c) => !c)} icon={collapsed ? <ChevronUp /> : <ChevronDown />} aria-label={collapsed ? 'Expandir' : 'Recolher'} />
              {active === 0 && <Button variant="ghost" size="sm" onClick={() => setItems([])} icon={<X />} aria-label="Fechar" />}
            </div>
          </div>
          {!collapsed && (
            <ul className="scroll-thin max-h-72 divide-y divide-rule overflow-y-auto">
              {items.map((i) => (
                <li key={i.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    {i.stage === 'done' ? (
                      <CheckCircle2 className="size-4 flex-none text-paid" aria-hidden />
                    ) : i.stage === 'error' ? (
                      <TriangleAlert className="size-4 flex-none text-danger" aria-hidden />
                    ) : (
                      <Loader2 className="size-4 flex-none animate-spin text-muted motion-reduce:animate-none" aria-hidden />
                    )}
                    <p className="min-w-0 flex-1 truncate text-sm">{i.file.name}</p>
                    <span className="fig text-2xs text-muted">
                      {i.stage === 'uploading' ? `${Math.round(i.progress * 100)}%` : i.stage === 'reading' ? 'lendo' : i.stage === 'waiting' ? 'na fila' : formatBytes(i.file.size)}
                    </span>
                    {['waiting', 'uploading', 'reading'].includes(i.stage) && (
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted hover:text-ink"
                        aria-label={`Cancelar ${i.file.name}`}
                        onClick={() => {
                          queue.current = queue.current.filter((q) => q.id !== i.id);
                          i.abort?.abort();
                          patch(i.id, { stage: 'error', error: 'Cancelado' });
                        }}
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {i.stage === 'uploading' && (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-paper-3" role="progressbar" aria-valuenow={Math.round(i.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full origin-left rounded-full bg-ink-2 transition-transform duration-[var(--dur-short)]" style={{ transform: `scaleX(${i.progress})` }} />
                    </div>
                  )}
                  {i.error && <p className="mt-1 text-xs text-danger">{i.error}</p>}
                  {i.video?.duplicateOf && <p className="mt-1 text-xs text-warn">Arquivo idêntico a "{i.video.duplicateOf.title}" já existe na biblioteca.</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
