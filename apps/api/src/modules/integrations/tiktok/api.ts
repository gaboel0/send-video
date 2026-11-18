/**
 * Cliente da API oficial do TikTok (Login Kit v2 + Content Posting API).
 * Docs: https://developers.tiktok.com/doc/content-posting-api-get-started
 */
import { env } from '../../../config/env.js';
import { HttpError, PublishError, TokenExpiredError } from '../../../lib/errors.js';
import { httpCall } from '../../../lib/http.js';

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const API = 'https://open.tiktokapis.com/v2';

export const TIKTOK_SCOPES = ['user.info.basic', 'video.publish', 'video.upload'];

function requireConfig() {
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET || !env.TIKTOK_REDIRECT_URI) {
    throw new HttpError(
      503,
      'Integração com TikTok não configurada. Preencha TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET e TIKTOK_REDIRECT_URI no .env.',
      'integration_not_configured',
    );
  }
  return {
    clientKey: env.TIKTOK_CLIENT_KEY,
    clientSecret: env.TIKTOK_CLIENT_SECRET,
    redirectUri: env.TIKTOK_REDIRECT_URI,
  };
}

export function buildAuthorizeUrl(state: string) {
  const cfg = requireConfig();
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_key', cfg.clientKey);
  url.searchParams.set('scope', TIKTOK_SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export interface TikTokTokenResponse {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_token: string;
  refresh_expires_in: number;
  scope: string;
  token_type: string;
}

async function tokenRequest(params: Record<string, string>, operation: string, userId?: string) {
  const cfg = requireConfig();
  const res = await httpCall<TikTokTokenResponse & { error?: string; error_description?: string }>({
    provider: 'TIKTOK',
    operation,
    method: 'POST',
    url: `${API}/oauth/token/`,
    userId,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: cfg.clientKey, client_secret: cfg.clientSecret, ...params }),
  });
  if (!res.ok || !res.data.access_token) {
    const code = res.data?.error ?? String(res.status);
    if (code === 'invalid_grant' || code === 'invalid_request') throw new TokenExpiredError();
    throw new PublishError(res.status >= 500 ? 'retry' : 'action', `tiktok_${code}`, res.data?.error_description ?? 'Falha ao obter token do TikTok');
  }
  return res.data;
}

export const exchangeCode = (code: string, userId: string) =>
  tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: requireConfig().redirectUri }, 'oauth.exchange', userId);

export const refreshAccessToken = (refreshToken: string, userId?: string) =>
  tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' }, 'oauth.refresh', userId);

export async function revokeToken(token: string, userId?: string) {
  const cfg = requireConfig();
  await httpCall({
    provider: 'TIKTOK',
    operation: 'oauth.revoke',
    method: 'POST',
    url: `${API}/oauth/revoke/`,
    userId,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: cfg.clientKey, client_secret: cfg.clientSecret, token }),
  });
}

// ── Chamadas autenticadas ────────────────────────────────────

async function api<T>(token: string, operation: string, path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}, userId?: string) {
  const res = await httpCall<{ data: T; error: { code: string; message: string; log_id: string } }>({
    provider: 'TIKTOK',
    operation,
    method: init.method ?? 'GET',
    url: `${API}${path}`,
    userId,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw classifyError(res.status, res.data?.error?.code, res.data?.error?.message, res.data?.error?.log_id);
  return res.data.data;
}

export interface TikTokUserInfo {
  open_id: string;
  union_id?: string;
  avatar_url?: string;
  display_name?: string;
}

export async function getUserInfo(token: string, userId?: string) {
  const data = await api<{ user: TikTokUserInfo }>(
    token,
    'user.info',
    '/user/info/?fields=open_id,union_id,avatar_url,display_name',
    {},
    userId,
  );
  return data.user;
}

export interface CreatorInfo {
  creator_avatar_url: string;
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

export const queryCreatorInfo = (token: string, userId?: string) =>
  api<CreatorInfo>(token, 'post.creator_info', '/post/publish/creator_info/query/', { method: 'POST' }, userId);

// ── Upload em partes ─────────────────────────────────────────
// Regras do TikTok: partes entre 5 MB e 64 MB (a última pode chegar a 128 MB).
// Arquivos < 5 MB vão em uma única parte. total_chunk_count = floor(tamanho / chunk_size).
const MB = 1024 * 1024;
export function chunkPlan(size: number) {
  if (size <= 64 * MB) return { chunkSize: size, totalChunks: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, totalChunks: Math.floor(size / chunkSize) };
}

export function chunkRanges(size: number) {
  const { chunkSize, totalChunks } = chunkPlan(size);
  return Array.from({ length: totalChunks }, (_, i) => {
    const start = i * chunkSize;
    const end = i === totalChunks - 1 ? size - 1 : start + chunkSize - 1;
    return { start, end };
  });
}

export interface InitResult {
  publish_id: string;
  upload_url: string;
}

export function initDirectPost(
  token: string,
  postInfo: Record<string, unknown>,
  videoSize: number,
  userId?: string,
) {
  const { chunkSize, totalChunks } = chunkPlan(videoSize);
  return api<InitResult>(
    token,
    'post.direct.init',
    '/post/publish/video/init/',
    {
      method: 'POST',
      body: {
        post_info: postInfo,
        source_info: { source: 'FILE_UPLOAD', video_size: videoSize, chunk_size: chunkSize, total_chunk_count: totalChunks },
      },
    },
    userId,
  );
}

export function initInboxUpload(token: string, videoSize: number, userId?: string) {
  const { chunkSize, totalChunks } = chunkPlan(videoSize);
  return api<InitResult>(
    token,
    'post.inbox.init',
    '/post/publish/inbox/video/init/',
    {
      method: 'POST',
      body: {
        source_info: { source: 'FILE_UPLOAD', video_size: videoSize, chunk_size: chunkSize, total_chunk_count: totalChunks },
      },
    },
    userId,
  );
}

export async function uploadChunk(
  uploadUrl: string,
  data: Buffer,
  range: { start: number; end: number },
  total: number,
  mimeType: string,
  userId?: string,
) {
  const res = await httpCall({
    provider: 'TIKTOK',
    operation: 'post.upload_chunk',
    method: 'PUT',
    url: uploadUrl,
    userId,
    timeoutMs: 10 * 60_000,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(data.length),
      'Content-Range': `bytes ${range.start}-${range.end}/${total}`,
    },
    body: new Uint8Array(data),
  });
  if (res.status !== 201 && res.status !== 206 && !res.ok) {
    throw new PublishError(res.status >= 500 ? 'retry' : 'fatal', `tiktok_upload_${res.status}`, 'Falha ao enviar o arquivo ao TikTok');
  }
}

export interface PublishStatus {
  status: 'PROCESSING_UPLOAD' | 'PROCESSING_DOWNLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED';
  fail_reason?: string;
  publicaly_available_post_id?: Array<string | number>;
  uploaded_bytes?: number;
}

export const fetchPublishStatus = (token: string, publishId: string, userId?: string) =>
  api<PublishStatus>(token, 'post.status', '/post/publish/status/fetch/', { method: 'POST', body: { publish_id: publishId } }, userId);

// ── Classificação de erros ───────────────────────────────────

const FRIENDLY: Record<string, string> = {
  access_token_invalid: 'O token do TikTok é inválido ou expirou. Reconecte a conta.',
  scope_not_authorized: 'A conta não concedeu a permissão necessária (video.publish / video.upload). Reconecte autorizando todas as permissões.',
  scope_permission_missed: 'O app ainda não tem a permissão necessária aprovada pelo TikTok.',
  rate_limit_exceeded: 'Limite de requisições do TikTok atingido. Nova tentativa em instantes.',
  spam_risk_too_many_posts: 'O TikTok limitou o número de publicações diárias desta conta.',
  spam_risk_user_banned_from_posting: 'Esta conta está temporariamente impedida de publicar pelo TikTok.',
  reached_active_user_cap: 'O app atingiu o limite diário de criadores ativos permitido pelo TikTok.',
  unaudited_client_can_only_post_to_private_accounts:
    'O app ainda não passou na auditoria do TikTok: só pode publicar com privacidade "Somente eu" em contas privadas. Use o modo rascunho (inbox) ou solicite a auditoria.',
  privacy_level_option_mismatch: 'A privacidade escolhida não está disponível para esta conta. Edite a publicação.',
  url_ownership_unverified: 'Domínio não verificado no TikTok.',
  file_format_check_failed: 'Formato de vídeo não aceito pelo TikTok.',
  duration_check_failed: 'Duração do vídeo fora do limite permitido pelo TikTok para esta conta.',
  frame_rate_check_failed: 'Taxa de quadros não aceita pelo TikTok (use 23 a 60 fps).',
  picture_size_check_failed: 'Resolução não aceita pelo TikTok (mínimo 360 px).',
  video_pull_failed: 'O TikTok não conseguiu baixar o vídeo.',
  internal_error: 'Erro interno do TikTok.',
};

export function classifyError(status: number, code = 'unknown', message = '', logId?: string) {
  const friendly = FRIENDLY[code] ?? (message || `Erro do TikTok (${code})`);
  const full = logId ? `${friendly} [log_id ${logId}]` : friendly;
  if (code === 'access_token_invalid') return new TokenExpiredError(full);
  if (code === 'rate_limit_exceeded') return new PublishError('retry', code, full, undefined, 60_000);
  if (code === 'spam_risk_too_many_posts') return new PublishError('retry', code, full, undefined, 6 * 3600_000);
  if (
    [
      'scope_not_authorized',
      'scope_permission_missed',
      'spam_risk_user_banned_from_posting',
      'reached_active_user_cap',
      'unaudited_client_can_only_post_to_private_accounts',
      'url_ownership_unverified',
    ].includes(code)
  )
    return new PublishError('action', code, full);
  if (status >= 500 || code === 'internal_error') return new PublishError('retry', code, full);
  return new PublishError('fatal', code, full);
}
