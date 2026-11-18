# Progresso: SendVideo

Atualizado em 18/11/2026.

## Investigação inicial

- Nenhum projeto de agendamento existia no disco. `C:\dev\conteudo` tem vídeos e playbooks (sem código reaproveitável); demais pastas são outros produtos (ZipRotas, finanças, Roblox).
- Ambiente: Node 24 e npm 12; **sem Docker, PostgreSQL ou Redis** instalados. Por isso o desenvolvimento local usa PostgreSQL embutido (`npm run db:local`) e `QUEUE_DRIVER=pg`.
- Projeto criado em `C:\dev\sendvideo` (monorepo npm workspaces).

## Concluído

### Backend (`apps/api`)
- [x] Fastify + TypeScript + Prisma 7 (adapter pg) + PostgreSQL; schema e migração inicial
- [x] Autenticação (scrypt, sessão em cookie httpOnly, primeiro usuário vira admin, `ALLOW_SIGNUP`)
- [x] Criptografia AES-256-GCM dos tokens; tokens nunca expostos
- [x] OAuth TikTok (Login Kit v2) e Meta (Facebook Login, token longo, tokens de Página)
- [x] Sincronização de contas (perfil TikTok + creator_info; Páginas e Instagram profissional)
- [x] Publicadores reais: TikTok Direct Post e Inbox (upload em partes + status), Instagram Reels (resumable + container + publish), Facebook Reels e vídeo (Resumable Upload API)
- [x] Validação das regras de cada plataforma antes de agendar
- [x] Fila: BullMQ (produção) e driver pg (sem Redis), sweeper, lease, checkpoints anti-duplicidade, backoff, histórico de tentativas, renovação de tokens
- [x] Biblioteca: upload com detecção de formato por bytes, miniatura, streaming com Range, pastas, busca, filtros
- [x] Publicações: rascunho, agendar, publicar agora, editar, reagendar (arrastar), cancelar, tentar novamente, confirmar manualmente, excluir
- [x] Painel, atividades, log técnico de integrações, rate limit, proteção CSRF por origem
- [x] 24 testes (unitários + processador contra Postgres real: concorrência, retries, retomada após queda)

### Frontend (`apps/web`)
- [x] React 19 + Vite + Tailwind 4, tema Coral (Hallmark), claro e escuro, responsivo
- [x] Painel, Biblioteca (galeria, upload em lote com progresso), Editor (legenda por rede, opções, prévia, validação ao vivo), Calendário (mês/semana/dia, arrastar e soltar), Publicações (fila e histórico), Contas
- [x] sloplint: 0 FAIL, 0 REFLEX

### Verificado nesta máquina
- Fluxo completo no navegador: upload de MP4 reais, criação de publicação para 3 redes, validação bloqueando erros, agendamento, arrastar no calendário, gaveta de detalhes, tema claro/escuro, mobile 375 px.
- Worker em modo pg chamando as APIs reais do TikTok e da Meta com tokens de teste inválidos: erros classificados corretamente (Requer ação, conta marcada como expirada, sem novas tentativas inúteis).
- Build de produção servindo SPA + API no mesmo domínio; bloqueio CSRF de origem externa.

## Pendente (depende de você)

1. Criar os apps no TikTok for Developers e na Meta e preencher o `.env` (passo a passo em `docs/INTEGRACOES.md`).
2. TikTok: Sandbox ou revisão do app; auditoria do Direct Post para publicar em público. Até lá, use `TIKTOK_POST_MODE=inbox` ou privacidade "Somente eu" em conta privada.
3. Meta: adicionar sua conta como função do app (uso pessoal) ou App Review + verificação da empresa.
4. Escolher hospedagem 24/7 com HTTPS (VPS com `docker compose`, por exemplo) e storage (disco ou S3/R2).

## Não verificado

- Caminho **BullMQ/Redis** em execução (sem Redis aqui). Mesmo processador testado; validar com `docker compose up` antes de produção.
- Publicação real bem-sucedida em cada rede (precisa das credenciais e aprovações acima).
- `docker compose` / Dockerfile (Docker não instalado aqui).
- Render tier do sloplint (sem puppeteer-core); a revisão visual foi feita por capturas de tela.

## Próximos passos sugeridos

- Upload direto ao S3 com URL pré-assinada para arquivos grandes.
- Extração de miniatura/duração no servidor (ffmpeg) como alternativa ao navegador.
- Horários recomendados e repetição de publicações; métricas pós-publicação (insights).
- Notificações (e-mail/push) quando algo falhar ou exigir ação.

## Como retomar

```bash
cd C:\dev\sendvideo
npm run db:local      # terminal 1
npm run dev           # terminal 2  →  http://localhost:5173
npm test
```
