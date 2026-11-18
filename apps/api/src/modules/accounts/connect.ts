/**
 * Persistência das conexões após o OAuth e sincronização das contas de destino.
 */
import { decrypt, encrypt } from '../../lib/crypto.js';
import { prisma, type SocialConnection } from '../../lib/prisma.js';
import * as meta from '../integrations/meta/api.js';
import * as tiktok from '../integrations/tiktok/api.js';

export async function saveTikTokConnection(userId: string, t: tiktok.TikTokTokenResponse) {
  const info = await tiktok.getUserInfo(t.access_token, userId);
  const scopes = t.scope.split(',').map((s) => s.trim());
  const data = {
    displayName: info.display_name ?? 'TikTok',
    avatarUrl: info.avatar_url ?? null,
    accessTokenEnc: encrypt(t.access_token),
    refreshTokenEnc: encrypt(t.refresh_token),
    accessTokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
    refreshTokenExpiresAt: new Date(Date.now() + t.refresh_expires_in * 1000),
    scopes,
    status: 'ACTIVE' as const,
    lastError: null,
    lastSyncedAt: new Date(),
  };
  const connection = await prisma.socialConnection.upsert({
    where: { userId_provider_externalUserId: { userId, provider: 'TIKTOK', externalUserId: t.open_id } },
    create: { userId, provider: 'TIKTOK', externalUserId: t.open_id, ...data },
    update: data,
  });
  await syncTikTokAccount(connection, t.access_token);
  return connection;
}

export async function syncTikTokAccount(connection: SocialConnection, token?: string) {
  const accessToken = token ?? decrypt(connection.accessTokenEnc);
  let creatorInfo: tiktok.CreatorInfo | undefined;
  if (connection.scopes.includes('video.publish')) {
    creatorInfo = await tiktok.queryCreatorInfo(accessToken, connection.userId).catch(() => undefined);
  }
  const data = {
    connectionId: connection.id,
    name: creatorInfo?.creator_nickname ?? connection.displayName,
    username: creatorInfo?.creator_username ?? null,
    avatarUrl: creatorInfo?.creator_avatar_url ?? connection.avatarUrl,
    status: 'ACTIVE' as const,
    metadata: { creatorInfo: (creatorInfo as any) ?? null },
    lastSyncedAt: new Date(),
  };
  await prisma.socialAccount.upsert({
    where: { userId_platform_externalId: { userId: connection.userId, platform: 'TIKTOK', externalId: connection.externalUserId } },
    create: { userId: connection.userId, platform: 'TIKTOK', externalId: connection.externalUserId, ...data },
    update: data,
  });
}

export async function saveMetaConnection(userId: string, token: { access_token: string; expires_in?: number }) {
  const me = await meta.getMe(token.access_token, userId);
  const scopes = await meta.getGrantedPermissions(token.access_token, userId);
  const data = {
    displayName: me.name,
    avatarUrl: me.picture?.data?.url ?? null,
    accessTokenEnc: encrypt(token.access_token),
    refreshTokenEnc: null,
    accessTokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
    refreshTokenExpiresAt: null,
    scopes,
    status: 'ACTIVE' as const,
    lastError: null,
    lastSyncedAt: new Date(),
  };
  const connection = await prisma.socialConnection.upsert({
    where: { userId_provider_externalUserId: { userId, provider: 'META', externalUserId: me.id } },
    create: { userId, provider: 'META', externalUserId: me.id, ...data },
    update: data,
  });
  await syncMetaAccounts(connection, token.access_token);
  return connection;
}

/** Busca páginas e contas do Instagram ligadas a elas; contas que sumiram ficam REVOKED. */
export async function syncMetaAccounts(connection: SocialConnection, token?: string) {
  const userToken = token ?? decrypt(connection.accessTokenEnc);
  const pages = await meta.getPages(userToken, connection.userId);
  const seen = new Set<string>();

  for (const page of pages) {
    const pageData = {
      connectionId: connection.id,
      name: page.name,
      username: null,
      avatarUrl: page.picture?.data?.url ?? null,
      tokenEnc: encrypt(page.access_token),
      status: 'ACTIVE' as const,
      metadata: { tasks: page.tasks ?? [] },
      lastSyncedAt: new Date(),
    };
    const fb = await prisma.socialAccount.upsert({
      where: { userId_platform_externalId: { userId: connection.userId, platform: 'FACEBOOK', externalId: page.id } },
      create: { userId: connection.userId, platform: 'FACEBOOK', externalId: page.id, ...pageData },
      update: pageData,
    });
    seen.add(fb.id);

    const ig = page.instagram_business_account;
    if (ig) {
      const igData = {
        connectionId: connection.id,
        name: ig.name || ig.username || page.name,
        username: ig.username ?? null,
        avatarUrl: ig.profile_picture_url ?? null,
        tokenEnc: encrypt(page.access_token),
        status: 'ACTIVE' as const,
        metadata: { pageId: page.id, pageName: page.name },
        lastSyncedAt: new Date(),
      };
      const acc = await prisma.socialAccount.upsert({
        where: { userId_platform_externalId: { userId: connection.userId, platform: 'INSTAGRAM', externalId: ig.id } },
        create: { userId: connection.userId, platform: 'INSTAGRAM', externalId: ig.id, ...igData },
        update: igData,
      });
      seen.add(acc.id);
    }
  }

  await prisma.socialAccount.updateMany({
    where: { connectionId: connection.id, id: { notIn: [...seen] } },
    data: { status: 'REVOKED', tokenEnc: null },
  });
  await prisma.socialConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: new Date() } });
  return pages.length;
}
