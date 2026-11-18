/**
 * Sobe um PostgreSQL real embutido (binários oficiais via npm) para desenvolvimento local,
 * sem precisar instalar Postgres ou Docker. Dados ficam em <raiz>/.data/pg.
 *
 *   npm run db:local
 *
 * Em produção use um PostgreSQL gerenciado ou o docker-compose.yml.
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(import.meta.dirname, '../../../.data/pg');
const port = Number(process.env.LOCAL_PG_PORT ?? 5433);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'sendvideo',
  password: 'sendvideo',
  port,
  persistent: true,
  // Sem isso, no Windows o cluster herda a página de código local (WIN1252) e recusa emojis e símbolos
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

const firstRun = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));
if (firstRun) {
  console.log(`[db] Inicializando cluster em ${dataDir}`);
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase('sendvideo');
  console.log('[db] Banco "sendvideo" criado');
} catch {
  // já existe
}
const client = pg.getPgClient('sendvideo');
await client.connect();
const encoding = (await client.query('SHOW server_encoding')).rows[0].server_encoding as string;
await client.end();
if (encoding !== 'UTF8') {
  console.error(`[db] O banco está em ${encoding}, não UTF8. Apague a pasta ${dataDir} e rode de novo.`);
  await pg.stop();
  process.exit(1);
}
console.log(`[db] PostgreSQL pronto em postgresql://sendvideo:sendvideo@localhost:${port}/sendvideo`);

const shutdown = async () => {
  console.log('\n[db] Encerrando PostgreSQL...');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
setInterval(() => {}, 1 << 30);
