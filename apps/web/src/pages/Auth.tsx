import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Button, Field, Skeleton } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { keys, useAuthStatus, useMe } from '../lib/queries';
import type { User } from '../lib/types';

export function AuthPage() {
  const status = useAuthStatus();
  const me = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'login' | 'register' | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data?.user) return <Navigate to="/" replace />;
  const needsSetup = status.data?.needsSetup;
  const current = mode ?? (needsSetup ? 'register' : 'login');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ user: User }>(current === 'login' ? '/api/auth/login' : '/api/auth/register', form);
      qc.setQueryData(keys.me, { user: res.user });
      navigate((location.state as { from?: string })?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="desk flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden>
            <rect width="32" height="32" rx="8" fill="var(--color-board)" />
            <rect x="7" y="9" width="4" height="14" rx="1.5" fill="var(--color-board-type)" />
            <rect x="14" y="13" width="4" height="10" rx="1.5" fill="var(--color-board-type)" />
            <rect x="21" y="6" width="4" height="17" rx="1.5" fill="var(--color-accent)" />
          </svg>
          <span className="text-lg font-semibold tracking-[-0.02em]">SendVideo</span>
        </div>

        {status.isLoading ? (
          <div className="stock space-y-4 p-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : (
          <form onSubmit={submit} className="stock space-y-4 p-6" noValidate>
            <div>
              <h1 className="text-xl">{current === 'login' ? 'Entrar' : needsSetup ? 'Crie o acesso de administrador' : 'Criar conta'}</h1>
              <p className="mt-1 text-sm text-muted">
                {current === 'login'
                  ? 'Seus vídeos e agendamentos estão esperando.'
                  : needsSetup
                    ? 'Primeiro acesso a esta instalação. Esta conta controla as integrações.'
                    : 'Preencha seus dados para começar.'}
              </p>
            </div>
            {current === 'register' && (
              <Field label="Seu nome" htmlFor="name">
                <input id="name" className="input" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </Field>
            )}
            <Field label="E-mail" htmlFor="email">
              <input id="email" type="email" className="input" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field label="Senha" htmlFor="password" hint={current === 'register' ? 'Pelo menos 8 caracteres.' : undefined}>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete={current === 'login' ? 'current-password' : 'new-password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
              />
            </Field>
            {error && (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="ink" busy={busy} className="w-full">
              {current === 'login' ? 'Entrar' : 'Criar acesso'}
            </Button>
            {!needsSetup && status.data?.signupAllowed && (
              <p className="text-center text-xs text-muted">
                {current === 'login' ? 'Ainda não tem conta? ' : 'Já tem conta? '}
                <button type="button" className="font-medium text-ink underline" onClick={() => setMode(current === 'login' ? 'register' : 'login')}>
                  {current === 'login' ? 'Criar conta' : 'Entrar'}
                </button>
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
