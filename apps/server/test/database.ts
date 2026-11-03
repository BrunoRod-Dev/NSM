import pg from 'pg';

export async function prepareTestDatabase(): Promise<string> {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('Definí TEST_DATABASE_URL para una base separada que termine en _test.');
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (!/^[a-z][a-z0-9_]*_test$/.test(name) || url === process.env['DATABASE_URL']) throw new Error('Las pruebas requieren una base exclusiva terminada en _test.');
  parsed.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: parsed.toString(), connectionTimeoutMillis: 5000 });
  try {
    await admin.connect();
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount) {
      try { await admin.query(`CREATE DATABASE "${name}"`); }
      catch (error: any) { if (error.code !== '42P04') throw error; }
    }
  } finally { await admin.end(); }
  return url;
}
