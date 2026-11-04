import { GameCatalog } from './game-catalog.js';
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { GameInvitation, GameRoom, GamesState, User } from '../../../../packages/contracts/src/index.js';
import { Database, lockPair } from '../db.js';
import { canContact } from '../friends/friends.service.js';
import { AppError, forbidden } from '../errors.js';
import { userFromRow } from '../accounts/accounts.service.js';
import type { Config } from '../config.js';

interface Event { eventId: number; type: string; from?: number; seat?: number; description?: unknown; candidate?: unknown }
interface Member { user: User; seat: number; seen: number; queue: Event[]; sequence: number }
interface Room { id: string; gameId: string; host: User; members: Map<string, Member>; created: number; ready: boolean; clientId?: string }
const missing = () => new AppError(410, 'La partida terminó o ya no está disponible.', 'GAME_ENDED');
const iceSchema = z.array(z.object({ urls: z.union([z.string(), z.array(z.string()).min(1).max(8)]), username: z.string().max(512).optional(), credential: z.string().max(2048).optional() })).min(1).max(8);
const signalSchema = z.object({ to: z.number().int().min(0).max(3), data: z.discriminatedUnion('type', [
  z.object({ type: z.literal('offer'), description: z.object({ type: z.literal('offer'), sdp: z.string().max(24000) }) }),
  z.object({ type: z.literal('answer'), description: z.object({ type: z.literal('answer'), sdp: z.string().max(24000) }) }),
  z.object({ type: z.literal('ice'), candidate: z.object({ candidate: z.string().max(4096), sdpMid: z.string().nullable().optional(), sdpMLineIndex: z.number().int().nullable().optional(), usernameFragment: z.string().nullable().optional() }) }),
]) });

export class GamesService {
  readonly catalog: GameCatalog;
  private rooms = new Map<string, Room>();
  private invitations = new Map<string, GameInvitation>();
  private notify: (ids: string[]) => void;
  readonly iceServers: z.infer<typeof iceSchema>;
  constructor(private db: Database, private config: Config, notify: (ids: string[]) => void = () => {}, private signalPending: (id: string) => void = () => {}) {
    this.catalog = new GameCatalog(config);
    this.notify = notify;
    this.iceServers = iceSchema.parse(config.RTC_ICE_SERVERS ? JSON.parse(config.RTC_ICE_SERVERS) : [{ urls: 'stun:stun.l.google.com:19302' }]);
    for (const server of this.iceServers) for (const url of Array.isArray(server.urls) ? server.urls : [server.urls]) if (!/^(stun|stuns|turn|turns):[^\s]+$/.test(url)) throw new Error('RTC_ICE_SERVERS contiene una URL inválida.');
  }
  private emit(room: Room, extra: string[] = []) {
    const invited = [...this.invitations.values()].filter(i => i.roomId === room.id).flatMap(i => [i.to.id, i.from.id]);
    this.notify([...new Set([...room.members.keys(), ...invited, ...extra])]);
  }
  private enqueue(member: Member, event: Omit<Event, 'eventId'>) {
    if (member.queue.length >= 100) throw new AppError(429, 'Esperá a que el otro jugador reconecte.', 'GAME_QUEUE_FULL');
    member.queue.push({ ...event, eventId: ++member.sequence });
    this.signalPending(member.user.id);
  }
  private view(room: Room): GameRoom { return { id: room.id, gameId: room.gameId, game: this.catalog.definition(room.gameId), host: room.host, ready: room.ready, players: [...room.members.values()].map(m => ({ user: m.user, seat: m.seat, reservedMinutes: Date.now() - m.seen > 30000 ? Math.max(1, Math.ceil((m.seen + 300000 - Date.now()) / 60000)) : undefined })), createdAt: new Date(room.created).toISOString() }; }
  async files(gameId = 'crash-bash') { return this.catalog.files(gameId); }
  async state(user: User): Promise<GamesState> {
    this.sweep();
    const available = !!await this.files();
    const canHost = true;
    return { catalog: await this.catalog.list(), available, canHost, reason: !available ? 'El anfitrión necesita configurar la carpeta de Crash Bash con el juego, la BIOS y el emulador.' : !canHost ? `Las partidas se ejecutan en la cuenta anfitriona ${this.config.CRASH_HOST_USERNAME ?? 'sin configurar'}.` : '', rooms: [...this.rooms.values()].filter(r => r.members.has(user.id)).map(r => this.view(r)), incoming: [...this.invitations.values()].filter(i => i.to.id === user.id), outgoing: [...this.invitations.values()].filter(i => i.from.id === user.id) };
  }
  async create(user: User, gameId: string) {
    this.sweep();
    const game = this.catalog.definition(gameId);
    if (!game.enabled || !await this.files(gameId)) throw new AppError(503, 'Los archivos de este juego no están disponibles.', 'GAME_UNAVAILABLE');
    const existing = [...this.rooms.values()].find(r => r.members.has(user.id));
    if (existing) {
      if (existing.host.id === user.id && existing.gameId === gameId) return {room:this.view(existing)};
      throw new AppError(409, 'Primero salí de tu sala actual.');
    }
    const room: Room = { id: randomUUID(), gameId, host:user, members:new Map([[user.id,{user,seat:0,seen:Date.now(),queue:[],sequence:0}]]),created:Date.now(),ready:false };
    this.rooms.set(room.id,room); this.emit(room);
    return {room:this.view(room)};
  }
  async invite(user: User, targetId: string, gameId = 'crash-bash') {
    this.sweep();
    const game = this.catalog.definition(gameId);
    if (!game.enabled) throw new AppError(503, 'Este juego todavía no está habilitado.', 'GAME_UNAVAILABLE');
    if (!await this.files(gameId)) throw new AppError(503, 'No se encuentran los archivos del juego seleccionado.', 'GAME_UNAVAILABLE');
    return this.db.transaction(async client => {
      await lockPair(client, user.id, targetId);
      if (!await canContact(client, user.id, targetId)) throw forbidden();
      const target = userFromRow((await client.query('SELECT id,username,display_name FROM users WHERE id=$1', [targetId])).rows[0]);
      let room = [...this.rooms.values()].find(r => r.host.id === user.id);
      if ([...this.rooms.values()].some(r => r.members.has(user.id) && r !== room)) throw new AppError(409, 'Primero salí de tu sala actual.');
      if ([...this.rooms.values()].some(r => r.members.has(targetId) && r !== room)) throw new AppError(409, 'Tu amigo ya está en otra partida.');
      if (room && room.gameId !== gameId) throw new AppError(409, 'Primero terminá tu partida actual.');
      if (!room) {
        room = { id: randomUUID(), gameId, host: user, members: new Map([[user.id, { user, seat: 0, seen: Date.now(), queue: [], sequence: 0 }]]), created: Date.now(), ready: false };
        this.rooms.set(room.id, room);
      }
      if (room.members.has(targetId)) return { room: this.view(room) };
      const existing = [...this.invitations.values()].find(i => i.roomId === room!.id && i.to.id === targetId);
      if (existing) return { room: this.view(room) };
      const pending = [...this.invitations.values()].filter(i => i.roomId === room!.id).length;
      if (room.members.size + pending >= game.maxPlayers) throw new AppError(409, 'La partida ya tiene sus cuatro plazas ocupadas o reservadas.');
      const invitation: GameInvitation = { id: randomUUID(), roomId: room.id, gameId, game, from: user, to: target, expiresAt: new Date(Date.now() + 300000).toISOString() };
      this.invitations.set(invitation.id, invitation);
      this.emit(room);
      return { room: this.view(room) };
    });
  }
  async respond(user: User, invitationId: string, accept: boolean) {
    this.sweep();
    const invitation = this.invitations.get(invitationId);
    if (!invitation || invitation.to.id !== user.id) throw forbidden();
    const room = this.rooms.get(invitation.roomId);
    if (!room) throw missing();
    return this.db.transaction(async client => {
      await lockPair(client, user.id, room.host.id);
      if (!await canContact(client, user.id, room.host.id)) throw forbidden();
      if (this.invitations.get(invitationId) !== invitation || this.rooms.get(room.id) !== room) throw missing();
      if (accept) {
        if ([...this.rooms.values()].some(r => r.id !== room.id && r.members.has(user.id))) throw new AppError(409, 'Primero salí de tu otra partida.');
        const blocked = await client.query('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND target_id=ANY($2::uuid[])) OR (target_id=$1 AND blocker_id=ANY($2::uuid[]))', [user.id, [...room.members.keys()]]);
        if (blocked.rowCount) throw forbidden();
        const used = new Set([...room.members.values()].map(m => m.seat));
        const seat = Array.from({ length: this.catalog.definition(room.gameId).maxPlayers - 1 }, (_, i) => i + 1).find(s => !used.has(s));
        if (seat === undefined) throw new AppError(409, 'La partida está completa.');
        room.members.set(user.id, { user, seat, seen: Date.now(), queue: [], sequence: 0 });
        this.enqueue(room.members.get(room.host.id)!, { type: 'joined', seat });
      }
      this.invitations.delete(invitationId);
      this.emit(room, [user.id]);
      return { room: accept ? this.view(room) : null };
    });
  }
  async authorize(user: User, roomId: string) {
    const room = this.rooms.get(roomId), member = room?.members.get(user.id);
    if (!room || !member) throw forbidden();
    if (member.seat !== 0) {
      const permitted = await this.db.transaction(client => canContact(client, user.id, room.host.id));
      if (!permitted) { this.leave(user.id, roomId); throw forbidden(); }
    }
    if (this.rooms.get(roomId) !== room || room.members.get(user.id) !== member) throw missing();
    member.seen = Date.now();
    return { room, member };
  }
  async player(user: User, roomId: string) {
    const { room, member } = await this.authorize(user, roomId);
    const secret = this.config.TURN_SHARED_SECRET;
    const username = Math.floor(Date.now() / 1000 + 12 * 3600) + ':' + user.id;
    const iceServers = this.iceServers.map(server => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      if (!secret || !urls.some(url => /^turns?:/.test(url))) return server;
      return { urls: server.urls, username, credential: createHmac('sha1', secret).update(username).digest('base64') };
    });
    return { ...this.view(room), seat: member.seat, hasSbi: member.seat === 0 && !!(await this.files(room.gameId))?.sbi, iceServers };
  }
  async engine(user: User, roomId: string, action: string, body: Record<string, unknown>) {
    const { room, member } = await this.authorize(user, roomId);
    if (action === 'host-reset') {
      if (member.seat !== 0) throw forbidden();
      room.clientId = z.uuid().parse(body['clientId']); room.ready = false; member.queue = [];
      for (const guest of room.members.values()) if (guest.seat) this.enqueue(member, { type: 'joined', seat: guest.seat });
      this.emit(room);
      return { ok: true };
    }
    if (member.seat === 0 && room.clientId !== body['clientId']) throw new AppError(409, 'Esta partida se abrió en otra ventana de la cuenta anfitriona.', 'HOST_REPLACED');
    if (action === 'heartbeat') return { ok: true };
    if (action === 'ready') { if (member.seat !== 0) throw forbidden(); room.ready = true; this.emit(room); return { ok: true }; }
    if (action === 'poll') {
      const ack = z.number().int().min(0).max(member.sequence).parse(body['ack'] ?? 0);
      member.queue = member.queue.filter(e => e.eventId > ack);
      return { events: member.queue, players: [...room.members.values()].map(m => m.seat), ready: room.ready };
    }
    if (action === 'resume') {
      if (!member.seat) throw forbidden();
      member.queue = [];
      const host = room.members.get(room.host.id)!;
      host.queue = host.queue.filter(e => e.from !== member.seat && e.seat !== member.seat);
      this.enqueue(host, { type: 'joined', seat: member.seat });
      return { ok: true };
    }
    if (action === 'signal') {
      const { to, data } = signalSchema.parse(body);
      if (to === member.seat || (member.seat !== 0 && to !== 0) || (data.type === 'offer' && member.seat !== 0) || (data.type === 'answer' && member.seat === 0)) throw forbidden();
      const target = [...room.members.values()].find(m => m.seat === to);
      if (!target) throw new AppError(409, 'Ese jugador ya salió de la partida.');
      this.enqueue(target, { ...data, from: member.seat });
      return { ok: true };
    }
    throw new AppError(404, 'Acción de partida no disponible.');
  }
  leave(userId: string, roomId: string) {
    const room = this.rooms.get(roomId), member = room?.members.get(userId);
    if (!room || !member) return;
    if (member.seat === 0) { this.emit(room); this.rooms.delete(roomId); for (const [id, invite] of this.invitations) if (invite.roomId === roomId) this.invitations.delete(id); return; }
    room.members.delete(userId);
    for (const other of room.members.values()) other.queue = other.queue.filter(e => e.from !== member.seat && e.seat !== member.seat);
    this.enqueue(room.members.get(room.host.id)!, { type: 'left', seat: member.seat });
    this.emit(room, [userId]);
  }
  leaveUser(userId: string) {
    for (const room of [...this.rooms.values()]) this.leave(userId, room.id);
    for (const [id, invitation] of this.invitations) if (invitation.from.id === userId || invitation.to.id === userId) { this.invitations.delete(id); this.notify([invitation.from.id, invitation.to.id]); }
  }
  revokeContact(a: string, b: string) {
    for (const [id, invitation] of this.invitations) if ([invitation.from.id, invitation.to.id].includes(a) && [invitation.from.id, invitation.to.id].includes(b)) { this.invitations.delete(id); this.notify([a, b]); }
    for (const room of [...this.rooms.values()]) if (room.members.has(a) && room.members.has(b)) this.leave(room.host.id === b ? a : b, room.id);
  }
  sweep() {
    const now = Date.now();
    for (const [id, invitation] of this.invitations) if (Date.parse(invitation.expiresAt) <= now) { this.invitations.delete(id); this.notify([invitation.from.id, invitation.to.id]); }
    for (const room of [...this.rooms.values()]) {
      if (now - room.members.get(room.host.id)!.seen > 300000) { this.leave(room.host.id, room.id); continue; }
      for (const member of [...room.members.values()]) if (member.seat && now - member.seen > 300000) this.leave(member.user.id, room.id);
    }
  }
  close() { this.rooms.clear(); this.invitations.clear(); }
}
