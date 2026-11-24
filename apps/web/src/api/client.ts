import type { ApiError } from '@mainframe/shared';

export class ApiErrorException extends Error implements ApiError {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** JSON-Aufruf gegen das Backend. Fehler kommen als ApiErrorException mit deutscher Meldung. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new ApiErrorException('offline', 'Mainframe ist gerade nicht erreichbar.', 0);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiError>;
    throw new ApiErrorException(err.code ?? 'error', err.message ?? `Fehler ${res.status}`, res.status);
  }
  return data as T;
}

export const post = <T = void>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Da ist was schiefgelaufen.';
}
