import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export class Database {
  readonly pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url, max: 12, connectionTimeoutMillis: 5000 }); }
  async query<T extends QueryResultRow = QueryResultRow>(sql: string, args: unknown[] = []) { return this.pool.query<T>(sql, args); }
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async migrate() {
    const dir = resolve('apps/server/migrations');
    await this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(87219203)");
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
      for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) {
        const sql = await readFile(resolve(dir, name), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const existing = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
        if (existing.rowCount) {
          if (existing.rows[0].checksum !== checksum) throw new Error(`La migración ${name} fue modificada después de aplicarse.`);
          continue;
        }
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)', [name, checksum]);
      }
    });
  }
  async close() { await this.pool.end(); }
}

export function pair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a]; }
export async function lockPair(client: PoolClient, a: string, b: string) {
  const ids = pair(a, b);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [ids.join(':')]);
  return ids;
}
