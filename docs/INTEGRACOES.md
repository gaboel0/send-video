# Configurando as integrações (TikTok e Meta)

Este guia explica como registrar os aplicativos nas plataformas, quais permissões pedir e o que falta para publicar de verdade. **Nada aqui foi presumido como aprovado**: cada plataforma tem etapas de revisão que só você (dono das contas) pode concluir.

> Resumo do que você precisa providenciar
>
> | Item | Onde | Bloqueia o quê |
> | --- | --- | --- |
> | URL pública com HTTPS | seu servidor ou um túnel | OAuth do TikTok (não aceita `localhost`) |
> | App no TikTok for Developers + Login Kit + Content Posting API | developers.tiktok.com | Conectar TikTok |
> | Direct Post habilitado + auditoria do app | TikTok | Publicar público direto (sem auditoria: só "Somente eu") |
> | App na Meta (tipo Business) + Facebook Login for Business | developers.facebook.com | Conectar Instagram/Facebook |
> | App Review das permissões + verificação da empresa | Meta | Usar com contas que não são administradoras do app |
> | Instagram profissional ligado a uma Página do Facebook | Instagram / Meta Business Suite | Publicar Reels no Instagram |

---

## 1. URL pública e HTTPS

As plataformas redirecionam o navegador de volta para a SendVideo depois do login. Essa URL precisa ser **exatamente igual** à cadastrada no app.

- **Produção:** `https://seu-dominio.com/api/oauth/tiktok/callback` e `https://seu-dominio.com/api/oauth/meta/callback`.
- **Desenvolvimento:**
  - Meta aceita `http://localhost:5173/api/oauth/meta/callback` enquanto o app está em modo de desenvolvimento.
  - TikTok **exige HTTPS** e não aceita `localhost`. Use um túnel, por exemplo:
    ```bash
    cloudflared tunnel --url http://localhost:5173
    ```
    Pegue a URL `https://xxxx.trycloudflare.com`, defina `PUBLIC_URL` e `TIKTOK_REDIRECT_URI` com ela no `.env`, cadastre a URL de callback no TikTok e **acesse a SendVideo pelo endereço do túnel** (o cookie de sessão é por domínio).

No `.env`:

```env
PUBLIC_URL=https://seu-dominio.com
TIKTOK_REDIRECT_URI=https://seu-dominio.com/api/oauth/tiktok/callback
META_REDIRECT_URI=https://seu-dominio.com/api/oauth/meta/callback
```

---

## 2. TikTok for Developers

Documentação oficial: <https://developers.tiktok.com/doc/content-posting-api-get-started>

### 2.1 Criar o app

1. Entre em <https://developers.tiktok.com/> com uma conta TikTok e crie uma organização (opcional) e um app em **Manage apps → Connect an app**.
2. Preencha ícone, nome, categoria, descrição, **URL dos Termos de Serviço** e **URL da Política de Privacidade** (páginas públicas são obrigatórias para a revisão).
3. Em **Platforms**, marque **Web** e informe o domínio do site.
4. Em **Products**, adicione:
   - **Login Kit**: cadastre a Redirect URI (`.../api/oauth/tiktok/callback`).
   - **Content Posting API**: ative **Direct Post** se quiser publicar direto. Para envio como rascunho basta o upload.
5. Em **Scopes**, garanta:

   | Escopo | Para quê |
   | --- | --- |
   | `user.info.basic` | nome e foto do perfil |
   | `video.upload` | enviar como rascunho para a caixa de entrada do TikTok |
   | `video.publish` | Direct Post (publicar direto) |

6. Copie **Client key** e **Client secret** para `TIKTOK_CLIENT_KEY` e `TIKTOK_CLIENT_SECRET`.

### 2.2 Sandbox, revisão e auditoria

- Antes de enviar o app para revisão, use o **Sandbox** do app e adicione sua conta TikTok como usuário-alvo (Target users).
- Envie o app para **review** com um vídeo de demonstração do fluxo (conectar conta, escolher vídeo, legenda, privacidade, agendar). A SendVideo já segue as [diretrizes de UX do Direct Post](https://developers.tiktok.com/doc/content-sharing-guidelines): mostra o apelido do criador, consulta `creator_info` antes de publicar, exige que o usuário escolha a privacidade (sem valor padrão), respeita comentários/dueto/costura desativados pelo criador, tem divulgação de conteúdo comercial e o aceite da Confirmação de Uso de Música.
- **Sem auditoria** (app "unaudited"), o TikTok só permite publicar com privacidade **Somente eu** e em **contas privadas**, com limite de usuários. Publicações com outra privacidade falham com `unaudited_client_can_only_post_to_private_accounts`, e a SendVideo marca a publicação como "Requer ação" explicando isso.
- Para publicar em público é preciso solicitar a **auditoria** do Direct Post no portal.

### 2.3 Alternativa enquanto o Direct Post não é liberado

Defina `TIKTOK_POST_MODE=inbox`. No horário agendado a SendVideo envia o vídeo para a **caixa de entrada do TikTok** (escopo `video.upload`). Você recebe uma notificação no app, abre o rascunho e finaliza a publicação lá. A publicação fica com status **Requer ação** até você clicar em **Já publiquei** no painel.

O modo também pode ser escolhido por publicação no editor quando a conta concedeu os dois escopos.

### 2.4 Limites relevantes

- Token de acesso: 24 h (renovado automaticamente). Refresh token: 365 dias. O worker renova antes de vencer.
- Inicialização de posts: 6 requisições por minuto por usuário. O TikTok também limita posts por dia por criador (`spam_risk_too_many_posts`): a SendVideo agenda nova tentativa em 6 h.
- Upload em partes de 5 a 64 MB (feito automaticamente). Duração máxima depende do criador (`max_video_post_duration_sec`).

---

## 3. Meta for Developers (Instagram e Facebook)

Documentação oficial:

- Instagram: <https://developers.facebook.com/docs/instagram-platform/content-publishing/>
- Reels em Páginas: <https://developers.facebook.com/docs/video-api/guides/reels-publishing>

### 3.1 Pré-requisitos nas contas

- A conta do Instagram precisa ser **profissional** (Business ou Creator) e estar **ligada a uma Página do Facebook** (Configurações da conta no Instagram → Conta → Compartilhamento com outros apps, ou pelo Meta Business Suite).
- Você precisa ter permissão de administrador ou editor (tarefa "Criar conteúdo") na Página.

### 3.2 Criar o app

1. Em <https://developers.facebook.com/apps> crie um app do tipo **Business** (casos de uso: "Gerenciar tudo na sua Página" e "Gerenciar mensagens e conteúdo no Instagram").
2. Adicione o produto **Facebook Login for Business**.
   - Em **Configurações**, cadastre a **URI de redirecionamento OAuth válida**: `.../api/oauth/meta/callback`.
   - Opcional: crie uma **Configuração** com as permissões abaixo e coloque o ID em `META_LOGIN_CONFIG_ID`.
3. Em **Configurações do app → Básico**, copie **ID do app** e **Chave secreta** para `META_APP_ID` e `META_APP_SECRET`. Preencha domínio, política de privacidade e termos.
4. `META_GRAPH_VERSION` usa `v24.0` por padrão. Atualize quando a Meta descontinuar a versão (cerca de 2 anos de suporte).

### 3.3 Permissões solicitadas

| Permissão | Para quê |
| --- | --- |
| `pages_show_list` | listar suas Páginas |
| `pages_read_engagement` | ler dados da Página e obter o token dela |
| `pages_manage_posts` | publicar vídeos e Reels na Página |
| `instagram_basic` | ler o perfil do Instagram ligado à Página |
| `instagram_content_publish` | publicar Reels no Instagram |
| `business_management` | Páginas que pertencem a um Business Manager |

### 3.4 Modo desenvolvimento x produção

- Em **modo de desenvolvimento**, o app funciona apenas para pessoas com função no app (administradores, desenvolvedores, testadores). Para uso pessoal isso já basta: adicione sua conta em **Funções do app**.
- Para outras pessoas usarem, é preciso **Acesso avançado** a cada permissão via **App Review** (com vídeo de demonstração) e **verificação da empresa**.

### 3.5 Tokens

- Após o login, a SendVideo troca o código por um **token de usuário de longa duração (~60 dias)** e obtém os **tokens das Páginas**, que não expiram enquanto a autorização for mantida.
- Ao se aproximar do vencimento, a tela **Contas** avisa; reconecte para renovar. Tokens revogados (senha trocada, permissão removida) são detectados no primeiro erro `190`: a conta fica "Expirada" e as publicações dela vão para "Requer ação".

### 3.6 Limites relevantes

- Instagram: até 100 publicações via API por conta em 24 h. Reels de 3 s a 15 min, MP4/MOV, até 300 MB (limite usado na validação), 9:16 recomendado, até 30 hashtags e 2.200 caracteres.
- Facebook Reels de Página: 3 a 90 s, 9:16, resolução mínima 540×960. Vídeos mais longos: escolha o formato "Vídeo" no editor.

---

## 4. Como a SendVideo publica (fluxo técnico)

| Rede | Fluxo |
| --- | --- |
| TikTok | `creator_info/query` → `post/publish/video/init` (ou `inbox/video/init`) com `FILE_UPLOAD` → upload em partes (`PUT` com `Content-Range`) → `post/publish/status/fetch` até `PUBLISH_COMPLETE` |
| Instagram | `POST /{ig-user}/media` (`media_type=REELS`, `upload_type=resumable`) → upload binário em `rupload.facebook.com` → `status_code` até `FINISHED` → `POST /{ig-user}/media_publish` → permalink |
| Facebook (Reels) | `POST /{page}/video_reels` start → upload em `rupload.facebook.com` → finish com `video_state=PUBLISHED` → acompanha `status` |
| Facebook (Vídeo) | Resumable Upload API (`/{app-id}/uploads`) → `POST /{page}/videos` com o handle → acompanha `status` |

O arquivo é enviado diretamente do servidor (não é preciso URL pública do vídeo nem verificação de domínio).

Cada chamada fica registrada (sem tokens) em **Contas → Ver log técnico**.

---

## 5. Checklist para ativar

- [ ] `.env` com `PUBLIC_URL`, `TOKEN_ENCRYPTION_KEY`, banco, Redis e storage
- [ ] App TikTok criado, Redirect URI cadastrada, chaves no `.env`
- [ ] Sua conta TikTok adicionada como usuária do Sandbox (ou app aprovado)
- [ ] Decidir `TIKTOK_POST_MODE` (`direct` exige Direct Post; `inbox` funciona com upload)
- [ ] App Meta criado, Facebook Login for Business configurado, chaves no `.env`
- [ ] Sua conta com função no app Meta (ou App Review concluído)
- [ ] Instagram profissional ligado à Página
- [ ] Reiniciar API e worker, abrir **Contas** e conectar
