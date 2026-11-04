import { Injectable, inject, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents, SocialState, Conversation, Message, MessagePage } from '../../../../../packages/contracts/src/index';
import { ApiError, ApiService } from '../core/api.service';
import { SessionService } from '../accounts/session.service';
import { GamesService } from '../games/games.service';

export interface PendingMessage { clientId: string; text: string; status: 'pending' | 'failed'; error?: string }
@Injectable({ providedIn: 'root' })
export class MessengerService {
  private api = inject(ApiService);
  private session = inject(SessionService);
  private games = inject(GamesService);
  private socket?: Socket<ServerEvents, ClientEvents>;
  private generation = 0;
  private refreshRunning = false;
  private refreshAgain = false;
  private catchups = new Set<string>();
  private cursors = new Map<string, number>();
  readonly connection = signal<'connecting' | 'online' | 'offline'>('connecting');
  readonly social = signal<SocialState>({ friends: [], incoming: [], outgoing: [], blocked: [] });
  readonly conversations = signal<Conversation[]>([]);
  readonly messages = signal<Partial<Record<string, Message[]>>>({});
  readonly pending = signal<Partial<Record<string, PendingMessage[]>>>({});
  readonly hasOlder = signal<Record<string, boolean>>({});
  readonly loading = signal<Record<string, boolean>>({});
  readonly error = signal('');
  readonly drafts = signal<Record<string, string>>({});
  readonly unread = signal<Record<string, number>>({});
  activeConversation: string | null = null;
  start() {
    this.stop();
    this.connection.set('connecting');
    const socket = io({ autoConnect: false, transports: ['websocket'], withCredentials: true });
    this.socket = socket;
    socket.on('connect', () => {
      this.connection.set('online');
      void this.refresh();
      void this.games.refresh();
      for (const id of this.cursors.keys()) void this.catchUp(id);
    });
    socket.on('disconnect', reason => {
      this.connection.set('offline');
      if (reason === 'io server disconnect' && this.session.user()) void this.checkSession();
    });
    socket.on('connect_error', () => { this.connection.set('offline'); void this.checkSession(); });
    socket.on('session:expired', () => this.session.clear('Tu sesión terminó. Volvé a conectar.'));
    socket.on('social:changed', () => void this.refresh());
    socket.on('games:signal', () => {
      document.querySelector<HTMLIFrameElement>('iframe.game-frame')?.contentWindow?.postMessage('nsm:signal', location.origin);
    });
    socket.on('games:changed', () => void this.games.refresh());
    socket.on('conversations:changed', () => void this.refresh());
    socket.on('presence:changed', () => void this.refresh());
    socket.on('message:new', message => {
      const isNew = !this.messages()[message.conversationId]?.some(m => m.id === message.id);
      this.merge(message.conversationId, [message]);
      if (isNew && message.senderId !== this.session.user()?.id && this.activeConversation !== message.conversationId) this.unread.update(all => ({ ...all, [message.conversationId]: (all[message.conversationId] ?? 0) + 1 }));
      this.conversations.update(all => all.map(c => c.id === message.conversationId ? { ...c, latestSeq: Math.max(c.latestSeq, message.seq) } : c));
      if (this.cursors.has(message.conversationId)) void this.catchUp(message.conversationId);
      else void this.refresh();
    });
    socket.connect();
    void this.refresh();
  }
  stop() {
    this.generation++;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = undefined;
    this.cursors.clear();
    this.catchups.clear();
    this.drafts.set({});
    this.refreshRunning = false;
    this.refreshAgain = false;
    this.social.set({ friends: [], incoming: [], outgoing: [], blocked: [] });
    this.conversations.set([]); this.messages.set({}); this.pending.set({}); this.hasOlder.set({}); this.loading.set({}); this.unread.set({}); this.error.set('');
    this.activeConversation = null;
  }
  private async checkSession() {
    try { await this.api.request('/auth/me'); }
    catch (error) { if (error instanceof ApiError && error.status === 401) this.session.clear('Tu sesión terminó. Volvé a conectar.'); }
  }
  async refresh() {
    if (!this.session.user()) return;
    if (this.refreshRunning) { this.refreshAgain = true; return; }
    this.refreshRunning = true;
    const generation = this.generation;
    try {
      do {
        this.refreshAgain = false;
        const [social, response] = await Promise.all([this.api.request<SocialState>('/social'), this.api.request<{ conversations: Conversation[] }>('/conversations')]);
        if (generation !== this.generation) return;
        this.social.set(social); this.conversations.set(response.conversations);
      } while (this.refreshAgain);
    } catch (error) { if (generation === this.generation) this.handleError(error); }
    finally { if (generation === this.generation) this.refreshRunning = false; }
  }
  async action(path: string, body?: unknown) {
    this.error.set('');
    try { await this.api.request(path, 'POST', body); await this.refresh(); return true; }
    catch (error) { this.handleError(error); return false; }
  }
  private handleError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) this.session.clear('Tu sesión terminó. Volvé a conectar.');
    else this.error.set(error instanceof Error ? error.message : 'No se pudo completar la operación.');
  }
  private merge(id: string, incoming: Message[]) {
    this.messages.update(all => {
      const byId = new Map((all[id] ?? []).map(m => [m.id, m]));
      for (const message of incoming) byId.set(message.id, message);
      return { ...all, [id]: [...byId.values()].sort((a, b) => a.seq - b.seq) };
    });
    const confirmed = new Set(incoming.filter(m => m.senderId === this.session.user()?.id).map(m => m.clientId));
    this.pending.update(all => ({ ...all, [id]: (all[id] ?? []).filter(m => !confirmed.has(m.clientId)) }));
  }
  async load(id: string) {
    this.unread.update(all => ({ ...all, [id]: 0 }));
    if (this.cursors.has(id) || this.loading()[id]) return;
    const generation = this.generation;
    this.loading.update(all => ({ ...all, [id]: true }));
    try {
      const page = await this.api.request<MessagePage>(`/conversations/${id}/messages`);
      if (generation !== this.generation) return;
      this.merge(id, page.messages);
      this.hasOlder.update(all => ({ ...all, [id]: page.hasMore }));
      this.cursors.set(id, page.messages.at(-1)?.seq ?? 0);
      await this.catchUp(id);
    } catch (error) { if (generation === this.generation) this.handleError(error); }
    finally { if (generation === this.generation) this.loading.update(all => ({ ...all, [id]: false })); }
  }
  async older(id: string) {
    const first = this.messages()[id]?.[0];
    if (!first || this.loading()[id]) return;
    const generation = this.generation;
    this.loading.update(all => ({ ...all, [id]: true }));
    try {
      const page = await this.api.request<MessagePage>(`/conversations/${id}/messages?before=${first.seq}`);
      if (generation !== this.generation) return;
      this.merge(id, page.messages); this.hasOlder.update(all => ({ ...all, [id]: page.hasMore }));
    } catch (error) { if (generation === this.generation) this.handleError(error); }
    finally { if (generation === this.generation) this.loading.update(all => ({ ...all, [id]: false })); }
  }
  private async catchUp(id: string) {
    if (this.catchups.has(id)) return;
    this.catchups.add(id);
    const generation = this.generation;
    try {
      let hasMore = true;
      while (hasMore) {
        const cursor = this.cursors.get(id);
        if (cursor === undefined) return;
        const page = await this.api.request<MessagePage>(`/conversations/${id}/messages?after=${cursor}&limit=100`);
        if (generation !== this.generation) return;
        this.merge(id, page.messages);
        this.cursors.set(id, page.messages.at(-1)?.seq ?? cursor);
        hasMore = page.hasMore;
      }
    } catch (error) { if (generation === this.generation) this.handleError(error); }
    finally { if (generation === this.generation) this.catchups.delete(id); }
  }
  async send(id: string, text: string, clientId: string = crypto.randomUUID()) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 2000) return;
    if (!this.pending()[id]?.some(m => m.clientId === clientId)) this.pending.update(all => ({ ...all, [id]: [...(all[id] ?? []), { clientId, text: trimmed, status: 'pending' }] }));
    else this.updatePending(id, clientId, 'pending');
    const socket = this.socket;
    if (!socket?.connected) { this.updatePending(id, clientId, 'failed', 'Sin conexión. Reintentá cuando vuelvas a estar conectado.'); return; }
    const generation = this.generation;
    try {
      const result = await socket.timeout(10000).emitWithAck('message:send', { conversationId: id, clientId, text: trimmed });
      if (generation !== this.generation) return;
      if (result.ok) this.merge(id, [result.message]);
      else this.updatePending(id, clientId, 'failed', result.error);
    } catch { if (generation === this.generation && this.pending()[id]?.some(m => m.clientId === clientId)) this.updatePending(id, clientId, 'failed', 'No pudimos confirmar el envío. Reintentar no lo duplica.'); }
  }
  private updatePending(id: string, clientId: string, status: 'pending' | 'failed', error?: string) {
    this.pending.update(all => ({ ...all, [id]: (all[id] ?? []).map(m => m.clientId === clientId ? { ...m, status, error } : m) }));
  }
}
