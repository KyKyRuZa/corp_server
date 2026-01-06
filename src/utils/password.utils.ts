import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

export const passwordUtils = {
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  },

  async compare(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  isValid(password: string): boolean {
    return password.length >= 6;
  }
};