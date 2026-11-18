import type { FastifyInstance, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { badRequest, conflict, HttpError, notFound } from '../../lib/errors.js';
import { prisma, type Prisma } from '../../lib/prisma.js';
import { requireAuth, userOf } from '../auth/session.js';
import { storage } from '../storage/storage.js';

/** Identifica o formato pelos bytes iniciais (não confia na extensão nem no Content-Type) */
export function sniffVideo(head: Buffer): { mime: string; ext: string } | null {
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return { mime: 'video/webm', ext: 'webm' };
  }
  if (head.length >= 12) {
    const box = head.subarray(4, 8).toString('latin1');
    if (box === 'ftyp') {
      const brand = head.subarray(8, 12).toString('latin1');
      if (brand === 'qt  ') return { mime: 'video/quicktime', ext: 'mov' };
      return { mime: 'video/mp4', ext: 'mp4' };
    }
    if (['moov', 'mdat', 'wide', 'free', 'skip'].includes(box)) return { mime: 'video/quicktime', ext: 'mov' };
  }
  return null;
}

function sniffImage(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const STATUS_FILTER = {
  unused: { posts: { none: { status: { not: 'CANCELED' } } } },
  scheduled: { posts: { some: { status: { in: ['SCHEDULED', 'QUEUED', 'PROCESSING'] } } } },
  published: { posts: { some: { targets: { some: { status: 'PUBLISHED' } } } } },
  attention: { posts: { some: { status: { in: ['FAILED', 'NEEDS_ACTION'] } } } },
  draft: { posts: { some: { status: 'DRAFT' } } },
} satisfies Record<string, Prisma.VideoWhereInput>;

export function serializeVideo(v: any) {
  const posts: Array<{ status: string; targets?: Array<{ status: string }> }> = v.posts ?? [];
  return {
    id: v.id,
    title: v.title,
    description: v.description,
    originalName: v.originalName,
    mimeType: v.mimeType,
    sizeBytes: Number(v.sizeBytes),
    durationSec: v.durationSec,
    width: v.width,
    height: v.height,
    folderId: v.folderId,
    folder: v.folder ? { id: v.folder.id, name: v.folder.name, color: v.folder.color } : null,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
    thumbnailUrl: v.thumbnailKey ? `/api/videos/${v.id}/thumbnail?v=${v.updatedAt.getTime()}` : null,
    streamUrl: `/api/videos/${v.id}/stream`,
    usage: {
      total: posts.filter((p) => p.status !== 'CANCELED').length,
      scheduled: posts.filter((p) => ['SCHEDULED', 'QUEUED', 'PROCESSING'].includes(p.status)).length,
      published: posts.filter((p) => p.targets?.some((t) => t.status === 'PUBLISHED')).length,
      attention: posts.filter((p) => ['FAILED', 'NEEDS_ACTION'].includes(p.status)).length,
      drafts: posts.filter((p) => p.status === 'DRAFT').length,
    },
  };
}

const videoInclude = {
  folder: true,
  posts: { select: { status: true, targets: { select: { status: true } } } },
} as const;

export async function videoRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/videos', async (req) => {
    const user = userOf(req);
    const q = z
      .object({
        search: z.string().trim().optional(),
        folderId: z.string().optional(),
        status: z.enum(['unused', 'scheduled', 'published', 'attention', 'draft']).optional(),
        sort: z.enum(['recent', 'oldest', 'name', 'size']).default('recent'),
      })
      .parse(req.query);
    const where: Prisma.VideoWhereInput = {
      userId: user.id,
      deletedAt: null,
      ...(q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] } : {}),
      ...(q.folderId === 'none' ? { folderId: null } : q.folderId ? { folderId: q.folderId } : {}),
      ...(q.status ? STATUS_FILTER[q.status] : {}),
    };
    const orderBy: Prisma.VideoOrderByWithRelationInput =
      q.sort === 'oldest' ? { createdAt: 'asc' } : q.sort === 'name' ? { title: 'asc' } : q.sort === 'size' ? { sizeBytes: 'desc' } : { createdAt: 'desc' };
    const videos = await prisma.video.findMany({ where, orderBy, include: videoInclude, take: 500 });
    return videos.map(serializeVideo);
  });

  app.get('/api/videos/:id', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const video = await prisma.video.findFirst({ where: { id, userId: user.id, deletedAt: null }, include: videoInclude });
    if (!video) throw notFound('Vídeo não encontrado');
    const posts = await prisma.post.findMany({
      where: { videoId: id },
      orderBy: { createdAt: 'desc' },
      include: { targets: { select: { id: true, platform: true, status: true, permalink: true, account: { select: { name: true, username: true } } } } },
    });
    return { ...serializeVideo(video), posts };
  });

  app.post('/api/videos', { bodyLimit: env.MAX_UPLOAD_MB * 1024 * 1024 + 5 * 1024 * 1024 }, async (req) => {
    const user = userOf(req);
    const fields: Record<string, string> = {};
    let thumb: Buffer | undefined;
    let file: { tmp: string; size: number; sha256: string; mime: string; ext: string; originalName: string } | undefined;

    try {
      for await (const part of req.parts({ limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 2, fields: 20 } })) {
        if (part.type === 'field') {
          fields[part.fieldname] = String(part.value ?? '');
          continue;
        }
        if (part.fieldname === 'thumbnail') {
          const buf = await part.toBuffer();
          if (buf.length > 3 * 1024 * 1024) throw badRequest('Miniatura muito grande (máx. 3 MB)');
          if (!sniffImage(buf)) throw badRequest('Miniatura inválida');
          thumb = buf;
          continue;
        }
        if (part.fieldname !== 'file') {
          part.file.resume();
          continue;
        }
        const tmp = path.join(os.tmpdir(), `sendvideo-${crypto.randomUUID()}`);
        const hash = crypto.createHash('sha256');
        let size = 0;
        let head = Buffer.alloc(0);
        const meter = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            size += chunk.length;
            if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
            hash.update(chunk);
            cb(null, chunk);
          },
        });
        await pipeline(part.file, meter, fs.createWriteStream(tmp));
        if (part.file.truncated) {
          await fsp.rm(tmp, { force: true });
          throw new HttpError(413, `O arquivo passa do limite de ${env.MAX_UPLOAD_MB} MB`, 'file_too_large');
        }
        const kind = sniffVideo(head);
        if (!kind) {
          await fsp.rm(tmp, { force: true });
          throw badRequest('Formato não suportado. Envie MP4, MOV ou WebM.');
        }
        if (size === 0) {
          await fsp.rm(tmp, { force: true });
          throw badRequest('Arquivo vazio');
        }
        file = { tmp, size, sha256: hash.digest('hex'), mime: kind.mime, ext: kind.ext, originalName: part.filename || `video.${kind.ext}` };
      }
    } catch (err) {
      if (file) await fsp.rm(file.tmp, { force: true });
      if ((err as any)?.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, `O arquivo passa do limite de ${env.MAX_UPLOAD_MB} MB`, 'file_too_large');
      throw err;
    }
    if (!file) throw badRequest('Nenhum vídeo enviado (campo "file")');

    const meta = z
      .object({
        title: z.string().trim().max(200).optional(),
        description: z.string().max(5000).optional(),
        folderId: z.string().optional(),
        durationSec: z.coerce.number().positive().max(24 * 3600).optional(),
        width: z.coerce.number().int().positive().max(16384).optional(),
        height: z.coerce.number().int().positive().max(16384).optional(),
      })
      .parse(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '')));

    if (meta.folderId && !(await prisma.folder.findFirst({ where: { id: meta.folderId, userId: user.id } }))) {
      meta.folderId = undefined;
    }

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const base = `videos/${user.id}/${id}`;
    const storageKey = `${base}/original.${file.ext}`;
    try {
      await storage.putFile(storageKey, file.tmp, file.mime);
      if (thumb) await storage.putBuffer(`${base}/thumb.jpg`, thumb, 'image/jpeg');
    } catch (err) {
      await fsp.rm(file.tmp, { force: true });
      throw err;
    }

    const video = await prisma.video.create({
      data: {
        id,
        userId: user.id,
        folderId: meta.folderId ?? null,
        title: meta.title || file.originalName.replace(/\.[^.]+$/, ''),
        description: meta.description ?? '',
        originalName: file.originalName,
        storageKey,
        thumbnailKey: thumb ? `${base}/thumb.jpg` : null,
        mimeType: file.mime,
        sizeBytes: BigInt(file.size),
        durationSec: meta.durationSec ?? null,
        width: meta.width ?? null,
        height: meta.height ?? null,
        sha256: file.sha256,
      },
      include: videoInclude,
    });
    const duplicate = await prisma.video.findFirst({
      where: { userId: user.id, sha256: file.sha256, deletedAt: null, id: { not: video.id } },
      select: { id: true, title: true },
    });
    return { ...serializeVideo(video), duplicateOf: duplicate };
  });

  app.patch('/api/videos/:id', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(5000).optional(),
        folderId: z.string().nullable().optional(),
      })
      .parse(req.body);
    const video = await prisma.video.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!video) throw notFound('Vídeo não encontrado');
    if (body.folderId && !(await prisma.folder.findFirst({ where: { id: body.folderId, userId: user.id } }))) {
      throw badRequest('Pasta não encontrada');
    }
    const updated = await prisma.video.update({ where: { id }, data: body, include: videoInclude });
    return serializeVideo(updated);
  });

  app.put('/api/videos/:id/thumbnail', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const video = await prisma.video.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!video) throw notFound('Vídeo não encontrado');
    const part = await req.file({ limits: { fileSize: 3 * 1024 * 1024 } });
    if (!part) throw badRequest('Envie a imagem no campo "thumbnail"');
    const buf = await part.toBuffer();
    if (!sniffImage(buf)) throw badRequest('Imagem inválida');
    const key = `videos/${user.id}/${id}/thumb.jpg`;
    await storage.putBuffer(key, buf, 'image/jpeg');
    const updated = await prisma.video.update({ where: { id }, data: { thumbnailKey: key }, include: videoInclude });
    return serializeVideo(updated);
  });

  app.delete('/api/videos/:id', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const video = await prisma.video.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!video) throw notFound('Vídeo não encontrado');
    const active = await prisma.post.count({ where: { videoId: id, status: { in: ['SCHEDULED', 'QUEUED', 'PROCESSING'] } } });
    if (active > 0) throw conflict('Este vídeo tem publicações agendadas. Cancele-as antes de excluir.');
    const history = await prisma.post.count({ where: { videoId: id } });
    if (history > 0) {
      // Mantém o registro para o histórico, mas libera o arquivo
      await prisma.video.update({ where: { id }, data: { deletedAt: new Date() } });
      await prisma.post.updateMany({ where: { videoId: id, status: 'DRAFT' }, data: { status: 'CANCELED' } });
      await prisma.postTarget.updateMany({ where: { post: { videoId: id }, status: 'DRAFT' }, data: { status: 'CANCELED' } });
    } else {
      await prisma.video.delete({ where: { id } });
    }
    await storage.remove(video.storageKey).catch(() => {});
    if (video.thumbnailKey) await storage.remove(video.thumbnailKey).catch(() => {});
    return { ok: true };
  });

  app.get('/api/videos/:id/thumbnail', async (req, reply) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const video = await prisma.video.findFirst({ where: { id, userId: user.id }, select: { thumbnailKey: true } });
    if (!video?.thumbnailKey) throw notFound();
    reply.header('Content-Type', 'image/jpeg').header('Cache-Control', 'private, max-age=86400');
    return reply.send(await storage.read(video.thumbnailKey));
  });

  app.get('/api/videos/:id/stream', async (req, reply) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const video = await prisma.video.findFirst({ where: { id, userId: user.id, deletedAt: null } });
    if (!video) throw notFound();
    return streamWithRange(reply, req.headers.range, video.storageKey, Number(video.sizeBytes), video.mimeType);
  });
}

async function streamWithRange(reply: FastifyReply, range: string | undefined, key: string, size: number, mime: string) {
  reply.header('Accept-Ranges', 'bytes').header('Content-Type', mime).header('Cache-Control', 'private, max-age=3600');
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) {
    reply.header('Content-Length', size);
    return reply.send(await storage.read(key));
  }
  let start = m[1] ? Number(m[1]) : size - Number(m[2]);
  let end = m[1] && m[2] ? Number(m[2]) : size - 1;
  if (!m[1]) end = size - 1;
  end = Math.min(end, size - 1, start + 8 * 1024 * 1024 - 1); // fatias de até 8 MB
  start = Math.max(0, start);
  if (start > end || start >= size) {
    return reply.code(416).header('Content-Range', `bytes */${size}`).send();
  }
  reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1);
  return reply.send(await storage.read(key, { start, end }));
}
