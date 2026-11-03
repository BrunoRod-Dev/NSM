import { Injectable } from '@angular/core';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
@Injectable({ providedIn: 'root' })
export class ApiService {
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api${path}`, { method, credentials: 'same-origin', cache: 'no-store', ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    } catch { throw new ApiError('No hay conexión con NSM. Revisá tu conexión y volvé a intentar.', 0); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data.error ?? 'No se pudo completar la operación.', response.status, data.code);
    return data as T;
  }
}
