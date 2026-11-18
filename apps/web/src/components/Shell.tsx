import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Film, LayoutGrid, ListChecks, LogOut, Menu, Moon, Plus, Sun, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../lib/api';
import { useMe } from '../lib/queries';
import { Avatar, Button } from './ui';

const NAV = [
  { to: '/', label: 'Painel', icon: LayoutGrid, end: true },
  { to: '/calendario', label: 'Calendário', icon: CalendarDays },
  { to: '/biblioteca', label: 'Biblioteca', icon: Film },
  { to: '/publicacoes', label: 'Publicações', icon: ListChecks },
  { to: '/contas', label: 'Contas', icon: Users },
];

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const t = document.documentElement.dataset.theme;
    if (t === 'dark' || t === 'light') return t;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('sendvideo-theme', next);
    } catch {
      /* armazenamento indisponível */
    }
    setTheme(next);
  };
  return { theme, toggle };
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-md font-semibold tracking-[-0.02em] text-ink">
      <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--color-board)" />
        <rect x="7" y="9" width="4" height="14" rx="1.5" fill="var(--color-board-type)" />
        <rect x="14" y="13" width="4" height="10" rx="1.5" fill="var(--color-board-type)" />
        <rect x="21" y="6" width="4" height="17" rx="1.5" fill="var(--color-accent)" />
      </svg>
      SendVideo
    </span>
  );
}

export function Shell() {
  const { data } = useMe();
  const user = data?.user;
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [location.pathname]);

  const logout = async () => {
    await api.post('/api/auth/logout');
    qc.clear();
    navigate('/entrar');
  };

  const nav = (
    <nav aria-label="Principal" className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex min-h-10 items-center gap-3 rounded-[var(--radius-input)] px-3 text-sm font-medium no-underline transition-colors duration-[var(--dur-micro)] ${
              isActive ? 'bg-cotton text-ink shadow-stock' : 'text-muted hover:bg-paper-3 hover:text-ink'
            }`
          }
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-auto flex flex-col gap-3 border-t border-rule pt-4">
      <div className="flex items-center gap-2.5 px-1">
        <Avatar name={user?.name ?? ''} size={30} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="truncate text-2xs text-muted">{user?.email}</p>
        </div>
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={toggle} icon={theme === 'dark' ? <Sun /> : <Moon />} className="flex-1 justify-start">
          {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
        </Button>
        <Button variant="ghost" size="sm" onClick={logout} icon={<LogOut />} aria-label="Sair" title="Sair" />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* Lateral (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-rule bg-paper-2 px-3 py-5 lg:flex">
        <div className="px-2">
          <Wordmark />
        </div>
        <Button variant="ink" onClick={() => navigate('/publicar')} icon={<Plus />} className="w-full">
          Nova publicação
        </Button>
        {nav}
        {footer}
      </aside>

      {/* Barra superior (mobile/tablet) */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-rule bg-paper-2 px-4 lg:hidden">
        <Button variant="ghost" size="sm" onClick={() => setMenu(true)} icon={<Menu />} aria-label="Abrir menu" />
        <Wordmark />
        <Button variant="ink" size="sm" onClick={() => navigate('/publicar')} icon={<Plus />} aria-label="Nova publicação" />
      </header>
      {menu && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-[color-mix(in_oklch,var(--color-board)_30%,transparent)]" onClick={() => setMenu(false)} aria-hidden />
          <div className="slide-in absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-6 bg-paper-2 px-3 py-4 shadow-overlay" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="flex items-center justify-between px-2">
              <Wordmark />
              <Button variant="ghost" size="sm" onClick={() => setMenu(false)} icon={<X />} aria-label="Fechar menu" />
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}

      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}

export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={`mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8 ${wide ? 'max-w-[110rem]' : 'max-w-[90rem]'}`}>{children}</div>;
}
