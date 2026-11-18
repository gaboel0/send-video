import { describe, expect, it } from 'vitest';
import { aggregateStatus } from '../modules/activity/activity.js';
import { chunkPlan, chunkRanges } from '../modules/integrations/tiktok/api.js';
import { composeCaption } from '../modules/integrations/types.js';
import { validateTarget } from '../modules/integrations/validation.js';
import { sniffVideo } from '../modules/videos/routes.js';
import { decrypt, encrypt, hashPassword, verifyPassword } from './crypto.js';
import { startOfZonedWeek, zonedDayKey, zonedToUtc } from './time.js';

const MB = 1024 * 1024;

describe('crypto', () => {
  it('criptografa e descriptografa tokens', () => {
    const enc = encrypt('segredo-123');
    expect(enc).not.toContain('segredo');
    expect(decrypt(enc)).toBe('segredo-123');
  });
  it('detecta adulteração', () => {
    const enc = encrypt('abc');
    const parts = enc.split('.');
    parts[3] = Buffer.from('xyz').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it('verifica senha', async () => {
    const h = await hashPassword('minha-senha-forte');
    expect(await verifyPassword('minha-senha-forte', h)).toBe(true);
    expect(await verifyPassword('errada', h)).toBe(false);
  });
});

describe('sniffVideo', () => {
  const box = (type: string, brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from(type + brand)]);
  it('reconhece MP4, MOV e WebM pelos bytes', () => {
    expect(sniffVideo(box('ftyp', 'isom'))?.mime).toBe('video/mp4');
    expect(sniffVideo(box('ftyp', 'qt  '))?.mime).toBe('video/quicktime');
    expect(sniffVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))?.mime).toBe('video/webm');
  });
  it('rejeita outros arquivos', () => {
    expect(sniffVideo(Buffer.from('%PDF-1.7 something'))).toBeNull();
    expect(sniffVideo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});

describe('TikTok chunk plan', () => {
  it('arquivo pequeno vai em uma parte', () => {
    expect(chunkPlan(3 * MB)).toEqual({ chunkSize: 3 * MB, totalChunks: 1 });
    expect(chunkRanges(3 * MB)).toEqual([{ start: 0, end: 3 * MB - 1 }]);
  });
  it('arquivo grande: partes de 10 MB e a última absorve o resto', () => {
    const size = 105 * MB + 123;
    const ranges = chunkRanges(size);
    expect(ranges).toHaveLength(Math.floor(size / (10 * MB)));
    expect(ranges[0]).toEqual({ start: 0, end: 10 * MB - 1 });
    const last = ranges[ranges.length - 1];
    expect(last.end).toBe(size - 1);
    expect(last.end - last.start + 1).toBeLessThanOrEqual(128 * MB);
    // contíguas e sem sobreposição
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].start).toBe(ranges[i - 1].end + 1);
  });
});

describe('fuso America/Sao_Paulo', () => {
  it('converte horário de parede para UTC (UTC-3)', () => {
    expect(zonedToUtc(2026, 11, 18, 9, 30).toISOString()).toBe('2026-11-18T12:30:00.000Z');
  });
  it('chave do dia respeita o fuso', () => {
    expect(zonedDayKey(new Date('2026-11-19T02:00:00Z'))).toBe('2026-11-18');
  });
  it('semana começa na segunda 00:00 local', () => {
    expect(startOfZonedWeek(new Date('2026-11-18T15:00:00Z')).toISOString()).toBe('2026-11-16T03:00:00.000Z');
  });
});

describe('legenda e status', () => {
  it('monta legenda com hashtags normalizadas', () => {
    expect(composeCaption('Olá mundo ', ['#dica', 'rotas', ' '])).toBe('Olá mundo\n\n#dica #rotas');
    expect(composeCaption('', ['a'])).toBe('#a');
  });
  it('agrega status dos destinos', () => {
    expect(aggregateStatus(['PUBLISHED', 'PUBLISHED'])).toBe('PUBLISHED');
    expect(aggregateStatus(['PUBLISHED', 'FAILED'])).toBe('FAILED');
    expect(aggregateStatus(['SCHEDULED', 'PROCESSING'])).toBe('PROCESSING');
    expect(aggregateStatus(['CANCELED', 'CANCELED'])).toBe('CANCELED');
    expect(aggregateStatus(['CANCELED', 'SCHEDULED'])).toBe('SCHEDULED');
  });
});

describe('validação por plataforma', () => {
  const video = { mimeType: 'video/mp4', sizeBytes: BigInt(20 * MB), durationSec: 45, width: 1080, height: 1920 };
  const account = { platform: 'INSTAGRAM' as const, status: 'ACTIVE' as const, metadata: {}, name: 'perfil', connection: { scopes: [] } };

  it('aceita um Reel válido', () => {
    const issues = validateTarget({ platform: 'INSTAGRAM', caption: 'oi', hashtags: ['a'], options: {} }, video, account);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  it('bloqueia mais de 30 hashtags no Instagram', () => {
    const tags = Array.from({ length: 31 }, (_, i) => `tag${i}`);
    const issues = validateTarget({ platform: 'INSTAGRAM', caption: '', hashtags: tags, options: {} }, video, account);
    expect(issues.some((i) => i.level === 'error' && i.field === 'hashtags')).toBe(true);
  });
  it('bloqueia Reel do Facebook acima de 90s, mas permite como vídeo comum', () => {
    const long = { ...video, durationSec: 120 };
    const fb = { ...account, platform: 'FACEBOOK' as const };
    expect(validateTarget({ platform: 'FACEBOOK', caption: '', hashtags: [], options: { format: 'REEL' } }, long, fb).some((i) => i.level === 'error')).toBe(true);
    expect(validateTarget({ platform: 'FACEBOOK', caption: '', hashtags: [], options: { format: 'VIDEO' } }, long, fb).some((i) => i.level === 'error')).toBe(false);
  });
  it('TikTok direct exige privacidade e consentimento; inbox não', () => {
    const tt = { ...account, platform: 'TIKTOK' as const, metadata: { creatorInfo: { privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 60 } }, connection: { scopes: ['video.publish', 'video.upload'] } };
    const direct = validateTarget({ platform: 'TIKTOK', caption: '', hashtags: [], options: { mode: 'direct' } }, video, tt);
    expect(direct.filter((i) => i.level === 'error').map((i) => i.field)).toEqual(expect.arrayContaining(['privacyLevel', 'consent']));
    const ok = validateTarget({ platform: 'TIKTOK', caption: '', hashtags: [], options: { mode: 'direct', privacyLevel: 'SELF_ONLY', consent: true } }, video, tt);
    expect(ok.filter((i) => i.level === 'error')).toEqual([]);
    const tooLong = validateTarget({ platform: 'TIKTOK', caption: '', hashtags: [], options: { mode: 'direct', privacyLevel: 'SELF_ONLY', consent: true } }, { ...video, durationSec: 90 }, tt);
    expect(tooLong.some((i) => i.level === 'error' && i.field === 'video')).toBe(true);
    const inbox = validateTarget({ platform: 'TIKTOK', caption: '', hashtags: [], options: { mode: 'inbox' } }, video, tt);
    expect(inbox.filter((i) => i.level === 'error')).toEqual([]);
  });
});
