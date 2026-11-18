import { decrypt, encrypt } from '../../lib/crypto.js';
import { PublishError, TokenExpiredError } from '../../lib/errors.js';
import { prisma, type SocialAccount, type SocialConnection } from '../../lib/prisma.js';
import * as tiktok from './tiktok/api.js';

const REFRESH_MARGIN_MS = 10 * 60_000;

export async function markConnectionExpired(connectionId: string, reason: string) {
  await prisma.$transaction([
    prisma.socialConnection.update({ where: { id: connectionId }, data: { status: 'EXPIRED', lastError: reason } }),
    prisma.socialAccount.updateMany({ where: { connectionId }, data: { status: 'EXPIRED' } }),
  ]);
}

/** Token de acesso da conexão, renovando automaticamente quando necessário (TikTok: 24 h). */
export async function getConnectionToken(connection: SocialConnection): Promise<string> {
  if (connection.status === 'REVOKED') throw new TokenExpiredError('A conta foi desconectada. Conecte novamente.');
  if (connection.status === 'EXPIRED') throw new TokenExpiredError();

  const expiresAt = connection.accessTokenExpiresAt?.getTime() ?? Infinity;
  if (expiresAt - Date.now() > REFRESH_MARGIN_MS) return decrypt(connection.accessTokenEnc);

  if (connection.provider === 'TIKTOK') return refreshTikTok(connection);

  // Meta: token de usuário de longa duração (~60 dias) não pode ser renovado sem nova autorização
  await markConnectionExpired(connection.id, 'Token da Meta expirou');
  throw new TokenExpiredError('O acesso à Meta expirou (validade de ~60 dias). Reconecte a conta.');
}

async function refreshTikTok(connection: SocialConnection): Promise<string> {
  if (!connection.refreshTokenEnc) throw new TokenExpiredError();
  if (connection.refreshTokenExpiresAt && connection.refreshTokenExpiresAt < new Date()) {
    await markConnectionExpired(connection.id, 'Refresh token do TikTok expirou');
    throw new TokenExpiredError();
  }
  // Releitura para evitar duas renovações concorrentes usando o mesmo refresh token
  const fresh = await prisma.socialConnection.findUniqueOrThrow({ where: { id: connection.id } });
  if (fresh.accessTokenExpiresAt && fresh.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return decrypt(fresh.accessTokenEnc);
  }
  try {
    const t = await tiktok.refreshAccessToken(decrypt(fresh.refreshTokenEnc!), connection.userId);
    await prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEnc: encrypt(t.access_token),
        refreshTokenEnc: encrypt(t.refresh_token),
        accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
        refreshTokenExpiresAt: new Date(Date.now() + t.refresh_expires_in * 1000),
        scopes: t.scope.split(','),
        status: 'ACTIVE',
        lastError: null,
      },
    });
    return t.access_token;
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      await markConnectionExpired(connection.id, 'Renovação do token do TikTok recusada');
    }
    throw err;
  }
}

/** Token da página (Facebook) ou da página vinculada (Instagram). Não expira enquanto o usuário mantiver a autorização. */
export function getAccountToken(account: SocialAccount & { connection: SocialConnection }): string {
  if (account.status === 'REVOKED' || account.connection.status === 'REVOKED') {
    throw new TokenExpiredError('A conta foi desconectada. Conecte novamente.');
  }
  if (account.status === 'EXPIRED' || account.connection.status === 'EXPIRED') throw new TokenExpiredError();
  if (!account.tokenEnc) throw new PublishError('action', 'missing_page_token', 'Token da página ausente. Reconecte a conta Meta.');
  return decrypt(account.tokenEnc);
}
