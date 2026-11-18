/**
 * Cliente da Meta Graph API (Facebook Login + Instagram Content Publishing + Pages/Reels).
 * Docs:
 *  - https://developers.facebook.com/docs/instagram-platform/content-publishing/
 *  - https://developers.facebook.com/docs/video-api/guides/reels-publishing
 *  - https://developers.facebook.com/docs/video-api/guides/publishing
 */
import type { Readable } from 'node:stream';
import { env } from '../../../config/env.js';
import { HttpError, PublishError, TokenExpiredError } from '../../../lib/errors.js';
import { httpCall, type HttpBody } from '../../../lib/http.js';

const v = () => env.META_GRAPH_VERSION;
const GRAPH = () => `https://graph.facebook.com/${v()}`;
const RUPLOAD = 'https://rupload.facebook.com';

/**
 * Permissões necessárias:
 *  - pages_show_list, pages_read_engagement: listar páginas e obter tokens de página
 *  - pages_manage_posts: publicar vídeos/Reels na página
 *  - instagram_basic, instagram_content_publish: publicar Reels no Instagram profissional
 *  - business_management: páginas que pertencem a um Business Manager
 */
export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
];

function requireConfig() {
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_REDIRECT_URI) {
    throw new HttpError(
      503,
      'Integração com a Meta não configurada. Preencha META_APP_ID, META_APP_SECRET e META_REDIRECT_URI no .env.',
      'integration_not_configured',
    );
  }
  return { appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, redirectUri: env.META_REDIRECT_URI };
}

export function buildAuthorizeUrl(state: string) {
  const cfg = requireConfig();
  const url = new URL(`https://www.facebook.com/${v()}/dialog/oauth`);
  url.searchParams.set('client_id', cfg.appId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  if (env.META_LOGIN_CONFIG_ID) url.searchParams.set('config_id', env.META_LOGIN_CONFIG_ID);
  else url.searchParams.set('scope', META_SCOPES.join(','));
  return url.toString();
}

type Method = 'GET' | 'POST' | 'DELETE';

async function graph<T = any>(
  operation: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  method: Method = 'GET',
  userId?: string,
): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH()}/${path}`);
  const body = new URLSearchParams();
  for (const [k, val] of Object.entries(params)) {
    if (val === undefined) continue;
    if (method === 'GET') url.searchParams.set(k, String(val));
    else body.set(k, String(val));
  }
  const res = await httpCall<any>({
    provider: 'META',
    operation,
    method,
    url: url.toString(),
    userId,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : body,
  });
  if (!res.ok) throw classifyError(res.status, res.data?.error);
  return res.data as T;
}

// ── OAuth ────────────────────────────────────────────────────

export async function exchangeCode(code: string, userId: string) {
  const cfg = requireConfig();
  const short = await graph<{ access_token: string }>(
    'oauth.exchange',
    'oauth/access_token',
    { client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: cfg.redirectUri, code },
    'GET',
    userId,
  );
  // Troca por token de longa duração (~60 dias). Tokens de página obtidos a partir dele não expiram.
  return graph<{ access_token: string; expires_in?: number }>(
    'oauth.long_lived',
    'oauth/access_token',
    { grant_type: 'fb_exchange_token', client_id: cfg.appId, client_secret: cfg.appSecret, fb_exchange_token: short.access_token },
    'GET',
    userId,
  );
}

export async function debugToken(token: string, userId?: string) {
  const cfg = requireConfig();
  const res = await graph<{ data: { is_valid: boolean; expires_at: number; data_access_expires_at: number; scopes: string[] } }>(
    'oauth.debug_token',
    'debug_token',
    { input_token: token, access_token: `${cfg.appId}|${cfg.appSecret}` },
    'GET',
    userId,
  );
  return res.data;
}

export const getMe = (token: string, userId?: string) =>
  graph<{ id: string; name: string; picture?: { data?: { url?: string } } }>(
    'user.me',
    'me',
    { fields: 'id,name,picture.type(large)', access_token: token },
    'GET',
    userId,
  );

export async function getGrantedPermissions(token: string, userId?: string) {
  const res = await graph<{ data: Array<{ permission: string; status: string }> }>(
    'user.permissions',
    'me/permissions',
    { access_token: token },
    'GET',
    userId,
  );
  return res.data.filter((p) => p.status === 'granted').map((p) => p.permission);
}

export async function revokeAppAccess(token: string, userId?: string) {
  await graph('oauth.revoke', 'me/permissions', { access_token: token }, 'DELETE', userId);
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  tasks?: string[];
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string };
}

export async function getPages(userToken: string, userId?: string): Promise<MetaPage[]> {
  const pages: MetaPage[] = [];
  let next: string | undefined = `${GRAPH()}/me/accounts`;
  let params: Record<string, string | undefined> = {
    fields: 'id,name,access_token,tasks,picture.type(large){url},instagram_business_account{id,username,name,profile_picture_url}',
    limit: '100',
    access_token: userToken,
  };
  while (next) {
    const res: { data: MetaPage[]; paging?: { next?: string } } = await graph('pages.list', next, params, 'GET', userId);
    pages.push(...res.data);
    next = res.paging?.next;
    params = {}; // a URL "next" já contém os parâmetros
  }
  return pages;
}

// ── Upload binário (rupload) ─────────────────────────────────

async function ruploadPost(operation: string, url: string, token: string, body: Readable, size: number, userId?: string) {
  const res = await httpCall<any>({
    provider: 'META',
    operation,
    method: 'POST',
    url,
    userId,
    timeoutMs: 30 * 60_000,
    duplex: 'half',
    headers: {
      Authorization: `OAuth ${token}`,
      offset: '0',
      file_size: String(size),
      'Content-Type': 'application/octet-stream',
    },
    body: body as unknown as HttpBody,
  });
  if (!res.ok) throw classifyError(res.status, res.data?.error ?? res.data?.debug_info);
  return res.data;
}

// ── Instagram: Reels ─────────────────────────────────────────

export async function igCreateReelContainer(
  igUserId: string,
  token: string,
  opts: { caption: string; shareToFeed: boolean; thumbOffsetMs?: number },
  userId?: string,
) {
  return graph<{ id: string; uri?: string }>(
    'ig.container.create',
    `${igUserId}/media`,
    {
      media_type: 'REELS',
      upload_type: 'resumable',
      caption: opts.caption,
      share_to_feed: opts.shareToFeed,
      thumb_offset: opts.thumbOffsetMs,
      access_token: token,
    },
    'POST',
    userId,
  );
}

export function igUpload(containerId: string, uri: string | undefined, token: string, body: Readable, size: number, userId?: string) {
  const url = uri ?? `${RUPLOAD}/ig-api-upload/${v()}/${containerId}`;
  return ruploadPost('ig.container.upload', url, token, body, size, userId);
}

export type IgContainerStatus = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';

export const igContainerStatus = (containerId: string, token: string, userId?: string) =>
  graph<{ id: string; status_code: IgContainerStatus; status?: string }>(
    'ig.container.status',
    containerId,
    { fields: 'id,status_code,status', access_token: token },
    'GET',
    userId,
  );

export const igPublish = (igUserId: string, containerId: string, token: string, userId?: string) =>
  graph<{ id: string }>('ig.media.publish', `${igUserId}/media_publish`, { creation_id: containerId, access_token: token }, 'POST', userId);

export const igMedia = (mediaId: string, token: string, userId?: string) =>
  graph<{ id: string; permalink?: string }>('ig.media.get', mediaId, { fields: 'id,permalink', access_token: token }, 'GET', userId);

export async function igPublishingLimit(igUserId: string, token: string, userId?: string) {
  const res = await graph<{ data: Array<{ quota_usage: number; config?: { quota_total: number } }> }>(
    'ig.publishing_limit',
    `${igUserId}/content_publishing_limit`,
    { fields: 'quota_usage,config', access_token: token },
    'GET',
    userId,
  );
  return res.data[0];
}

// ── Facebook: Reels de página ────────────────────────────────

export const fbReelStart = (pageId: string, token: string, userId?: string) =>
  graph<{ video_id: string; upload_url: string }>('fb.reel.start', `${pageId}/video_reels`, { upload_phase: 'start', access_token: token }, 'POST', userId);

export const fbReelUpload = (uploadUrl: string, token: string, body: Readable, size: number, userId?: string) =>
  ruploadPost('fb.reel.upload', uploadUrl, token, body, size, userId);

export const fbReelFinish = (pageId: string, videoId: string, token: string, description: string, userId?: string) =>
  graph<{ success: boolean; post_id?: string }>(
    'fb.reel.finish',
    `${pageId}/video_reels`,
    { upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description, access_token: token },
    'POST',
    userId,
  );

export interface FbVideoStatus {
  id: string;
  permalink_url?: string;
  status?: {
    video_status?: string;
    uploading_phase?: { status?: string };
    processing_phase?: { status?: string; error?: { message?: string } };
    publishing_phase?: { status?: string; publish_status?: string; error?: { message?: string } };
  };
}

export const fbVideoStatus = (videoId: string, token: string, userId?: string) =>
  graph<FbVideoStatus>('fb.video.status', videoId, { fields: 'id,status,permalink_url', access_token: token }, 'GET', userId);

// ── Facebook: vídeo comum (Resumable Upload API) ────────────

export async function fbUploadSessionStart(userToken: string, fileName: string, size: number, mimeType: string, userId?: string) {
  const cfg = requireConfig();
  return graph<{ id: string }>(
    'fb.upload.start',
    `${cfg.appId}/uploads`,
    { file_name: fileName, file_length: size, file_type: mimeType, access_token: userToken },
    'POST',
    userId,
  );
}

export async function fbUploadSessionTransfer(sessionId: string, userToken: string, body: Readable, size: number, userId?: string) {
  const res = await httpCall<{ h?: string; error?: any }>({
    provider: 'META',
    operation: 'fb.upload.transfer',
    method: 'POST',
    url: `${GRAPH()}/${sessionId}`,
    userId,
    timeoutMs: 30 * 60_000,
    duplex: 'half',
    headers: { Authorization: `OAuth ${userToken}`, file_offset: '0', 'Content-Length': String(size) },
    body: body as unknown as HttpBody,
  });
  if (!res.ok || !res.data.h) throw classifyError(res.status, res.data?.error);
  return res.data.h;
}

export const fbPageVideoCreate = (pageId: string, pageToken: string, handle: string, title: string, description: string, userId?: string) =>
  graph<{ id: string }>(
    'fb.video.create',
    `${pageId}/videos`,
    { fbuploader_video_file_chunk: handle, title: title || undefined, description, published: true, access_token: pageToken },
    'POST',
    userId,
  );

// ── Classificação de erros ───────────────────────────────────

export function classifyError(status: number, error?: any): PublishError {
  const code: number | undefined = error?.code;
  const sub: number | undefined = error?.error_subcode;
  const message: string = error?.error_user_msg || error?.message || `Erro da Meta (HTTP ${status})`;
  const trace = error?.fbtrace_id ? ` [fbtrace ${error.fbtrace_id}]` : '';
  const codeStr = `meta_${code ?? status}${sub ? `_${sub}` : ''}`;
  const full = `${message}${trace}`;

  if (code === 190 || code === 102 || sub === 463 || sub === 460 || sub === 467) return new TokenExpiredError(`Acesso à Meta expirou ou foi revogado. Reconecte a conta. (${message})`);
  if (code === 10 || (code !== undefined && code >= 200 && code < 300))
    return new PublishError('action', codeStr, `Permissão ausente na Meta: ${message}. Reconecte a conta concedendo todas as permissões ou verifique a revisão do app.`);
  if ([4, 17, 32, 613].includes(code ?? -1) || (code !== undefined && code >= 80001 && code <= 80014))
    return new PublishError('retry', codeStr, `Limite de requisições da Meta atingido. ${full}`, undefined, 15 * 60_000);
  if (sub === 2207042) return new PublishError('retry', codeStr, `Limite diário de publicações do Instagram atingido. ${full}`, undefined, 3 * 3600_000);
  if (code === 9007 || sub === 2207027) return new PublishError('retry', codeStr, `Mídia ainda em processamento. ${full}`, undefined, 30_000);
  if (code === 368) return new PublishError('action', codeStr, `A Meta bloqueou temporariamente esta ação: ${full}`);
  if (error?.is_transient || code === 1 || code === 2 || status >= 500) return new PublishError('retry', codeStr, full);
  return new PublishError('fatal', codeStr, full);
}
