/* eslint-disable no-console */
import { loadEnv } from '../src/config/env';
import { createPool } from '../src/db/postgres';
import { UserRepository } from '../src/modules/users/user.repository';

/** Creates a few demo users so the APIs can be tried out immediately. */
async function seed(): Promise<void> {
  const env = loadEnv();
  const pool = createPool({ connectionString: env.DATABASE_URL, max: 1, ssl: env.DATABASE_SSL });
  const users = new UserRepository(pool);

  try {
    for (const name of ['Alice', 'Bob', 'Charlie']) {
      const user = await users.create(name);
      console.log(`Created user ${user.name.padEnd(8)} ${user.id}`);
    }
  } finally {
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error('Seeding failed', error);
  process.exitCode = 1;
});
