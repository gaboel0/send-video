/**
 * Manutenção periódica das conexões:
 *  - TikTok: renova tokens perto de expirar (access 24 h; refresh 365 dias, renovado junto).
 *  - Meta: consulta debug_token para atualizar validade e detectar revogação.
 *  - Remove estados OAuth e sessões vencidos.
 */
import { integrationStatus } from '../../config/env.js';
import { decrypt } from '../../lib/crypto.js';
import { PublishError, TokenExpiredError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { debugToken } from '../integrations/meta/api.js';
import { getConnectionToken, markConnectionExpired } from '../integrations/tokens.js';

export async function runMaintenance(log: (msg: string) => void) {
  const now = new Date();
  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });

  const status = integrationStatus();
  const connections = await prisma.socialConnection.findMany({ where: { status: 'ACTIVE' } });
  for (const c of connections) {
    if ((c.provider === 'TIKTOK' && !status.tiktok.configured) || (c.provider === 'META' && !status.meta.configured)) continue;
    try {
      if (c.provider === 'TIKTOK') {
        const soon = new Date(Date.now() + 2 * 3600_000);
        if (!c.accessTokenExpiresAt || c.accessTokenExpiresAt < soon) {
          // força a renovação marcando como "quase expirado"
          await getConnectionToken({ ...c, accessTokenExpiresAt: new Date(0) });
          log(`[maintenance] token TikTok renovado: ${c.displayName}`);
        }
      } else {
        const lastCheck = c.lastSyncedAt?.getTime() ?? 0;
        if (Date.now() - lastCheck < 12 * 3600_000) continue;
        const info = await debugToken(decrypt(c.accessTokenEnc), c.userId);
        if (!info.is_valid) {
          await markConnectionExpired(c.id, 'Token da Meta inválido (debug_token)');
          log(`[maintenance] conexão Meta expirada: ${c.displayName}`);
          continue;
        }
        await prisma.socialConnection.update({
          where: { id: c.id },
          data: {
            accessTokenExpiresAt: info.expires_at ? new Date(info.expires_at * 1000) : null,
            scopes: info.scopes ?? c.scopes,
            lastSyncedAt: new Date(),
          },
        });
      }
    } catch (err) {
      if (err instanceof TokenExpiredError) continue; // já marcada como expirada
      const msg = err instanceof PublishError ? err.message : (err as Error).message;
      log(`[maintenance] falha ao verificar ${c.provider} ${c.displayName}: ${msg}`);
    }
  }
}
