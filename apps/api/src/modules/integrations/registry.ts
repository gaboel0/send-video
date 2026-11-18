import type { Platform } from '../../lib/prisma.js';
import { facebookPublisher } from './meta/facebook.publisher.js';
import { instagramPublisher } from './meta/instagram.publisher.js';
import { tiktokPublisher } from './tiktok/publisher.js';
import type { Publisher } from './types.js';

export const publishers: Record<Platform, Publisher> = {
  TIKTOK: tiktokPublisher,
  INSTAGRAM: instagramPublisher,
  FACEBOOK: facebookPublisher,
};
