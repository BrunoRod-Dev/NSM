import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { User } from '../../../../../packages/contracts/src/index';
import { MessengerService } from '../messenger/messenger.service';
import { SessionService } from '../accounts/session.service';
import { GamesService } from '../games/games.service';

@Component({ selector: 'nsm-friends', imports: [FormsModule], templateUrl: './friends.component.html' })
export class FriendsComponent {
  readonly store = inject(MessengerService);
  readonly session = inject(SessionService);
  readonly games = inject(GamesService);
  readonly openPeer = output<string>();
  readonly tab = signal<'friends' | 'requests' | 'history'>('friends');
  readonly editing = signal(false);
  readonly showBlocked = signal(false);
  readonly busy = signal(false);
  readonly notice = signal('');
  readonly connectionLabel = computed(() => ({ online: 'Conectado', connecting: 'Conectando…', offline: 'Sin conexión · reconectando…' })[this.store.connection()]);
  readonly online = computed(() => this.store.social().friends.filter(f => f.online));
  readonly offline = computed(() => this.store.social().friends.filter(f => !f.online));
  username = ''; name = '';
  async add() {
    if (this.busy()) return;
    this.busy.set(true); this.notice.set('');
    if (await this.store.action('/friends/requests', { username: this.username })) { this.username = ''; this.notice.set('Solicitud enviada.'); }
    this.busy.set(false);
  }
  async respond(id: string, accept: boolean) { await this.store.action(`/friends/requests/${id}`, { accept }); }
  async change(peer: User, action: 'remove' | 'block' | 'unblock') {
    const verb = action === 'remove' ? 'Eliminar de tus amigos a' : action === 'block' ? 'Bloquear a' : 'Desbloquear a';
    if (confirm(`${verb} ${peer.displayName} (@${peer.username})?`)) await this.store.action(`/friends/${peer.id}/${action}`);
  }
  editName() { this.name = this.session.user()?.displayName ?? ''; this.editing.set(true); }
  async saveName() {
    try { await this.session.rename(this.name); this.editing.set(false); }
    catch (error) { this.store.error.set(error instanceof Error ? error.message : 'No se pudo guardar el nombre.'); }
  }
  async logout() {
    if (Object.values(this.store.pending()).some(all => all?.length) && !confirm('Tenés mensajes sin confirmar. Si salís, perderás los reintentos pendientes. ¿Salir igual?')) return;
    try { await this.session.logout(); }
    catch (error) { this.store.error.set(error instanceof Error ? error.message : 'No se pudo cerrar la sesión.'); }
  }
}
