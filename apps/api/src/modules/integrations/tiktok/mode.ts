import { env } from '../../../config/env.js';
import type { TikTokOptions } from '../types.js';

/**
 * Decide entre Direct Post e envio para rascunho (inbox):
 *  - respeita a escolha explícita da publicação;
 *  - senão usa TIKTOK_POST_MODE;
 *  - se o usuário não concedeu video.publish mas concedeu video.upload, cai para inbox.
 */
export function resolveTikTokMode(opts: TikTokOptions, scopes: string[]): 'direct' | 'inbox' {
  const wanted = opts.mode ?? env.TIKTOK_POST_MODE;
  if (wanted === 'direct' && !scopes.includes('video.publish') && scopes.includes('video.upload')) return 'inbox';
  return wanted;
}
