import type { SVGProps } from 'react';
import type { Platform } from './types';

export const PLATFORMS: Record<Platform, { label: string; short: string; color: string; formatLabel: string }> = {
  TIKTOK: { label: 'TikTok', short: 'TT', color: 'var(--color-tiktok)', formatLabel: 'Vídeo' },
  INSTAGRAM: { label: 'Instagram', short: 'IG', color: 'var(--color-instagram)', formatLabel: 'Reels' },
  FACEBOOK: { label: 'Facebook', short: 'FB', color: 'var(--color-facebook)', formatLabel: 'Reels ou vídeo' },
};

export const PLATFORM_ORDER: Platform[] = ['TIKTOK', 'INSTAGRAM', 'FACEBOOK'];

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function TikTokGlyph({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden {...p}>
      <path d="M12.53.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
    </svg>
  );
}

function InstagramGlyph({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden {...p}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.4" />
      <circle cx="17.6" cy="6.4" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FacebookGlyph({ size = 16, ...p }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden {...p}>
      <path d="M9.1 23.69v-7.98H6.63v-3.67H9.1v-1.58c0-4.09 1.85-5.98 5.86-5.98.4 0 .95.04 1.47.1.39.04.77.1 1.14.2v3.32a8.6 8.6 0 0 0-.65-.03 27 27 0 0 0-.73-.01c-.71 0-1.26.1-1.68.31-.28.14-.51.35-.68.62-.26.42-.37 1-.37 1.75v1.3h3.92l-.39 2.1-.29 1.56h-3.24v8.25C19.4 23.24 24 18.18 24 12.04c0-6.62-5.37-12-12-12S0 5.42 0 12.04c0 5.63 3.87 10.35 9.1 11.65Z" />
    </svg>
  );
}

export function PlatformIcon({ platform, ...p }: IconProps & { platform: Platform }) {
  const Glyph = platform === 'TIKTOK' ? TikTokGlyph : platform === 'INSTAGRAM' ? InstagramGlyph : FacebookGlyph;
  return <Glyph style={{ color: PLATFORMS[platform].color, ...p.style }} {...p} />;
}

export const handle = (a: { name: string; username: string | null }) => (a.username ? `@${a.username.replace(/^@/, '')}` : a.name);
