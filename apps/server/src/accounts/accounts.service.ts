import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { PoolClient } from 'pg';
import type { User } from '../../../../packages/contracts/src/index.js';
import { registerSchema, loginSchema, recoverySchema, displayNameSchema } from '../../../../packages/contracts/src/index.js';
import type { Database } from '../db.js';
import { AppError, unauthorized } from '../errors.js';

export const token = () => randomBytes(32).toString('base64url');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const userFromRow = (r: Record<string, any>): User => ({ id: r.id, username: r.username, displayName: r.display_name });
export interface Identity { user: User; sessionHash: string; expiresAt: Date }

export class AccountsService {
  private dummyHash = argon2.hash(token(), options);
  constructor(private db: Database, private sessionDays: number) {}
  async invitation(hours = 72): Promise<{ code: string; expiresAt: string }> {
    const code = token();
    const expiresAt = new Date(Date.now() + hours * 3600000);
    await this.db.query('INSERT INTO invitations(id,token_hash,expires_at) VALUES ($1,$2,$3)', [randomUUID(), digest(code), expiresAt]);
    return { code, expiresAt: expiresAt.toISOString() };
  }
  private async createSession(client: PoolClient, userId: string) {
    const sessionToken = token();
    await client.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,$3)', [digest(sessionToken), userId, new Date(Date.now() + this.sessionDays * 86400000)]);
    return sessionToken;
  }
  async register(input: unknown) {
    const data = registerSchema.parse(input);
    const passwordHash = await argon2.hash(data.password, options);
    const recoveryCode = token();
    try {
      return await this.db.transaction(async client => {
        const invite = data.invitation ? await client.query('SELECT id FROM invitations WHERE token_hash=$1 AND used_by IS NULL AND expires_at>now() FOR UPDATE', [digest(data.invitation)]) : null;
        if (invite && !invite.rowCount) throw new AppError(400, 'La invitación no es válida, venció o ya fue utilizada.', 'INVALID_INVITATION');
        const id = randomUUID();
        const result = await client.query('INSERT INTO users(id,username,display_name,password_hash,recovery_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *', [id, data.username, data.displayName, passwordHash, digest(recoveryCode)]);
        if (invite) await client.query('UPDATE invitations SET used_by=$1,used_at=now() WHERE id=$2', [id, invite.rows[0].id]);
        return { user: userFromRow(result.rows[0]), sessionToken: await this.createSession(client, id), recoveryCode };
      });
    } catch (error: any) {
      if (error.code === '23505') throw new AppError(409, 'Ese usuario no está disponible.', 'USERNAME_TAKEN');
      throw error;
    }
  }
  async login(input: unknown) {
    const data = loginSchema.parse(input);
    const result = await this.db.query('SELECT * FROM users WHERE username=$1', [data.username]);
    const row = result.rows[0];
    const valid = await argon2.verify(row?.password_hash ?? await this.dummyHash, data.password);
    if (!row || !valid) throw new AppError(401, 'Usuario o contraseña incorrectos.', 'INVALID_CREDENTIALS');
    const sessionToken = await this.db.transaction(async client => {
      const current = (await client.query('SELECT password_hash FROM users WHERE id=$1 FOR SHARE', [row.id])).rows[0];
      if (current?.password_hash !== row.password_hash) throw new AppError(401, 'Usuario o contraseña incorrectos.', 'INVALID_CREDENTIALS');
      return this.createSession(client, row.id);
    });
    return { user: userFromRow(row), sessionToken };
  }
  async recover(input: unknown) {
    const data = recoverySchema.parse(input);
    const passwordHash = await argon2.hash(data.password, options);
    const recoveryCode = token();
    return this.db.transaction(async client => {
      const result = await client.query('SELECT * FROM users WHERE username=$1 FOR UPDATE', [data.username]);
      const row = result.rows[0];
      const actual = Buffer.from(row?.recovery_hash ?? digest('invalid'), 'hex');
      if (!row || !timingSafeEqual(actual, Buffer.from(digest(data.code), 'hex'))) throw new AppError(400, 'Usuario o código de recuperación incorrectos.', 'INVALID_RECOVERY');
      await client.query('UPDATE users SET password_hash=$1,recovery_hash=$2 WHERE id=$3', [passwordHash, digest(recoveryCode), row.id]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [row.id]);
      return { user: userFromRow(row), recoveryCode, sessionToken: await this.createSession(client, row.id) };
    });
  }
  async identity(sessionToken: string | undefined, client?: PoolClient): Promise<Identity> {
    if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) throw unauthorized();
    const sessionHash = digest(sessionToken);
    const query = 'SELECT u.*,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()';
    const result = client ? await client.query(query + ' FOR SHARE OF s', [sessionHash]) : await this.db.query(query, [sessionHash]);
    if (!result.rowCount) throw unauthorized();
    return { user: userFromRow(result.rows[0]), sessionHash, expiresAt: result.rows[0].expires_at };
  }
  async logout(sessionHash: string) { await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [sessionHash]); }
  async rename(id: string, value: unknown): Promise<User> {
    const name = displayNameSchema.parse(value);
    return userFromRow((await this.db.query('UPDATE users SET display_name=$1 WHERE id=$2 RETURNING *', [name, id])).rows[0]);
  }
}
