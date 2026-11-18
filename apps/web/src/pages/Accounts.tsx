import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Link2, RefreshCw, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Page } from '../components/Shell';
import { Avatar, Button, ErrorState, PageHeader, Skeleton, useConfirm, useToast } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { handle, PlatformIcon, PLATFORMS } from '../lib/platforms';
import { useAccounts, useIntegrations, useInvalidate } from '../lib/queries';
import { fmtDateTime, relative } from '../lib/time';
import type { Connection, ConnectionStatus } from '../lib/types';

const CONN_STATUS: Record<ConnectionStatus, { label: string; color: string }> = {
  ACTIVE: { label: 'Conectada', color: 'var(--color-ink-2)' },
  EXPIRED: { label: 'Expirada', color: 'var(--color-warn)' },
  REVOKED: { label: 'Desconectada', color: 'var(--color-faint)' },
  ERROR: { label: 'Com erro', color: 'var(--color-danger)' },
};

const REQUIRED = {
  TIKTOK: ['user.info.basic', 'video.publish', 'video.upload'],
  META: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'],
};

export function AccountsPage() {
  const [params, setParams] = useSearchParams();
  const accounts = useAccounts();
  const integrations = useIntegrations();
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error' | 'warn'; text: string } | null>(null);
  const invalidate = useInvalidate();

  useEffect(() => {
    const connected = params.get('connected');
    const error = params.get('error');
    const warning = params.get('warning');
    if (connected || error) {
      setBanner(
        error
          ? { tone: 'error', text: error }
          : warning
            ? { tone: 'warn', text: `${connected === 'tiktok' ? 'TikTok' : 'Meta'} conectado, mas: ${warning}` }
            : { tone: 'ok', text: connected === 'tiktok' ? 'Conta do TikTok conectada.' : 'Contas da Meta conectadas.' },
      );
      invalidate('accounts', 'dashboard');
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byProvider = (p: 'TIKTOK' | 'META') => (accounts.data ?? []).filter((c) => c.provider === p);

  return (
    <Page>
      <PageHeader title="Contas" description="Conecte os perfis onde os vídeos serão publicados. Os tokens ficam criptografados no servidor." />
      {banner && (
        <div
          role="status"
          className={`mb-6 flex items-start gap-2.5 rounded-[var(--radius-card)] px-4 py-3 text-sm ${
            banner.tone === 'error' ? 'bg-danger-wash text-danger' : banner.tone === 'warn' ? 'bg-warn-wash text-ink-2' : 'stock'
          }`}
        >
          {banner.tone === 'ok' ? <CheckCircle2 className="mt-px size-4 text-paid" aria-hidden /> : <AlertTriangle className="mt-px size-4" aria-hidden />}
          <span className="flex-1">{banner.text}</span>
          <button type="button" className="text-xs underline" onClick={() => setBanner(null)}>
            Fechar
          </button>
        </div>
      )}

      {accounts.error ? (
        <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />
      ) : (
        <div className="space-y-8">
          <ProviderSection
            provider="TIKTOK"
            title="TikTok"
            description="Perfil do TikTok via Content Posting API."
            configured={integrations.data?.tiktok.configured}
            missing={integrations.data?.tiktok.missing ?? []}
            connections={byProvider('TIKTOK')}
            loading={accounts.isLoading || integrations.isLoading}
            note={integrations.data?.tiktok.postMode === 'inbox' ? 'Modo atual: envio como rascunho (inbox). Você finaliza cada publicação no app do TikTok.' : undefined}
          />
          <ProviderSection
            provider="META"
            title="Instagram e Facebook"
            description="Contas profissionais do Instagram (Business ou Creator) ligadas a páginas do Facebook."
            configured={integrations.data?.meta.configured}
            missing={integrations.data?.meta.missing ?? []}
            connections={byProvider('META')}
            loading={accounts.isLoading || integrations.isLoading}
          />
          <IntegrationLogs />
        </div>
      )}
    </Page>
  );
}

function ProviderSection({
  provider,
  title,
  description,
  configured,
  missing,
  connections,
  loading,
  note,
}: {
  provider: 'TIKTOK' | 'META';
  title: string;
  description: string;
  configured?: boolean;
  missing: string[];
  connections: Connection[];
  loading: boolean;
  note?: string;
}) {
  const start = (reconnect?: string) => {
    window.location.href = `/api/oauth/${provider.toLowerCase()}/start${reconnect ? `?reconnect=${reconnect}` : ''}`;
  };
  return (
    <section aria-labelledby={`p-${provider}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`p-${provider}`} className="flex items-center gap-2 text-lg">
            {provider === 'TIKTOK' ? (
              <PlatformIcon platform="TIKTOK" size={18} />
            ) : (
              <span className="flex gap-1">
                <PlatformIcon platform="INSTAGRAM" size={18} />
                <PlatformIcon platform="FACEBOOK" size={18} />
              </span>
            )}
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
        {configured && (
          <Button variant="ink" icon={<Link2 />} onClick={() => start()}>
            {connections.length ? 'Conectar outra conta' : 'Conectar'}
          </Button>
        )}
      </div>

      {!loading && !configured && connections.length > 0 && (
        <ul className="mb-3 space-y-3">
          {connections.map((c) => (
            <ConnectionCard key={c.id} c={c} onReconnect={() => start(c.id)} required={REQUIRED[provider]} />
          ))}
        </ul>
      )}
      {loading ? (
        <Skeleton className="h-28" />
      ) : !configured ? (
        <div className="sheet p-5">
          <p className="text-sm font-medium">Integração ainda não configurada</p>
          <p className="mt-1 text-sm text-muted">
            Preencha no arquivo <code className="fig rounded bg-paper-2 px-1">.env</code> do servidor e reinicie a API:
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {missing.map((m) => (
              <li key={m} className="fig rounded-[5px] bg-paper-2 px-2 py-0.5 text-xs">
                {m}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">O passo a passo está em docs/INTEGRACOES.md no projeto.</p>
        </div>
      ) : connections.length === 0 ? (
        <div className="sheet flex flex-wrap items-center gap-4 p-5">
          <p className="flex-1 text-sm text-muted">Nenhuma conta conectada. Você será levado à página oficial de autorização.</p>
          <Button icon={<Link2 />} onClick={() => start()}>
            Conectar {title}
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {connections.map((c) => (
            <ConnectionCard key={c.id} c={c} onReconnect={() => start(c.id)} required={REQUIRED[provider]} />
          ))}
        </ul>
      )}
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
    </section>
  );
}

function ConnectionCard({ c, onReconnect, required }: { c: Connection; onReconnect: () => void; required: string[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState<string | null>(null);
  const st = CONN_STATUS[c.status];
  const missingScopes = required.filter((s) => !c.scopes.includes(s));
  const expires = c.provider === 'TIKTOK' ? c.refreshTokenExpiresAt : c.accessTokenExpiresAt;
  const expiringSoon = expires && new Date(expires).getTime() - Date.now() < 7 * 86_400_000;

  const sync = async () => {
    setBusy('sync');
    try {
      await api.post(`/api/connections/${c.id}/sync`);
      await invalidate('accounts', 'dashboard');
      toast('ok', 'Contas sincronizadas');
    } catch (err) {
      toast('error', (err as ApiError).message);
      invalidate('accounts');
    } finally {
      setBusy(null);
    }
  };
  const disconnect = async () => {
    if (
      !(await confirm({
        title: `Desconectar ${c.displayName}?`,
        body: 'O acesso é revogado na plataforma e os tokens são apagados. Publicações agendadas para estas contas ficam marcadas como "Requer ação".',
        confirm: 'Desconectar',
        danger: true,
      }))
    )
      return;
    setBusy('disconnect');
    try {
      const res = await api.del<{ affectedTargets: number }>(`/api/connections/${c.id}`);
      await invalidate('accounts', 'dashboard', 'posts');
      toast('ok', res.affectedTargets ? `Desconectado. ${res.affectedTargets} agendamento(s) precisam de atenção.` : 'Conta desconectada');
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setBusy(null);
    }
  };
  const toggle = async (id: string, enabled: boolean) => {
    await api.patch(`/api/accounts/${id}`, { enabled });
    invalidate('accounts');
  };

  return (
    <li className="stock overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 p-4">
        <Avatar src={c.avatarUrl} name={c.displayName} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{c.displayName}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
            <span style={{ color: st.color }}>{st.label}</span>
            {c.lastSyncedAt && <span>Sincronizada {relative(c.lastSyncedAt)}</span>}
            {expires && (
              <span className={expiringSoon ? 'text-warn' : undefined}>
                {c.provider === 'TIKTOK' ? 'Autorização válida até' : 'Token válido até'} {fmtDateTime(expires)}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.status === 'ACTIVE' ? (
            <Button size="sm" icon={<RefreshCw />} busy={busy === 'sync'} onClick={sync}>
              Sincronizar
            </Button>
          ) : null}
          <Button size="sm" variant={c.status === 'ACTIVE' ? 'ghost' : 'ink'} icon={<Link2 />} onClick={onReconnect}>
            Reconectar
          </Button>
          <Button size="sm" variant="ghost" icon={<Unplug />} busy={busy === 'disconnect'} onClick={disconnect}>
            Desconectar
          </Button>
        </div>
      </div>
      {(c.lastError && c.status !== 'ACTIVE') || missingScopes.length > 0 ? (
        <div className="space-y-1 border-t border-rule bg-warn-wash px-4 py-2.5 text-xs text-ink-2">
          {c.lastError && c.status !== 'ACTIVE' && <p>{c.lastError}</p>}
          {missingScopes.length > 0 && (
            <p>
              Permissões não concedidas: <span className="fig">{missingScopes.join(', ')}</span>. Reconecte e aceite todas.
            </p>
          )}
        </div>
      ) : null}
      {c.accounts.length > 0 && (
        <ul className="divide-y divide-rule border-t border-rule bg-paper">
          {c.accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
              <PlatformIcon platform={a.platform} size={14} />
              <Avatar src={a.avatarUrl} name={a.name} size={26} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{handle(a)}</p>
                <p className="text-2xs text-muted">
                  {a.platform === 'INSTAGRAM' ? `Instagram profissional, página ${a.metadata.pageName ?? ''}` : a.platform === 'FACEBOOK' ? 'Página do Facebook' : 'Perfil do TikTok'}
                  {a.status !== 'ACTIVE' && <span className="text-warn"> ({CONN_STATUS[a.status].label.toLowerCase()})</span>}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted">
                Usar
                <button type="button" role="switch" aria-checked={a.enabled} aria-label={`Usar ${handle(a)} em publicações`} className="switch" onClick={() => toggle(a.id, !a.enabled)} disabled={a.status === 'REVOKED'} />
              </label>
            </li>
          ))}
        </ul>
      )}
      {c.provider === 'META' && c.accounts.length === 0 && c.status === 'ACTIVE' && (
        <p className="border-t border-rule px-4 py-3 text-xs text-muted">
          Nenhuma página autorizada. Reconecte e selecione as páginas (e as contas do Instagram ligadas a elas) na tela da Meta.
        </p>
      )}
      <details className="border-t border-rule px-4 py-2 text-xs text-muted">
        <summary className="cursor-pointer select-none">Permissões concedidas ({c.scopes.length})</summary>
        <p className="fig mt-2 leading-relaxed">{c.scopes.join(', ') || 'nenhuma'}</p>
      </details>
    </li>
  );
}

function IntegrationLogs() {
  const [open, setOpen] = useState(false);
  const logs = useQuery({
    queryKey: ['integration-logs'],
    queryFn: () =>
      api.get<Array<{ id: string; provider: string; operation: string; method: string; statusCode: number | null; ok: boolean; durationMs: number; errorCode: string | null; errorMessage: string | null; createdAt: string }>>(
        '/api/integration-logs?limit=50',
      ),
    enabled: open,
  });
  return (
    <section aria-labelledby="logs-h">
      <h2 id="logs-h" className="text-sm tracking-normal">
        <button type="button" className="font-medium whitespace-nowrap text-muted hover:text-ink" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Ocultar' : 'Ver'} log técnico
        </button>
      </h2>
      {open && (
        <div className="sheet mt-3 overflow-x-auto">
          {logs.isLoading ? (
            <Skeleton className="h-32" />
          ) : !logs.data?.length ? (
            <p className="p-4 text-sm text-muted">Nenhuma chamada registrada ainda.</p>
          ) : (
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead className="border-b border-rule bg-paper-2 text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Quando</th>
                  <th className="px-3 py-2 font-medium">Rede</th>
                  <th className="px-3 py-2 font-medium">Operação</th>
                  <th className="px-3 py-2 font-medium">HTTP</th>
                  <th className="px-3 py-2 font-medium">Tempo</th>
                  <th className="px-3 py-2 font-medium">Erro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {logs.data.map((l) => (
                  <tr key={l.id}>
                    <td className="fig px-3 py-2 whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
                    <td className="px-3 py-2">{l.provider === 'TIKTOK' ? PLATFORMS.TIKTOK.label : 'Meta'}</td>
                    <td className="fig px-3 py-2">{l.operation}</td>
                    <td className={`fig px-3 py-2 ${l.ok ? '' : 'text-danger'}`}>{l.statusCode ?? '—'}</td>
                    <td className="fig px-3 py-2">{l.durationMs} ms</td>
                    <td className="px-3 py-2 text-muted">{l.errorCode ? `${l.errorCode}: ${l.errorMessage ?? ''}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
