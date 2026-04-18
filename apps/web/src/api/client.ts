/**
 * Tiny typed fetch wrapper around the Conduit API. All requests carry
 * `X-API-Key` + `Content-Type: application/json`; errors surface with the
 * server-provided body where possible.
 */

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
const API_KEY = (import.meta.env.VITE_API_KEY as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
      ...init.headers,
    },
  });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const message =
      parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : res.statusText;
    throw new ApiError(res.status, parsed, message);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export const apiBaseUrl = BASE_URL;
