import { FastifyInstance } from 'fastify';
import { passwordUtils } from '../../utils/password.utils';
import { jwtUtils } from '../../utils/jwt.utils';
import { RegisterInput, LoginInput } from './auth.schema';
import crypto from 'crypto';
import prisma from '../../core/database/prisma'; // Импортируем единое подключение

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export const authService = {
  async register(fastify: FastifyInstance, data: RegisterInput) {
    try {
      // Проверяем, существует ли пользователь
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email: data.email },
            { username: data.username }
          ]
        }
      });

      if (existingUser) {
        throw new Error(existingUser.email === data.email 
          ? 'Email уже используется' 
          : 'Имя пользователя уже занято'
        );
      }

      // Хэшируем пароль
      const passwordHash = await passwordUtils.hash(data.password);

      // Создаем пользователя
      const userData: any = {
        email: data.email,
        username: data.username,
        password: passwordHash,
      };

      if (data.name !== undefined) {
        userData.name = data.name;
      }

      const user = await prisma.user.create({
        data: userData
      });

      console.log(`✅ Пользователь создан: ${user.email} (ID: ${user.id})`);

      // Генерируем токены
      const tokens = await this.generateTokens(fastify, user.id, user.email);

      return {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          createdAt: user.createdAt
        },
        ...tokens
      };
    } catch (error: any) {
      console.error('❌ Ошибка при регистрации:', error.message);
      throw error;
    }
  },

  async login(fastify: FastifyInstance, data: LoginInput) {
    try {
      // Находим пользователя
      const user = await prisma.user.findUnique({
        where: { email: data.email }
      });

      if (!user) {
        throw new Error('Пользователь не найден');
      }

      // Проверяем пароль
      const isValidPassword = await passwordUtils.compare(data.password, user.password);
      if (!isValidPassword) {
        throw new Error('Неверный пароль');
      }

      console.log(`✅ Пользователь вошел: ${user.email}`);

      // Генерируем токены
      const tokens = await this.generateTokens(fastify, user.id, user.email);

      return {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          createdAt: user.createdAt
        },
        ...tokens
      };
    } catch (error: any) {
      console.error('❌ Ошибка при входе:', error.message);
      throw error;
    }
  },

  async refreshToken(fastify: FastifyInstance, refreshToken: string) {
    try {
      // Находим refresh токен в базе
      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true }
      });

      if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
        throw new Error('Невалидный или просроченный токен');
      }

      // Удаляем использованный токен
      await prisma.refreshToken.delete({
        where: { id: tokenRecord.id }
      });

      console.log(`🔄 Токен обновлен для пользователя: ${tokenRecord.user.email}`);

      // Генерируем новые токены
      const tokens = await this.generateTokens(fastify, tokenRecord.userId, tokenRecord.user.email);

      return {
        user: {
          id: tokenRecord.user.id,
          email: tokenRecord.user.email,
          username: tokenRecord.user.username,
          name: tokenRecord.user.name
        },
        ...tokens
      };
    } catch (error: any) {
      console.error('❌ Ошибка обновления токена:', error.message);
      throw error;
    }
  },

  async logout(refreshToken: string) {
    try {
      // Удаляем refresh токен
      const result = await prisma.refreshToken.deleteMany({
        where: { token: refreshToken }
      });

      console.log(`🚪 Выход пользователя, удалено токенов: ${result.count}`);
    } catch (error: any) {
      console.error('❌ Ошибка при выходе:', error.message);
      throw error;
    }
  },

  async generateTokens(fastify: FastifyInstance, userId: string, email: string): Promise<AuthTokens> {
    // Access токен (15 минут)
    const accessToken = await jwtUtils.generateToken(fastify, { id: userId, email });

    // Refresh токен (7 дней)
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 дней

    // Сохраняем refresh токен в базе
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt
      }
    });

    return { accessToken, refreshToken };
  }
};