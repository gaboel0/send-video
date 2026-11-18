import type {
  Platform,
  Post,
  PostTarget,
  SocialAccount,
  SocialConnection,
  Video,
} from '../../lib/prisma.js';

export type TargetWithRelations = PostTarget & {
  post: Post & { video: Video };
  account: SocialAccount & { connection: SocialConnection };
};

export type ProviderState = Record<string, any>;

export interface PublishContext {
  target: TargetWithRelations;
  phase: string | null;
  state: ProviderState;
  /**
   * Salva a etapa e os ids intermediários no banco ANTES de uma chamada não idempotente.
   * Se o worker cair no meio, a próxima execução sabe exatamente de onde retomar
   * e nunca repete uma publicação que pode já ter acontecido.
   */
  checkpoint(phase: string | null, state?: ProviderState): Promise<void>;
  log(message: string): Promise<void>;
}

export type StepResult =
  /** Ainda não terminou: reagendar o mesmo destino para consultar de novo */
  | { type: 'continue'; phase: string; state: ProviderState; delayMs: number; message?: string }
  | { type: 'published'; externalId: string; permalink?: string | null; state: ProviderState }
  /** Concluído do lado da API, mas o usuário precisa agir (ex.: finalizar rascunho no TikTok) */
  | { type: 'needs_action'; code: string; message: string; state: ProviderState };

export interface Publisher {
  platform: Platform;
  step(ctx: PublishContext): Promise<StepResult>;
}

export interface TikTokOptions {
  /** direct = Direct Post | inbox = rascunho na caixa de entrada do TikTok */
  mode?: 'direct' | 'inbox';
  privacyLevel?: string;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  /** "Sua marca" (conteúdo promocional próprio) */
  brandOrganic?: boolean;
  /** "Conteúdo de marca" (parceria paga) */
  brandedContent?: boolean;
  isAigc?: boolean;
  coverTimestampMs?: number;
  /** Consentimento exigido pelas diretrizes do TikTok */
  consent?: boolean;
}

export interface InstagramOptions {
  shareToFeed?: boolean;
  thumbOffsetMs?: number;
}

export interface FacebookOptions {
  format?: 'REEL' | 'VIDEO';
  title?: string;
}

export const composeCaption = (caption: string, hashtags: string[]) => {
  const tags = hashtags
    .map((h) => h.trim().replace(/^#+/, ''))
    .filter(Boolean)
    .map((h) => `#${h}`)
    .join(' ');
  return [caption.trim(), tags].filter(Boolean).join('\n\n');
};
