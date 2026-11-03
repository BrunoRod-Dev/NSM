import { Component, ElementRef, ViewChild, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import type { Conversation } from '../../../../../packages/contracts/src/index';
import { MessengerService } from './messenger.service';
import { SessionService } from '../accounts/session.service';
import { GamesService } from '../games/games.service';

@Component({ selector: 'nsm-chat', imports: [FormsModule, DatePipe], templateUrl: './chat.component.html' })
export class ChatComponent {
  readonly store = inject(MessengerService);
  readonly session = inject(SessionService);
  readonly games = inject(GamesService);
  readonly conversation = input.required<Conversation>();
  readonly active = input(false);
  readonly maximized = input(false);
  readonly showFriends = output<void>();
  readonly toggleMaximize = output<void>();
  readonly focusWindow = output<void>();
  readonly minimize = output<void>();
  readonly closeWindow = output<void>();
  readonly moved = output<{ dx: number; dy: number }>();
  readonly draft = signal('');
  readonly peerOnline = computed(() => this.store.social().friends.find(friend => friend.id === this.conversation().peer.id)?.online ?? false);
  readonly connectionLabel = computed(() => ({ online: 'Conexión establecida', connecting: 'Conectando…', offline: 'Sin conexión · reconectando…' })[this.store.connection()]);
  @ViewChild('transcript') transcript?: ElementRef<HTMLElement>;
  private drag: { x: number; y: number } | null = null;
  private lastCount = 0;
  private loadingOlder = false;
  constructor() {
    effect(() => {
      const conversation = this.conversation();
      const count = this.store.messages()[conversation.id]?.length ?? 0;
      const pending = this.store.pending()[conversation.id]?.length ?? 0;
      untracked(() => {
        const transcript = this.transcript?.nativeElement;
        const stickToBottom = this.lastCount === 0 || !transcript || transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 160;
        this.lastCount = count;
        if ((count || pending) && stickToBottom && !this.loadingOlder) setTimeout(() => {
          const el = this.transcript?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        });
      });
    });
  }
  send() {
    const text = this.draft().trim();
    if (!text || !this.conversation().canSend) return;
    this.draft.set('');
    void this.store.send(this.conversation().id, text);
    setTimeout(() => { const el = this.transcript?.nativeElement; if (el) el.scrollTop = el.scrollHeight; });
  }
  keydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !matchMedia('(max-width: 900px)').matches) { event.preventDefault(); this.send(); }
  }
  async loadOlder() {
    const el = this.transcript?.nativeElement;
    if (!el || this.loadingOlder) return;
    const top = el.scrollTop, height = el.scrollHeight;
    this.loadingOlder = true;
    try { await this.store.older(this.conversation().id); }
    finally {
      setTimeout(() => {
        el.scrollTop = top + el.scrollHeight - height;
        this.loadingOlder = false;
      });
    }
  }
  pointerDown(event: PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button') || this.maximized() || matchMedia('(max-width: 900px)').matches) return;
    this.focusWindow.emit(); this.drag = { x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  pointerMove(event: PointerEvent) {
    if (!this.drag) return;
    this.moved.emit({ dx: event.clientX - this.drag.x, dy: event.clientY - this.drag.y });
    this.drag = { x: event.clientX, y: event.clientY };
  }
  pointerUp() { this.drag = null; }
  async block() {
    const peer = this.conversation().peer;
    if (confirm(`¿Bloquear a ${peer.displayName}? Se conserva el historial.`)) await this.store.action(`/friends/${peer.id}/block`);
  }
}
