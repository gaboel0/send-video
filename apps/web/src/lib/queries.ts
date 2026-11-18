import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Connection, Dashboard, Folder, IntegrationStatus, Post, PostDetail, User, Video } from './types';

export const keys = {
  me: ['me'] as const,
  authStatus: ['auth-status'] as const,
  dashboard: ['dashboard'] as const,
  accounts: ['accounts'] as const,
  integrations: ['integrations'] as const,
  folders: ['folders'] as const,
  videos: (params: Record<string, string | undefined>) => ['videos', params] as const,
  video: (id: string) => ['video', id] as const,
  posts: (params: Record<string, string | undefined>) => ['posts', params] as const,
  post: (id: string) => ['post', id] as const,
};

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api.get<{ user: User | null }>('/api/auth/me'), staleTime: 60_000 });
export const useAuthStatus = () =>
  useQuery({ queryKey: keys.authStatus, queryFn: () => api.get<{ needsSetup: boolean; signupAllowed: boolean }>('/api/auth/status') });

/** Atualiza sozinho enquanto há publicações em andamento */
export const useDashboard = () =>
  useQuery({
    queryKey: keys.dashboard,
    queryFn: () => api.get<Dashboard>('/api/dashboard'),
    refetchInterval: (q) => (q.state.data?.upcoming.some((u) => ['QUEUED', 'PROCESSING'].includes(u.status)) ? 5000 : 30000),
  });

export const useAccounts = () => useQuery({ queryKey: keys.accounts, queryFn: () => api.get<Connection[]>('/api/accounts') });
export const useIntegrations = () => useQuery({ queryKey: keys.integrations, queryFn: () => api.get<IntegrationStatus>('/api/integrations/status') });
export const useFolders = () =>
  useQuery({ queryKey: keys.folders, queryFn: () => api.get<{ total: number; unfiled: number; folders: Folder[] }>('/api/folders') });

export const useVideos = (params: Record<string, string | undefined>) =>
  useQuery({ queryKey: keys.videos(params), queryFn: () => api.get<Video[]>(`/api/videos${qs(params)}`), placeholderData: (prev) => prev });

export const usePosts = (params: Record<string, string | undefined>, live = true) =>
  useQuery({
    queryKey: keys.posts(params),
    queryFn: () => api.get<Post[]>(`/api/posts${qs(params)}`),
    placeholderData: (prev) => prev,
    refetchInterval: (q) => (live && q.state.data?.some((p) => ['QUEUED', 'PROCESSING'].includes(p.status)) ? 5000 : false),
  });

export const usePost = (id: string | null | undefined) =>
  useQuery({
    queryKey: keys.post(id ?? ''),
    queryFn: () => api.get<PostDetail>(`/api/posts/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && ['QUEUED', 'PROCESSING'].includes(q.state.data.status) ? 4000 : false),
  });

export function useInvalidate() {
  const qc = useQueryClient();
  return (...groups: Array<'posts' | 'videos' | 'dashboard' | 'accounts' | 'folders' | 'post' | 'video'>) =>
    Promise.all(groups.map((g) => qc.invalidateQueries({ queryKey: [g] })));
}
