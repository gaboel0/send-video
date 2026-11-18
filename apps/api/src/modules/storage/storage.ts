import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../../config/env.js';

export interface Storage {
  /** Move/copia um arquivo local para o armazenamento definitivo */
  putFile(key: string, localPath: string, contentType: string): Promise<void>;
  putBuffer(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Leitura de um intervalo de bytes (fim inclusivo). Sem intervalo, o arquivo inteiro. */
  read(key: string, range?: { start: number; end: number }): Promise<Readable>;
  size(key: string): Promise<number>;
  remove(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  private root = path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR);

  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error('Chave de armazenamento inválida');
    return p;
  }

  async putFile(key: string, localPath: string) {
    const dest = this.file(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fsp.rename(localPath, dest);
    } catch {
      await pipeline(fs.createReadStream(localPath), fs.createWriteStream(dest));
      await fsp.rm(localPath, { force: true });
    }
  }

  async putBuffer(key: string, data: Buffer) {
    const dest = this.file(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, data);
  }

  async read(key: string, range?: { start: number; end: number }) {
    return fs.createReadStream(this.file(key), range);
  }

  async size(key: string) {
    return (await fsp.stat(this.file(key))).size;
  }

  async remove(key: string) {
    await fsp.rm(this.file(key), { force: true });
  }
}

class S3Storage implements Storage {
  private client: S3Client;
  private bucket: string;

  constructor() {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error('STORAGE_DRIVER=s3 requer S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY');
    }
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }

  async putFile(key: string, localPath: string, contentType: string) {
    const { size } = await fsp.stat(localPath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fs.createReadStream(localPath),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
    await fsp.rm(localPath, { force: true });
  }

  async putBuffer(key: string, data: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }));
  }

  async read(key: string, range?: { start: number; end: number }) {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    return res.Body as Readable;
  }

  async size(key: string) {
    const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return Number(res.ContentLength ?? 0);
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export const storage: Storage = env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();

export async function readToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
