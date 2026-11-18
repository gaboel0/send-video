import { PublishError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { readToBuffer, storage } from '../../storage/storage.js';
import { nextPoll, resetPolling } from '../polling.js';
import { getConnectionToken } from '../tokens.js';
import { composeCaption, type Publisher, type TikTokOptions } from '../types.js';
import * as tiktok from './api.js';
import { resolveTikTokMode } from './mode.js';

export const tiktokPublisher: Publisher = {
  platform: 'TIKTOK',

  async step(ctx) {
    const { target } = ctx;
    const userId = target.post.userId;
    const video = target.post.video;
    const size = Number(video.sizeBytes);
    const opts = (target.options ?? {}) as TikTokOptions;
    const token = await getConnectionToken(target.account.connection);

    switch (ctx.phase) {
      case null:
      case undefined:
      case '': {
        const mode = resolveTikTokMode(opts, target.account.connection.scopes);
        let postInfo: Record<string, unknown> | undefined;

        if (mode === 'direct') {
          // As diretrizes do TikTok exigem consultar o creator_info logo antes de publicar
          const creator = await tiktok.queryCreatorInfo(token, userId);
          await prisma.socialAccount.update({
            where: { id: target.accountId },
            data: { metadata: { ...(target.account.metadata as object), creatorInfo: creator as any }, lastSyncedAt: new Date() },
          });
          if (!opts.consent) {
            throw new PublishError('action', 'tiktok_consent_missing', 'Confirme a declaração de uso de música do TikTok no editor antes de publicar.');
          }
          if (!opts.privacyLevel || !creator.privacy_level_options.includes(opts.privacyLevel)) {
            throw new PublishError(
              'fatal',
              'privacy_level_option_mismatch',
              `A privacidade "${opts.privacyLevel ?? 'não definida'}" não está disponível para esta conta. Opções: ${creator.privacy_level_options.join(', ')}.`,
            );
          }
          if (video.durationSec && video.durationSec > creator.max_video_post_duration_sec) {
            throw new PublishError(
              'fatal',
              'duration_check_failed',
              `Esta conta aceita vídeos de até ${creator.max_video_post_duration_sec}s; o vídeo tem ${Math.round(video.durationSec)}s.`,
            );
          }
          postInfo = {
            title: composeCaption(target.caption, target.hashtags),
            privacy_level: opts.privacyLevel,
            disable_comment: creator.comment_disabled || Boolean(opts.disableComment),
            disable_duet: creator.duet_disabled || Boolean(opts.disableDuet),
            disable_stitch: creator.stitch_disabled || Boolean(opts.disableStitch),
            brand_content_toggle: Boolean(opts.brandedContent),
            brand_organic_toggle: Boolean(opts.brandOrganic),
            is_aigc: Boolean(opts.isAigc),
            ...(opts.coverTimestampMs !== undefined ? { video_cover_timestamp_ms: opts.coverTimestampMs } : {}),
          };
        }

        // Ponto sem volta: a partir daqui o TikTok pode criar a publicação
        await ctx.checkpoint('INITIATING', { mode });
        const init =
          mode === 'direct'
            ? await tiktok.initDirectPost(token, postInfo!, size, userId)
            : await tiktok.initInboxUpload(token, size, userId);
        const state = { mode, publishId: init.publish_id, uploadUrl: init.upload_url, uploadedChunks: 0 };
        await ctx.checkpoint('UPLOADING', state);
        await ctx.log(mode === 'direct' ? 'TikTok: publicação iniciada, enviando arquivo' : 'TikTok: rascunho iniciado, enviando arquivo');
        return upload(state, ctx, size, video.storageKey, video.mimeType, userId);
      }

      case 'INITIATING':
        // O processo caiu durante a chamada de inicialização: não sabemos se o TikTok criou a publicação.
        throw new PublishError(
          'action',
          'possible_duplicate',
          'O envio ao TikTok foi interrompido no meio da inicialização. Confira no TikTok se a publicação foi criada antes de tentar novamente.',
        );

      case 'UPLOADING':
        return upload(ctx.state, ctx, size, video.storageKey, video.mimeType, userId);

      case 'AWAITING_STATUS': {
        const status = await tiktok.fetchPublishStatus(token, ctx.state.publishId, userId);
        if (status.status === 'PUBLISH_COMPLETE') {
          const postId = status.publicaly_available_post_id?.[0];
          const username = (target.account.username ?? '').replace(/^@/, '');
          return {
            type: 'published',
            externalId: postId ? String(postId) : ctx.state.publishId,
            permalink: postId && username ? `https://www.tiktok.com/@${username}/video/${postId}` : null,
            state: resetPolling(ctx.state),
          };
        }
        if (status.status === 'SEND_TO_USER_INBOX') {
          return {
            type: 'needs_action',
            code: 'tiktok_inbox',
            message: 'Vídeo enviado para a caixa de entrada do TikTok. Abra o app TikTok, toque na notificação e finalize a publicação.',
            state: resetPolling(ctx.state),
          };
        }
        if (status.status === 'FAILED') {
          throw tiktok.classifyError(400, status.fail_reason ?? 'unknown', `O TikTok recusou a publicação (${status.fail_reason ?? 'sem motivo'})`);
        }
        const poll = nextPoll(ctx.state);
        return { type: 'continue', phase: 'AWAITING_STATUS', state: poll.state, delayMs: poll.delayMs };
      }

      default:
        throw new PublishError('fatal', 'unknown_phase', `Etapa desconhecida: ${ctx.phase}`);
    }
  },
};

async function upload(
  state: Record<string, any>,
  ctx: Parameters<Publisher['step']>[0],
  size: number,
  key: string,
  mimeType: string,
  userId: string,
) {
  const ranges = tiktok.chunkRanges(size);
  let uploaded = state.uploadedChunks ?? 0;
  try {
    for (let i = uploaded; i < ranges.length; i++) {
      const chunk = await readToBuffer(await storage.read(key, ranges[i]));
      await tiktok.uploadChunk(state.uploadUrl, chunk, ranges[i], size, mimeType === 'video/quicktime' ? 'video/quicktime' : mimeType, userId);
      uploaded = i + 1;
      await ctx.checkpoint('UPLOADING', { ...state, uploadedChunks: uploaded });
    }
  } catch (err) {
    // A URL de upload vale 1 hora. Se o envio falhar, o publish_id incompleto expira sozinho
    // sem publicar nada; recomeçamos do zero na próxima tentativa.
    await ctx.checkpoint(null, {});
    if (err instanceof PublishError) throw new PublishError('retry', err.code, err.message);
    throw err;
  }
  await ctx.log('TikTok: arquivo enviado, aguardando processamento');
  const poll = nextPoll({ ...state, uploadedChunks: uploaded });
  return { type: 'continue' as const, phase: 'AWAITING_STATUS', state: poll.state, delayMs: poll.delayMs };
}
