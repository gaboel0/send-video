import type { ReactNode } from 'react';
import { Field } from './ui';
import type { CreatorInfo, Platform } from '../lib/types';

export const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: 'Todos',
  MUTUAL_FOLLOW_FRIENDS: 'Amigos (seguidores mútuos)',
  FOLLOWER_OF_CREATOR: 'Seguidores',
  SELF_ONLY: 'Somente eu',
};

function Toggle({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className={`text-sm ${disabled ? 'text-faint' : 'text-ink-2'}`}>{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={typeof label === 'string' ? label : undefined} disabled={disabled} onClick={() => onChange(!checked)} className="switch mt-0.5" />
    </div>
  );
}

export function PlatformOptions({
  platform,
  options,
  onChange,
  creator,
  canDirect,
  canInbox,
  defaultMode,
  errorFields,
}: {
  platform: Platform;
  options: Record<string, any>;
  onChange: (o: Record<string, any>) => void;
  creator?: CreatorInfo | null;
  canDirect: boolean;
  canInbox: boolean;
  defaultMode: 'direct' | 'inbox';
  errorFields: Set<string>;
}) {
  const set = (k: string, v: unknown) => onChange({ ...options, [k]: v });

  if (platform === 'INSTAGRAM') {
    return (
      <div className="divide-y divide-rule">
        <Toggle label="Também mostrar no feed" hint="O Reel aparece na grade do perfil além da aba Reels." checked={options.shareToFeed ?? true} onChange={(v) => set('shareToFeed', v)} />
      </div>
    );
  }

  if (platform === 'FACEBOOK') {
    const format = options.format ?? 'REEL';
    return (
      <div className="space-y-4">
        <div>
          <p className="label">Formato na página</p>
          <div className="seg" role="group" aria-label="Formato">
            <button type="button" aria-pressed={format === 'REEL'} onClick={() => set('format', 'REEL')}>
              Reels (até 90s)
            </button>
            <button type="button" aria-pressed={format === 'VIDEO'} onClick={() => set('format', 'VIDEO')}>
              Vídeo
            </button>
          </div>
        </div>
        {format === 'VIDEO' && (
          <Field label="Título do vídeo" htmlFor="fb-title" hint="Opcional.">
            <input id="fb-title" className="input" value={options.title ?? ''} onChange={(e) => set('title', e.target.value)} maxLength={255} />
          </Field>
        )}
      </div>
    );
  }

  // TikTok: segue as diretrizes de UX da Content Posting API
  const mode: 'direct' | 'inbox' = options.mode ?? (canDirect ? defaultMode : 'inbox');
  const branded = Boolean(options.brandedContent);
  const organic = Boolean(options.brandOrganic);
  const disclosure = branded || organic || Boolean(options.disclose);
  return (
    <div className="space-y-4">
      {canDirect && canInbox && (
        <div>
          <p className="label">Como enviar</p>
          <div className="seg" role="group" aria-label="Modo de envio ao TikTok">
            <button type="button" aria-pressed={mode === 'direct'} onClick={() => set('mode', 'direct')}>
              Publicar direto
            </button>
            <button type="button" aria-pressed={mode === 'inbox'} onClick={() => set('mode', 'inbox')}>
              Enviar como rascunho
            </button>
          </div>
        </div>
      )}
      {mode === 'inbox' ? (
        <p className="rounded-[var(--radius-input)] bg-warn-wash px-3 py-2.5 text-sm text-ink-2">
          O vídeo vai para a caixa de entrada do TikTok no horário agendado. Você recebe uma notificação no app e finaliza a publicação por lá (legenda e privacidade são definidas no app).
        </p>
      ) : (
        <>
          {creator ? (
            <p className="text-xs text-muted">
              Publicando como <span className="font-medium text-ink-2">{creator.creator_nickname}</span> (@{creator.creator_username}). Limite desta conta:{' '}
              <span className="fig">{creator.max_video_post_duration_sec}s</span>.
            </p>
          ) : (
            <p className="text-xs text-warn">Informações do criador indisponíveis. Sincronize a conta em Contas.</p>
          )}
          <Field label="Quem pode ver" htmlFor="tt-privacy" error={errorFields.has('privacyLevel') ? 'Escolha uma opção disponível' : undefined}>
            <select id="tt-privacy" className="input" value={options.privacyLevel ?? ''} onChange={(e) => set('privacyLevel', e.target.value || undefined)} aria-invalid={errorFields.has('privacyLevel')}>
              <option value="">Selecione</option>
              {(creator?.privacy_level_options ?? []).map((p) => (
                <option key={p} value={p} disabled={p === 'SELF_ONLY' && branded}>
                  {PRIVACY_LABEL[p] ?? p}
                  {p === 'SELF_ONLY' && branded ? ' (indisponível para conteúdo de marca)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="divide-y divide-rule border-y border-rule">
            <Toggle label="Permitir comentários" checked={!options.disableComment && !creator?.comment_disabled} disabled={creator?.comment_disabled} onChange={(v) => set('disableComment', !v)} />
            <Toggle label="Permitir dueto" checked={!options.disableDuet && !creator?.duet_disabled} disabled={creator?.duet_disabled} onChange={(v) => set('disableDuet', !v)} />
            <Toggle label="Permitir costura (stitch)" checked={!options.disableStitch && !creator?.stitch_disabled} disabled={creator?.stitch_disabled} onChange={(v) => set('disableStitch', !v)} />
            <Toggle label="Conteúdo gerado por IA" hint="Adiciona o rótulo de conteúdo gerado por IA." checked={Boolean(options.isAigc)} onChange={(v) => set('isAigc', v)} />
            <Toggle
              label="Divulgar conteúdo comercial"
              hint="Indique se o vídeo promove você, sua marca ou um terceiro."
              checked={disclosure}
              onChange={(v) => onChange({ ...options, disclose: v, ...(v ? {} : { brandOrganic: false, brandedContent: false }) })}
            />
            {disclosure && (
              <div className="space-y-2 py-3 pl-1">
                <label className="flex items-start gap-2.5 text-sm text-ink-2">
                  <input type="checkbox" className="mt-1 accent-[var(--color-ink)]" checked={organic} onChange={(e) => set('brandOrganic', e.target.checked)} />
                  <span>
                    Sua marca <span className="block text-xs text-muted">Promove você ou seu negócio. Rótulo “Conteúdo promocional”.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2.5 text-sm text-ink-2">
                  <input type="checkbox" className="mt-1 accent-[var(--color-ink)]" checked={branded} onChange={(e) => onChange({ ...options, brandedContent: e.target.checked, ...(e.target.checked && options.privacyLevel === 'SELF_ONLY' ? { privacyLevel: undefined } : {}) })} />
                  <span>
                    Conteúdo de marca <span className="block text-xs text-muted">Parceria paga com terceiros. Rótulo “Parceria paga”.</span>
                  </span>
                </label>
                {!branded && !organic && <p className="text-xs text-warn">Selecione ao menos uma opção ou desative a divulgação.</p>}
              </div>
            )}
          </div>
          <label className={`flex items-start gap-2.5 text-sm ${errorFields.has('consent') ? 'text-danger' : 'text-ink-2'}`}>
            <input type="checkbox" className="mt-1 accent-[var(--color-ink)]" checked={Boolean(options.consent)} onChange={(e) => set('consent', e.target.checked)} />
            <span>
              Ao publicar, concordo com a{' '}
              {branded && (
                <>
                  <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">
                    Política de Conteúdo de Marca
                  </a>{' '}
                  e a{' '}
                </>
              )}
              <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">
                Confirmação de Uso de Música
              </a>{' '}
              do TikTok.
            </span>
          </label>
          <p className="text-xs text-muted">O TikTok pode levar alguns minutos para processar o vídeo após a publicação.</p>
        </>
      )}
    </div>
  );
}
