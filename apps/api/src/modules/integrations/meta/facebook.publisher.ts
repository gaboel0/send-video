import { PublishError } from '../../../lib/errors.js';
import { storage } from '../../storage/storage.js';
import { nextPoll, resetPolling } from '../polling.js';
import { getAccountToken, getConnectionToken } from '../tokens.js';
import { composeCaption, type FacebookOptions, type Publisher, type PublishContext, type StepResult } from '../types.js';
import * as meta from './api.js';

/**
 * Página do Facebook.
 *  - REEL:  video_reels start → upload (rupload) → finish(PUBLISHED) → acompanha status
 *  - VIDEO: Resumable Upload API → /{page}/videos com o handle → acompanha status
 */
export const facebookPublisher: Publisher = {
  platform: 'FACEBOOK',

  async step(ctx) {
    const { target } = ctx;
    const userId = target.post.userId;
    const pageId = target.account.externalId;
    const pageToken = getAccountToken(target.account);
    const opts = (target.options ?? {}) as FacebookOptions;
    const format = ctx.state.format ?? opts.format ?? 'REEL';
    const video = target.post.video;
    const size = Number(video.sizeBytes);
    const description = composeCaption(target.caption, target.hashtags);

    switch (ctx.phase) {
      case null:
      case undefined:
      case '':
      case 'STARTING': {
        // Iniciar sessão de upload não publica nada; repetir é seguro.
        await ctx.checkpoint('STARTING', { format });
        if (format === 'REEL') {
          const start = await meta.fbReelStart(pageId, pageToken, userId);
          const state = { format, videoId: start.video_id, uploadUrl: start.upload_url };
          await ctx.checkpoint('UPLOADING', state);
          return uploadReel(ctx, state, pageToken, video.storageKey, size, pageId, description, userId);
        }
        const userToken = await getConnectionToken(target.account.connection);
        const session = await meta.fbUploadSessionStart(userToken, video.originalName, size, video.mimeType, userId);
        const state = { format, sessionId: session.id };
        await ctx.checkpoint('UPLOADING', state);
        return uploadVideo(ctx, state, userToken, pageToken, video.storageKey, size, pageId, opts.title ?? '', description, userId);
      }

      case 'UPLOADING':
        if (format === 'REEL') return uploadReel(ctx, ctx.state, pageToken, video.storageKey, size, pageId, description, userId);
        return uploadVideo(
          ctx,
          ctx.state,
          await getConnectionToken(target.account.connection),
          pageToken,
          video.storageKey,
          size,
          pageId,
          opts.title ?? '',
          description,
          userId,
        );

      case 'FINISHING': {
        // Retomada: só chama finish de novo se a publicação ainda não começou
        const s = await meta.fbVideoStatus(ctx.state.videoId, pageToken, userId);
        const pub = s.status?.publishing_phase?.status;
        if (pub && pub !== 'not_started') return awaitProcessing(ctx.state);
        return finishReel(ctx, ctx.state, pageToken, pageId, description, userId);
      }

      case 'PUBLISHING':
        throw new PublishError(
          'action',
          'possible_duplicate',
          'A publicação do vídeo na página foi interrompida no meio. Confira a página do Facebook antes de tentar novamente.',
        );

      case 'AWAITING_PROCESSING': {
        const s = await meta.fbVideoStatus(ctx.state.videoId, pageToken, userId);
        const st = s.status;
        const procError = st?.processing_phase?.status === 'error' ? st.processing_phase.error?.message : undefined;
        const pubError = st?.publishing_phase?.status === 'error' ? st.publishing_phase.error?.message : undefined;
        if (st?.video_status === 'error' || procError || pubError) {
          throw new PublishError('fatal', 'fb_processing_error', `O Facebook não conseguiu processar o vídeo: ${procError ?? pubError ?? 'erro desconhecido'}`);
        }
        const published = st?.publishing_phase?.status === 'complete' || st?.publishing_phase?.publish_status === 'published';
        if (published || (st?.video_status === 'ready' && !st?.publishing_phase)) {
          const link = s.permalink_url;
          return {
            type: 'published',
            externalId: ctx.state.videoId,
            permalink: link ? (link.startsWith('http') ? link : `https://www.facebook.com${link}`) : null,
            state: resetPolling(ctx.state),
          };
        }
        const poll = nextPoll(ctx.state);
        return { type: 'continue', phase: 'AWAITING_PROCESSING', state: poll.state, delayMs: poll.delayMs };
      }

      default:
        throw new PublishError('fatal', 'unknown_phase', `Etapa desconhecida: ${ctx.phase}`);
    }
  },
};

async function uploadReel(
  ctx: PublishContext,
  state: Record<string, any>,
  pageToken: string,
  key: string,
  size: number,
  pageId: string,
  description: string,
  userId: string,
): Promise<StepResult> {
  try {
    await meta.fbReelUpload(state.uploadUrl, pageToken, await storage.read(key), size, userId);
  } catch (err) {
    await ctx.checkpoint(null, {});
    throw err;
  }
  await ctx.log('Facebook: Reel enviado, publicando');
  return finishReel(ctx, state, pageToken, pageId, description, userId);
}

async function finishReel(
  ctx: PublishContext,
  state: Record<string, any>,
  pageToken: string,
  pageId: string,
  description: string,
  userId: string,
): Promise<StepResult> {
  await ctx.checkpoint('FINISHING', state);
  await meta.fbReelFinish(pageId, state.videoId, pageToken, description, userId);
  await ctx.checkpoint('AWAITING_PROCESSING', state);
  return awaitProcessing(state);
}

async function uploadVideo(
  ctx: PublishContext,
  state: Record<string, any>,
  userToken: string,
  pageToken: string,
  key: string,
  size: number,
  pageId: string,
  title: string,
  description: string,
  userId: string,
): Promise<StepResult> {
  let handle: string;
  try {
    handle = await meta.fbUploadSessionTransfer(state.sessionId, userToken, await storage.read(key), size, userId);
  } catch (err) {
    await ctx.checkpoint(null, {});
    throw err;
  }
  // Ponto sem volta: a chamada abaixo cria o post na página
  await ctx.checkpoint('PUBLISHING', { ...state, handle });
  const created = await meta.fbPageVideoCreate(pageId, pageToken, handle, title, description, userId);
  const next = { ...state, handle, videoId: created.id };
  await ctx.checkpoint('AWAITING_PROCESSING', next);
  await ctx.log('Facebook: vídeo enviado, aguardando processamento');
  return awaitProcessing(next);
}

function awaitProcessing(state: Record<string, any>): StepResult {
  const poll = nextPoll(state);
  return { type: 'continue', phase: 'AWAITING_PROCESSING', state: poll.state, delayMs: poll.delayMs };
}
