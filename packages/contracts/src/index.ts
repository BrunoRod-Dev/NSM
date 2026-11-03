import { z } from 'zod';

export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, 'Usá entre 3 y 24 letras, números o guiones bajos.');
export const displayNameSchema = z.string().trim().min(1).max(40);
export const passwordSchema = z.string().min(8, 'Usá al menos 8 caracteres.').max(128);
export const registerSchema = z.object({ username: usernameSchema, displayName: displayNameSchema, password: passwordSchema, invitation: z.string().trim().min(16).max(128).optional() });
export const loginSchema = z.object({ username: usernameSchema, password: z.string().min(1).max(128) });
export const recoverySchema = z.object({ username: usernameSchema, code: z.string().trim().min(16).max(128), password: passwordSchema });
export const messageInputSchema = z.object({ conversationId: z.uuid(), clientId: z.uuid(), text: z.string().trim().min(1).max(2000) });
export const idSchema = z.uuid();

export interface User { id: string; username: string; displayName: string }
export interface Contact extends User { online: boolean }
export interface FriendRequest { id: string; from: User; to: User }
export interface SocialState { friends: Contact[]; incoming: FriendRequest[]; outgoing: FriendRequest[]; blocked: User[] }
export interface Conversation { id: string; peer: User; canSend: boolean; latestSeq: number }
export interface Message { id: string; conversationId: string; seq: number; senderId: string; clientId: string; text: string; createdAt: string }
export interface MessagePage { messages: Message[]; hasMore: boolean }
export interface ErrorBody { error: string; code?: string }
export type SendResult = { ok: true; message: Message } | { ok: false; error: string; code?: string };
export interface ServerEvents {
  'games:changed': () => void;
  'social:changed': () => void;
  'conversations:changed': () => void;
  'presence:changed': (event: { userId: string; online: boolean }) => void;
  'message:new': (message: Message) => void;
  'session:expired': () => void;
}
export interface ClientEvents { 'message:send': (input: z.infer<typeof messageInputSchema>, callback: (result: SendResult) => void) => void }

export interface GameDefinition { id: string; name: string; maxPlayers: number; enabled: boolean; adapter: 'emulatorjs-psx' }
export const gameDefinitions: readonly GameDefinition[] = [
  { id: 'crash-bash', name: 'Crash Bash', maxPlayers: 4, enabled: true, adapter: 'emulatorjs-psx' },
  { id: 'crash-team-racing', name: 'Crash Team Racing', maxPlayers: 4, enabled: true, adapter: 'emulatorjs-psx' },
];
export interface CatalogGame extends GameDefinition { available: boolean }
export interface GamePlayer { user: User; seat: number }
export interface GameRoom { id: string; gameId: string; game: GameDefinition; host: User; players: GamePlayer[]; ready: boolean; createdAt: string }
export interface GameInvitation { id: string; gameId: string; game: GameDefinition; roomId: string; from: User; to: User; expiresAt: string }
export interface GamesState {
  catalog: CatalogGame[]; canHost: boolean; available: boolean; reason: string;
  rooms: GameRoom[]; incoming: GameInvitation[]; outgoing: GameInvitation[];
}
