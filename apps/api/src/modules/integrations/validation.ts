/**
 * Validação dos requisitos de cada plataforma ANTES de agendar.
 * Erros bloqueiam o agendamento; avisos são exibidos mas não bloqueiam.
 */
import type { Platform, SocialAccount, Video } from '../../lib/prisma.js';
import { resolveTikTokMode } from './tiktok/mode.js';
import { composeCaption, type FacebookOptions, type TikTokOptions } from './types.js';

export interface Issue {
  level: 'error' | 'warning';
  field?: string;
  message: string;
}

const MB = 1024 * 1024;

export const PLATFORM_RULES = {
  TIKTOK: {
    label: 'TikTok',
    formats: ['video/mp4', 'video/quicktime', 'video/webm'],
    maxBytes: 4 * 1024 * MB,
    minDuration: 3,
    maxDuration: 600,
    captionMax: 2200,
    hashtagsMax: undefined as number | undefined,
  },
  INSTAGRAM: {
    label: 'Instagram Reels',
    formats: ['video/mp4', 'video/quicktime'],
    maxBytes: 300 * MB,
    minDuration: 3,
    maxDuration: 900,
    captionMax: 2200,
    hashtagsMax: 30 as number | undefined,
  },
  FACEBOOK: {
    label: 'Facebook',
    formats: ['video/mp4', 'video/quicktime'],
    maxBytes: 1024 * MB,
    minDuration: 3,
    maxDuration: 90, // Reels de página; vídeo comum aceita até 240 min
    captionMax: 63206,
    hashtagsMax: undefined as number | undefined,
  },
} as const;

export interface TargetInput {
  platform: Platform;
  caption: string;
  hashtags: string[];
  options: Record<string, any>;
}

export function validateTarget(
  input: TargetInput,
  video: Pick<Video, 'mimeType' | 'sizeBytes' | 'durationSec' | 'width' | 'height'>,
  account: Pick<SocialAccount, 'platform' | 'status' | 'metadata' | 'name'> & { connection?: { scopes: string[] } },
): Issue[] {
  const issues: Issue[] = [];
  const rules = PLATFORM_RULES[input.platform];
  const size = Number(video.sizeBytes);
  const err = (message: string, field?: string) => issues.push({ level: 'error', field, message });
  const warn = (message: string, field?: string) => issues.push({ level: 'warning', field, message });

  if (account.status !== 'ACTIVE') err(`A conta ${account.name} precisa ser reconectada antes de agendar.`, 'account');

  if (!(rules.formats as readonly string[]).includes(video.mimeType)) {
    err(`${rules.label} não aceita o formato ${video.mimeType}. Use MP4${input.platform === 'TIKTOK' ? ', MOV ou WebM' : ' ou MOV'}.`, 'video');
  }
  if (size > rules.maxBytes) err(`${rules.label} aceita arquivos de até ${Math.round(rules.maxBytes / MB)} MB.`, 'video');

  let maxDuration: number = rules.maxDuration;
  const fbOpts = input.options as FacebookOptions;
  if (input.platform === 'FACEBOOK' && fbOpts.format === 'VIDEO') maxDuration = 240 * 60;
  if (input.platform === 'TIKTOK') {
    const creator = (account.metadata as any)?.creatorInfo;
    if (creator?.max_video_post_duration_sec) maxDuration = creator.max_video_post_duration_sec;
  }
  if (video.durationSec != null) {
    if (video.durationSec < rules.minDuration) err(`${rules.label}: o vídeo precisa ter pelo menos ${rules.minDuration}s.`, 'video');
    if (video.durationSec > maxDuration) {
      err(`${rules.label}: duração máxima de ${formatDuration(maxDuration)} (o vídeo tem ${formatDuration(video.durationSec)}).`, 'video');
    }
  } else {
    warn('Duração do vídeo desconhecida: não foi possível validar o limite da plataforma.', 'video');
  }

  if (video.width && video.height) {
    const ratio = video.width / video.height;
    const isReel = input.platform !== 'FACEBOOK' || fbOpts.format !== 'VIDEO';
    if (isReel && Math.abs(ratio - 9 / 16) > 0.02) {
      warn(`${rules.label}: o formato recomendado é vertical 9:16 (o vídeo é ${video.width}×${video.height}).`, 'video');
    }
    if (input.platform === 'FACEBOOK' && isReel && (video.width < 540 || video.height < 960)) {
      warn('Reels do Facebook pedem resolução mínima de 540×960.', 'video');
    }
  }

  const caption = composeCaption(input.caption, input.hashtags);
  if (caption.length > rules.captionMax) err(`${rules.label}: a legenda passou do limite de ${rules.captionMax} caracteres (${caption.length}).`, 'caption');
  if (rules.hashtagsMax && countHashtags(caption) > rules.hashtagsMax) {
    err(`${rules.label}: máximo de ${rules.hashtagsMax} hashtags por publicação.`, 'hashtags');
  }
  if (input.platform === 'INSTAGRAM' && (caption.match(/@\w/g)?.length ?? 0) > 20) err('Instagram: máximo de 20 menções (@).', 'caption');

  if (input.platform === 'TIKTOK') {
    const o = input.options as TikTokOptions;
    const mode = resolveTikTokMode(o, account.connection?.scopes ?? []);
    if (mode === 'direct') {
      const creator = (account.metadata as any)?.creatorInfo;
      if (!o.privacyLevel) err('TikTok: escolha quem pode ver o vídeo.', 'privacyLevel');
      else if (creator?.privacy_level_options && !creator.privacy_level_options.includes(o.privacyLevel)) {
        err('TikTok: a privacidade escolhida não está disponível para esta conta.', 'privacyLevel');
      }
      if (o.brandedContent && o.privacyLevel === 'SELF_ONLY') {
        err('TikTok: conteúdo de marca não pode ter privacidade "Somente eu".', 'privacyLevel');
      }
      if (!o.consent) err('TikTok: confirme a declaração de uso de música.', 'consent');
    } else {
      warn('TikTok: o vídeo será enviado como rascunho. Você precisará finalizar a publicação no app do TikTok.', 'mode');
    }
  }

  return issues;
}

const countHashtags = (s: string) => s.match(/(^|\s)#[\p{L}\p{N}_]+/gu)?.length ?? 0;

function formatDuration(sec: number) {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}min ${r}s` : `${m}min`;
}
