# SendVideo

Central para preparar os vídeos da semana em uma sessão: envie os arquivos, escreva legendas diferentes para cada rede, organize no calendário e deixe o servidor publicar no TikTok, Instagram e Facebook nos horários definidos, usando apenas as APIs oficiais.

- **Biblioteca**: upload em lote (arrastar e soltar), miniaturas, prévia, pastas, busca e filtros por situação, reuso do mesmo vídeo.
- **Editor**: várias contas por publicação, legenda e hashtags independentes por rede, opções de cada plataforma (privacidade e divulgação do TikTok, feed do Instagram, Reels ou vídeo no Facebook), prévia, validação em tempo real.
- **Calendário**: mês, semana e dia, arrastar e soltar para reagendar, dias cheios e livres destacados, rascunhos sem data para encaixar.
- **Agendamento no servidor**: fila persistente (BullMQ + PostgreSQL), tentativas com backoff, proteção contra duplicidade, histórico de tentativas, logs.
- **Contas**: conectar, reconectar, desconectar; estado do token e permissões concedidas.

Documentos:

- [docs/INTEGRACOES.md](docs/INTEGRACOES.md): como registrar os apps no TikTok e na Meta, permissões e o que falta para ativar.
- [docs/ARQUITETURA.md](docs/ARQUITETURA.md): arquitetura, confiabilidade do agendamento e segurança.
- [PROGRESS.md](PROGRESS.md): estado atual e próximos passos.

## Rodando localmente (Windows, sem Docker)

Requer Node 22+.

```bash
npm install
cp .env.example .env            # gere TOKEN_ENCRYPTION_KEY (comando no arquivo) e use QUEUE_DRIVER=pg
npm run db:local                # terminal 1: PostgreSQL embutido em localhost:5433
npm run db:migrate              # uma vez
npm run dev                     # terminal 2: API (4000) + worker + web (5173)
```

Abra <http://localhost:5173>. O primeiro acesso cria a conta de administrador.

Testes: `npm test` (com o banco local rodando).

## Produção

O worker precisa ficar ligado 24/7 em um servidor: é ele quem publica, então nada depende do seu navegador ou computador.

```bash
cp .env.example .env    # preencha; PUBLIC_URL com HTTPS
docker compose up -d --build
```

Sobe PostgreSQL, Redis, a API (que também serve a interface) e o worker. Coloque um proxy HTTPS na frente da porta 4000. Para guardar vídeos em S3/R2/MinIO use `STORAGE_DRIVER=s3`.

Sem Docker: `npm run build`, depois `npm run db:migrate`, `npm start` (API) e `npm run start:worker` (worker) com um gerenciador de processos (systemd, pm2).
