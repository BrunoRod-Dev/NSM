import { Injectable, computed, inject, signal } from '@angular/core';
import type { GameRoom, GamesState } from '../../../../../packages/contracts/src/index';
import { ApiService } from '../core/api.service';
import { SessionService } from '../accounts/session.service';

@Injectable({ providedIn: 'root' })
export class GamesService {
  private api = inject(ApiService);
  private session = inject(SessionService);
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private refreshing = false;
  private refreshAgain = false;
  readonly state = signal<GamesState>({ catalog: [], canHost: false, available: false, reason: '', rooms: [], incoming: [], outgoing: [] });
  readonly selectedGameId = signal('crash-bash');
  readonly visible = signal(false);
  readonly activeId = signal<string | null>(null);
  readonly activeRoom = computed(() => this.state().rooms.find(room => room.id === this.activeId()) ?? null);
  readonly openRequest = signal(0);
  readonly error = signal('');
  readonly busy = signal(false);
  start() { this.stop(); void this.refresh(); this.timer = setInterval(() => void this.refresh(), 10000); }
  stop() {
    this.generation++; clearInterval(this.timer); this.timer = undefined;
    this.refreshing = false; this.refreshAgain = false; this.visible.set(false); this.activeId.set(null);
    this.state.set({ catalog: [], canHost: false, available: false, reason: '', rooms: [], incoming: [], outgoing: [] }); this.error.set('');
  }
  async refresh() {
    if (!this.session.user()) return;
    if (this.refreshing) { this.refreshAgain = true; return; }
    this.refreshing = true;
    const generation = this.generation;
    try {
      do {
        this.refreshAgain = false;
        const state = await this.api.request<GamesState>('/games');
        if (generation !== this.generation) return;
        this.state.set(state);
        if (this.activeId() && !state.rooms.some(room => room.id === this.activeId())) this.activeId.set(null);
      } while (this.refreshAgain);
    } catch (error) { if (generation === this.generation) this.error.set(error instanceof Error ? error.message : 'No se pudo consultar la partida.'); }
    finally { if (generation === this.generation) this.refreshing = false; }
  }
  open(room?: GameRoom) { if (room) this.activeId.set(room.id); this.visible.set(true); this.openRequest.update(value => value + 1); }
  async create(gameId: string) {
    if(this.busy()) return;
    this.busy.set(true);this.error.set('');
    try { const result=await this.api.request<{room:GameRoom}>('/games/rooms','POST',{gameId});await this.refresh();this.open(result.room); }
    catch(error){this.error.set(error instanceof Error?error.message:'No se pudo crear la sala.');}
    finally{this.busy.set(false);}
  }
  async invite(targetId: string) {
    if (this.busy()) return;
    this.busy.set(true); this.error.set('');
    try { const result = await this.api.request<{ room: GameRoom }>('/games/invitations', 'POST', { targetId, gameId: this.activeRoom()?.gameId ?? this.selectedGameId() }); await this.refresh(); this.open(result.room); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'No se pudo invitar.'); this.open(); }
    finally { this.busy.set(false); }
  }
  async respond(id: string, accept: boolean) {
    if (this.busy()) return;
    this.busy.set(true); this.error.set('');
    try { const result = await this.api.request<{ room: GameRoom | null }>(`/games/invitations/${id}`, 'POST', { accept }); await this.refresh(); if (result.room) this.open(result.room); }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'No se pudo responder.'); }
    finally { this.busy.set(false); }
  }
  async leave() {
    const room = this.activeRoom(); if (!room) return true;
    try { await this.api.request(`/games/rooms/${room.id}/leave`, 'POST'); this.activeId.set(null); await this.refresh(); return true; }
    catch (error) { this.error.set(error instanceof Error ? error.message : 'No se pudo salir.'); return false; }
  }
}
