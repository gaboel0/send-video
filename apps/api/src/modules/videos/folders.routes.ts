import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { conflict, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth, userOf } from '../auth/session.js';

const COLORS = ['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
const folderBody = z.object({ name: z.string().trim().min(1, 'Dê um nome à pasta').max(60), color: z.enum(COLORS).optional() });

export async function folderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/folders', async (req) => {
    const user = userOf(req);
    const folders = await prisma.folder.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
      include: { _count: { select: { videos: { where: { deletedAt: null } } } } },
    });
    const unfiled = await prisma.video.count({ where: { userId: user.id, folderId: null, deletedAt: null } });
    const total = await prisma.video.count({ where: { userId: user.id, deletedAt: null } });
    return {
      total,
      unfiled,
      folders: folders.map((f) => ({ id: f.id, name: f.name, color: f.color, count: f._count.videos })),
    };
  });

  app.post('/api/folders', async (req) => {
    const user = userOf(req);
    const body = folderBody.parse(req.body);
    if (await prisma.folder.findFirst({ where: { userId: user.id, name: body.name } })) throw conflict('Já existe uma pasta com esse nome');
    return prisma.folder.create({ data: { userId: user.id, name: body.name, color: body.color ?? 'slate' } });
  });

  app.patch('/api/folders/:id', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = folderBody.partial().parse(req.body);
    const folder = await prisma.folder.findFirst({ where: { id, userId: user.id } });
    if (!folder) throw notFound('Pasta não encontrada');
    if (body.name && body.name !== folder.name && (await prisma.folder.findFirst({ where: { userId: user.id, name: body.name } }))) {
      throw conflict('Já existe uma pasta com esse nome');
    }
    return prisma.folder.update({ where: { id }, data: body });
  });

  app.delete('/api/folders/:id', async (req) => {
    const user = userOf(req);
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const folder = await prisma.folder.findFirst({ where: { id, userId: user.id } });
    if (!folder) throw notFound('Pasta não encontrada');
    await prisma.folder.delete({ where: { id } }); // vídeos voltam para "sem pasta"
    return { ok: true };
  });
}
