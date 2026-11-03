import { Injectable, inject, signal } from '@angular/core';
import type { User } from '../../../../../packages/contracts/src/index';
import { ApiError, ApiService } from '../core/api.service';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private api = inject(ApiService);
  readonly user = signal<User | null>(null);
  readonly ready = signal(false);
  readonly recoveryCode = signal<string | null>(null);
  readonly notice = signal('');
  async restore() {
    try { this.user.set((await this.api.request<{ user: User }>('/auth/me')).user); }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) this.notice.set(error instanceof Error ? error.message : 'No se pudo conectar.'); }
    finally { this.ready.set(true); }
  }
  async authenticate(mode: 'login' | 'register' | 'recover', data: unknown) {
    const result = await this.api.request<{ user: User; recoveryCode?: string }>(`/auth/${mode}`, 'POST', data);
    this.notice.set('');
    this.recoveryCode.set(null);
    this.user.set(result.user);
  }
  async rename(displayName: string) {
    this.user.set((await this.api.request<{ user: User }>('/account', 'PATCH', { displayName })).user);
  }
  async logout() { await this.api.request('/auth/logout', 'POST'); this.clear(); }
  clear(message = '') { this.user.set(null); this.recoveryCode.set(null); this.notice.set(message); }
}
