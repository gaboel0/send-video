import { prisma, type Provider } from './prisma.js';

export type HttpBody = NonNullable<RequestInit['body']>;

export interface HttpCall {
  provider: Provider;
  operation: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: HttpBody | null;
  userId?: string | null;
  timeoutMs?: number;
  /** Necessário em Node quando o corpo é um stream */
  duplex?: 'half';
}

export interface HttpResult<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
  headers: Headers;
}

/** Remove tokens e segredos da URL antes de registrar */
export function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ['access_token', 'client_secret', 'fb_exchange_token', 'code', 'input_token', 'refresh_token']) {
      if (u.searchParams.has(k)) u.searchParams.set(k, '***');
    }
    // URLs de upload do TikTok carregam assinatura na query
    if (u.hostname.includes('tiktok') && u.pathname.includes('upload')) u.search = '?…';
    return u.toString();
  } catch {
    return url.split('?')[0];
  }
}

/**
 * fetch com timeout, parse de JSON e registro em IntegrationLog.
 * Não lança em status HTTP de erro: quem chama interpreta a resposta do provedor.
 * Lança apenas em falha de rede/timeout (erro transitório).
 */
export async function httpCall<T = any>(call: HttpCall): Promise<HttpResult<T>> {
  const started = Date.now();
  const method = call.method ?? 'GET';
  let status: number | undefined;
  let errorMessage: string | undefined;
  let errorCode: string | undefined;
  let requestId: string | undefined;
  try {
    const res = await fetch(call.url, {
      method,
      headers: call.headers,
      body: call.body ?? undefined,
      signal: AbortSignal.timeout(call.timeoutMs ?? 60_000),
      // duplex é exigido pelo undici para corpo em stream
      ...(call.duplex ? { duplex: call.duplex } : {}),
    } as RequestInit);
    status = res.status;
    requestId = res.headers.get('x-tt-logid') ?? res.headers.get('x-fb-trace-id') ?? undefined;
    const text = await res.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* resposta não-JSON */
    }
    const providerError = extractProviderError(data);
    if (!res.ok || providerError) {
      errorCode = providerError?.code ?? String(res.status);
      errorMessage = providerError?.message ?? (typeof data === 'string' ? data.slice(0, 300) : undefined);
      requestId = providerError?.logId ?? requestId;
    }
    return { status: res.status, ok: res.ok && !providerError, data, headers: res.headers };
  } catch (err) {
    errorCode = (err as Error).name === 'TimeoutError' ? 'timeout' : 'network_error';
    errorMessage = (err as Error).message;
    throw err;
  } finally {
    prisma.integrationLog
      .create({
        data: {
          userId: call.userId ?? null,
          provider: call.provider,
          operation: call.operation,
          method,
          url: sanitizeUrl(call.url),
          statusCode: status ?? null,
          ok: !errorCode,
          durationMs: Date.now() - started,
          errorCode: errorCode ?? null,
          errorMessage: errorMessage?.slice(0, 1000) ?? null,
          requestId: requestId ?? null,
        },
      })
      .catch(() => {});
  }
}

function extractProviderError(data: any): { code: string; message: string; logId?: string } | undefined {
  if (!data || typeof data !== 'object') return;
  // TikTok: { error: { code: "ok" | "...", message, log_id } }
  if (data.error && typeof data.error === 'object' && 'code' in data.error && typeof data.error.code === 'string') {
    if (data.error.code === 'ok') return;
    return { code: data.error.code, message: data.error.message ?? '', logId: data.error.log_id };
  }
  // Meta: { error: { message, type, code, error_subcode, fbtrace_id } }
  if (data.error && typeof data.error === 'object' && typeof data.error.code === 'number') {
    const sub = data.error.error_subcode ? `/${data.error.error_subcode}` : '';
    return {
      code: `${data.error.code}${sub}`,
      message: data.error.error_user_msg ?? data.error.message ?? '',
      logId: data.error.fbtrace_id,
    };
  }
  // OAuth do TikTok: { error: "invalid_grant", error_description }
  if (typeof data.error === 'string') {
    return { code: data.error, message: data.error_description ?? data.error };
  }
}
