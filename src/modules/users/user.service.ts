import { NotFoundError } from '../../common/errors';
import type { UserRepository } from './user.repository';
import type { User } from './user.types';

export class UserService {
  constructor(private readonly users: UserRepository) {}

  createUser(name: string): Promise<User> {
    return this.users.create(name);
  }

  async getUser(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError(`User ${id} not found`);
    return user;
  }

  async assertUsersExist(ids: readonly string[]): Promise<void> {
    const missing = await this.users.findMissingIds([...new Set(ids)]);
    if (missing.length > 0) {
      throw new NotFoundError(`User(s) not found: ${missing.join(', ')}`, {
        missingUserIds: missing,
      });
    }
  }
}
