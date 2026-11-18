export type Platform = 'TIKTOK' | 'INSTAGRAM' | 'FACEBOOK';
export type PublishStatus = 'DRAFT' | 'SCHEDULED' | 'QUEUED' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'NEEDS_ACTION' | 'CANCELED';
export type ConnectionStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ERROR';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Folder {
  id: string;
  name: string;
  color: string;
  count: number;
}

export interface Video {
  id: string;
  title: string;
  description: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  folderId: string | null;
  folder: { id: string; name: string; color: string } | null;
  createdAt: string;
  updatedAt: string;
  thumbnailUrl: string | null;
  streamUrl: string;
  usage: { total: number; scheduled: number; published: number; attention: number; drafts: number };
  duplicateOf?: { id: string; title: string } | null;
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

export interface SocialAccount {
  id: string;
  platform: Platform;
  externalId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  status: ConnectionStatus;
  enabled: boolean;
  lastSyncedAt: string | null;
  metadata: { creatorInfo?: CreatorInfo | null; pageId?: string; pageName?: string; tasks?: string[] };
}

export interface Connection {
  id: string;
  provider: 'TIKTOK' | 'META';
  displayName: string;
  avatarUrl: string | null;
  status: ConnectionStatus;
  scopes: string[];
  lastError: string | null;
  lastSyncedAt: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  createdAt: string;
  accounts: SocialAccount[];
}

export interface IntegrationStatus {
  tiktok: { configured: boolean; missing: string[]; postMode: 'direct' | 'inbox' };
  meta: { configured: boolean; missing: string[]; graphVersion: string };
}

export interface PostTarget {
  id: string;
  accountId: string;
  platform: Platform;
  caption: string;
  hashtags: string[];
  options: Record<string, any>;
  status: PublishStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  phase: string | null;
  externalId: string | null;
  permalink: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  publishedAt: string | null;
  account: { id: string; name: string; username: string | null; avatarUrl: string | null; platform: Platform; status: ConnectionStatus };
}

export interface Post {
  id: string;
  title: string;
  status: PublishStatus;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  video: Video;
  targets: PostTarget[];
}

export interface Attempt {
  id: string;
  targetId: string;
  attemptNo: number;
  phase: string | null;
  outcome: 'IN_PROGRESS' | 'SUCCESS' | 'CONTINUE' | 'RETRY' | 'FAILED' | 'NEEDS_ACTION';
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface Activity {
  id: string;
  type: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  message: string;
  postId: string | null;
  createdAt: string;
}

export interface PostDetail extends Post {
  attempts: Attempt[];
  activity: Activity[];
}

export interface Issue {
  level: 'error' | 'warning';
  field?: string;
  message: string;
}

export interface Dashboard {
  stats: { videos: number; scheduled: number; published: number; failed: number; needsAction: number; drafts: number };
  nextAt: string | null;
  upcoming: Array<{
    id: string;
    title: string;
    scheduledAt: string;
    status: PublishStatus;
    thumbnailUrl: string | null;
    durationSec: number | null;
    targets: Array<{ id: string; platform: Platform; status: PublishStatus; account: { name: string; username: string | null } }>;
  }>;
  accounts: Array<{ id: string; platform: Platform; name: string; username: string | null; avatarUrl: string | null; status: ConnectionStatus }>;
  week: {
    start: string;
    days: Array<{ date: string; total: number; published: number; failed: number; pending: number; platforms: Record<Platform, number> }>;
  };
  activity: Activity[];
}
