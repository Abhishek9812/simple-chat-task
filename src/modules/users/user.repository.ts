import type { Queryable } from '../../db/postgres';
import type { User } from './user.types';

interface UserRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class UserRepository {
  constructor(private readonly db: Queryable) {}

  async create(name: string): Promise<User> {
    const { rows } = await this.db.query<UserRow>(
      'INSERT INTO users (name) VALUES ($1) RETURNING id, name, created_at, updated_at',
      [name],
    );
    return toUser(rows[0]!);
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.db.query<UserRow>(
      'SELECT id, name, created_at, updated_at FROM users WHERE id = $1',
      [id],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  /** Returns the subset of `ids` that do NOT exist. */
  async findMissingIds(ids: readonly string[], db: Queryable = this.db): Promise<string[]> {
    if (ids.length === 0) return [];
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM users WHERE id = ANY($1::uuid[])',
      [ids],
    );
    const found = new Set(rows.map((r) => r.id));
    return ids.filter((id) => !found.has(id));
  }
}
