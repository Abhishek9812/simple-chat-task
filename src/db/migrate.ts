/* eslint-disable no-console */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { loadEnv } from '../config/env';
import { createPool, withTransaction } from './postgres';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

/**
 * Minimal forward-only migration runner. Each `*.sql` file in /migrations is
 * applied once, in lexical order, inside its own transaction and recorded in
 * the `schema_migrations` table.
 */
export async function runMigrations(pool: Pool, log: (msg: string) => void = console.log) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    log(`Applied migration ${file}`);
  }
  log('Migrations are up to date');
}

if (require.main === module) {
  const env = loadEnv();
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    max: 1,
    ssl: env.DATABASE_SSL,
  });
  runMigrations(pool)
    .catch((error: unknown) => {
      console.error('Migration failed', error);
      process.exitCode = 1;
    })
    .finally(() => void pool.end());
}
