export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'bad_request', details);
export const notFound = (msg = 'Não encontrado') => new HttpError(404, msg, 'not_found');
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, 'conflict', details);
export const forbidden = (msg = 'Acesso negado') => new HttpError(403, msg, 'forbidden');

/**
 * Erro de publicação classificado. O worker decide o que fazer com base em `kind`:
 *  - retry: falha transitória (rede, 5xx, limite de taxa) → nova tentativa com backoff
 *  - fatal: o conteúdo/requisição é inválido → FAILED
 *  - action: precisa de intervenção do usuário (reconectar conta, permissão, aprovação) → NEEDS_ACTION
 */
export type PublishErrorKind = 'retry' | 'fatal' | 'action';

export class PublishError extends Error {
  constructor(
    public kind: PublishErrorKind,
    public code: string,
    message: string,
    public details?: unknown,
    /** Atraso sugerido para a próxima tentativa (ex.: Retry-After) */
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Token expirado/revogado: marca a conexão como EXPIRED e o destino como NEEDS_ACTION */
export class TokenExpiredError extends PublishError {
  constructor(message = 'O acesso à conta expirou ou foi revogado. Reconecte a conta.') {
    super('action', 'token_expired', message);
  }
}
