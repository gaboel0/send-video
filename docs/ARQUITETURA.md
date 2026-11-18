# Arquitetura

## Visão geral

```
                ┌──────────── navegador ────────────┐
                │  React 19 + Vite + Tailwind 4      │
                │  (sem lógica de agendamento)       │
                └──────────────┬────────────────────┘
                               │ /api (cookie de sessão httpOnly)
┌──────────────────────────────▼───────────────────────────────┐
│ API (Fastify, TypeScript)                                     │
│  auth · contas/OAuth · vídeos · pastas · publicações · painel │
│  valida regras das plataformas antes de agendar               │
└───────┬─────────────────────────┬─────────────────────┬──────┘
        │ Prisma                  │ BullMQ (job atrasado) │ S3 / disco
┌───────▼────────┐        ┌──────▼──────┐        ┌──────▼──────┐
│ PostgreSQL     │◄───────┤ Redis       │        │ Vídeos      │
│ fonte da       │        └──────┬──────┘        └──────▲──────┘
│ verdade        │               │                      │
└───────▲────────┘        ┌──────▼──────────────────────┴──────┐
        └─────────────────┤ Worker (processo separado, 24/7)    │
                          │ processor → publicadores TikTok/    │
                          │ Instagram/Facebook → APIs oficiais  │
                          └─────────────────────────────────────┘
```

Monorepo com npm workspaces:

| Pasta | Conteúdo |
| --- | --- |
| `apps/api/src/config` | variáveis de ambiente validadas com zod |
| `apps/api/src/lib` | criptografia, Prisma, HTTP com log, erros, fuso horário |
| `apps/api/src/modules/auth` | cadastro, login, sessões |
| `apps/api/src/modules/accounts` | OAuth, conexões, sincronização de contas |
| `apps/api/src/modules/integrations` | clientes das APIs (TikTok, Meta), publicadores, validação, tokens |
| `apps/api/src/modules/videos` | upload, biblioteca, pastas, streaming com Range |
| `apps/api/src/modules/posts` | criar, editar, agendar, reagendar, cancelar, tentar novamente |
| `apps/api/src/modules/scheduler` | despachante (BullMQ/pg), processor, sweeper, manutenção |
| `apps/api/src/modules/dashboard` | números do painel e atividades |
| `apps/web/src` | interface |

## Modelo de dados

- **Post**: um vídeo + um horário. **PostTarget**: a publicação numa conta específica, com legenda, hashtags e opções próprias. É o destino que tem status, tentativas e ids da plataforma.
- **SocialConnection**: uma autorização OAuth (tokens criptografados). **SocialAccount**: o destino (perfil TikTok, Instagram profissional, Página).
- **PublishAttempt**: histórico de cada tentativa. **ActivityLog**: linha do tempo do painel. **IntegrationLog**: cada chamada externa, sem tokens.

## Agendamento confiável

1. Ao agendar, cada destino recebe `status=SCHEDULED` e `nextAttemptAt=horário`. Em seguida um job atrasado é criado no BullMQ para o instante exato.
2. **O banco é a fonte da verdade.** O job só "acorda" o worker. Um *sweeper* varre o banco a cada 30 s e reenfileira qualquer destino vencido. Se o Redis for limpo ou o servidor reiniciar, nada se perde.
3. **Reivindicação atômica**: o worker só processa um destino depois de um `UPDATE ... WHERE updatedAt = <lido>` que define um *lease* de 20 min. Jobs duplicados, dois workers ou o sweeper nunca processam o mesmo destino em paralelo (há teste para isso).
4. **Máquina de estados com checkpoints**: antes de qualquer chamada que possa criar a publicação, o publicador grava a etapa e os ids (publish_id, container, video_id). Se o processo cair:
   - Instagram retoma pelo status do container (que diz se já foi publicado);
   - Facebook Reels confere o status antes de chamar `finish` de novo;
   - TikTok e vídeo comum do Facebook, quando a queda ocorre no meio da chamada de criação, vão para **Requer ação** em vez de arriscar duplicar.
5. **Tentativas**: falhas transitórias (rede, 5xx, limite de taxa) geram nova tentativa com backoff de 1, 5, 15, 30 e 60 min (ou o `Retry-After`). Depois de 5, **Falhou**. Erros de conteúdo vão direto para **Falhou**. Token expirado ou permissão ausente vão para **Requer ação** e a conta é marcada como expirada.
6. Processamento assíncrono das plataformas (vídeo ainda processando) é consultado com intervalos crescentes, de 5 s a 5 min, por até 2 h.
7. Cancelar só afeta destinos ainda não reivindicados. Reagendar move `nextAttemptAt`; jobs antigos que dispararem no horário velho simplesmente não encontram nada vencido.
8. Fuso: tudo é gravado em UTC; a interface e os relatórios usam `America/Sao_Paulo` independentemente do fuso do computador.

### Drivers de fila

- `QUEUE_DRIVER=bullmq` (produção): Redis 6.2+, precisão de segundos, concorrência e limitador de vazão.
- `QUEUE_DRIVER=pg`: sem Redis. O worker consulta o banco a cada 5 s. Usado em desenvolvimento local (Windows sem Redis) e serve como alternativa em hospedagens sem Redis.

## Segurança

- Tokens OAuth: AES-256-GCM com `TOKEN_ENCRYPTION_KEY`; nunca saem da API (a rota de contas não devolve tokens).
- Senhas: scrypt. Sessões: token aleatório no cookie `httpOnly`/`SameSite=Lax`/`Secure` em produção; só o SHA-256 vai para o banco.
- CSRF: requisições que alteram dados precisam vir da origem `PUBLIC_URL`. OAuth com `state` aleatório de uso único (15 min).
- Upload: tipo detectado pelos bytes do arquivo (MP4/MOV/WebM), limite de tamanho, miniatura validada.
- Rate limit: 600 req/min por IP; 10/min em login e cadastro.
- Controle de acesso: toda consulta filtra por `userId` da sessão.
- Logs de integração com URLs saneadas (sem `access_token`, `code`, segredos).

## Limitações conhecidas

- Miniatura, duração e resolução são extraídas no navegador (não há ffmpeg no servidor). Se o navegador não conseguir ler o arquivo, o vídeo entra sem miniatura e a duração não é validada.
- Uploads passam pela API (não por URL pré-assinada). Para arquivos muito grandes ou muitos usuários simultâneos, vale migrar para upload direto ao S3.
- O caminho BullMQ foi verificado por tipos e é o mesmo processador testado, mas não foi executado nesta máquina (sem Redis disponível). Teste com `docker compose up` antes de ir para produção.
