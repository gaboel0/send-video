import { PublishError } from '../../../lib/errors.js';
import { storage } from '../../storage/storage.js';
import { nextPoll, resetPolling } from '../polling.js';
import { getAccountToken } from '../tokens.js';
import { composeCaption, type InstagramOptions, type Publisher, type PublishContext, type StepResult } from '../types.js';
import * as meta from './api.js';

/**
 * Instagram Reels via Content Publishing API:
 *   container (upload_type=resumable) → upload binário → status FINISHED → media_publish
 * O container funciona como chave de idempotência: só vira post quando publicado,
 * e o status_code PUBLISHED indica se a publicação já aconteceu.
 */
export const instagramPublisher: Publisher = {
  platform: 'INSTAGRAM',

  async step(ctx) {
    const { target } = ctx;
    const userId = target.post.userId;
    const igUserId = target.account.externalId;
    const token = getAccountToken(target.account);
    const opts = (target.options ?? {}) as InstagramOptions;
    const video = target.post.video;

    switch (ctx.phase) {
      case null:
      case undefined:
      case '':
      case 'CREATING_CONTAINER': {
        // Criar container não publica nada; repetir esta etapa é seguro.
        await ctx.checkpoint('CREATING_CONTAINER', {});
        const container = await meta.igCreateReelContainer(
          igUserId,
          token,
          {
            caption: composeCaption(target.caption, target.hashtags),
            shareToFeed: opts.shareToFeed ?? true,
            thumbOffsetMs: opts.thumbOffsetMs,
          },
          userId,
        );
        const state = { containerId: container.id, uri: container.uri };
        await ctx.checkpoint('UPLOADING', state);
        return uploadAndWait(ctx, state, token, video.storageKey, Number(video.sizeBytes), userId);
      }

      case 'UPLOADING':
        return uploadAndWait(ctx, ctx.state, token, video.storageKey, Number(video.sizeBytes), userId);

      case 'AWAITING_PROCESSING': {
        const s = await meta.igContainerStatus(ctx.state.containerId, token, userId);
        if (s.status_code === 'FINISHED') return publish(ctx, token, igUserId, userId);
        if (s.status_code === 'PUBLISHED') return finalize(ctx, token, ctx.state.mediaId ?? ctx.state.containerId, userId);
        if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
          // Nada foi publicado: recomeça criando um novo container
          await ctx.checkpoint(null, {});
          throw new PublishError(
            s.status_code === 'ERROR' ? 'retry' : 'retry',
            `ig_container_${s.status_code.toLowerCase()}`,
            `O Instagram não conseguiu processar o vídeo (${s.status ?? s.status_code}).`,
          );
        }
        const poll = nextPoll(ctx.state);
        return { type: 'continue', phase: 'AWAITING_PROCESSING', state: poll.state, delayMs: poll.delayMs };
      }

      case 'PUBLISHING': {
        // Retomada após queda durante media_publish: o status do container diz se já foi publicado
        const s = await meta.igContainerStatus(ctx.state.containerId, token, userId);
        if (s.status_code === 'PUBLISHED') return finalize(ctx, token, ctx.state.mediaId ?? ctx.state.containerId, userId);
        if (s.status_code === 'FINISHED') return publish(ctx, token, igUserId, userId);
        throw new PublishError('action', 'ig_unknown_state', `Estado inesperado do container no Instagram: ${s.status_code}. Verifique o perfil.`);
      }

      case 'FETCHING_PERMALINK':
        return finalize(ctx, token, ctx.state.mediaId, userId);

      default:
        throw new PublishError('fatal', 'unknown_phase', `Etapa desconhecida: ${ctx.phase}`);
    }
  },
};

async function uploadAndWait(
  ctx: PublishContext,
  state: Record<string, any>,
  token: string,
  key: string,
  size: number,
  userId: string,
): Promise<StepResult> {
  try {
    await meta.igUpload(state.containerId, state.uri, token, await storage.read(key), size, userId);
  } catch (err) {
    await ctx.checkpoint(null, {});
    throw err;
  }
  await ctx.log('Instagram: vídeo enviado, aguardando processamento');
  const poll = nextPoll(state);
  return { type: 'continue', phase: 'AWAITING_PROCESSING', state: poll.state, delayMs: poll.delayMs };
}

async function publish(ctx: PublishContext, token: string, igUserId: string, userId: string): Promise<StepResult> {
  const state = resetPolling(ctx.state);
  await ctx.checkpoint('PUBLISHING', state);
  const media = await meta.igPublish(igUserId, state.containerId, token, userId);
  const next = { ...state, mediaId: media.id };
  await ctx.checkpoint('FETCHING_PERMALINK', next);
  return finalizeWith(next, token, media.id, userId);
}

async function finalize(ctx: PublishContext, token: string, mediaId: string, userId: string) {
  return finalizeWith(resetPolling(ctx.state), token, mediaId, userId);
}

async function finalizeWith(state: Record<string, any>, token: string, mediaId: string, userId: string): Promise<StepResult> {
  let permalink: string | null = null;
  try {
    permalink = (await meta.igMedia(mediaId, token, userId)).permalink ?? null;
  } catch {
    // permalink é opcional; a publicação já aconteceu
  }
  return { type: 'published', externalId: mediaId, permalink, state };
}
