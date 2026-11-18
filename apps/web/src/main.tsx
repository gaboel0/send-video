import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { Shell } from './components/Shell';
import { ConfirmProvider, Skeleton, ToastProvider } from './components/ui';
import { UploadProvider } from './components/Uploads';
import { ApiError } from './lib/api';
import { useMe } from './lib/queries';
import { AccountsPage } from './pages/Accounts';
import { AuthPage } from './pages/Auth';
import { CalendarPage } from './pages/Calendar';
import { ComposerPage } from './pages/Composer';
import { DashboardPage } from './pages/Dashboard';
import { LibraryPage } from './pages/Library';
import { PostsPage } from './pages/Posts';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Skeleton className="h-2 w-40" />
      </div>
    );
  }
  if (!data?.user) return <Navigate to="/entrar" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <UploadProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/entrar" element={<AuthPage />} />
              <Route
                element={
                  <RequireAuth>
                    <Shell />
                  </RequireAuth>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="calendario" element={<CalendarPage />} />
                <Route path="biblioteca" element={<LibraryPage />} />
                <Route path="publicacoes" element={<PostsPage />} />
                <Route path="publicar" element={<ComposerPage />} />
                <Route path="publicar/:postId" element={<ComposerPage />} />
                <Route path="contas" element={<AccountsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
          </UploadProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
