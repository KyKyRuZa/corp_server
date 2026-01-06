import { Socket } from 'socket.io';

declare module 'socket.io' {
  interface Socket {
    user?: {
      id: string;
      email: string;
      username: string;
    };
    fastify?: any; // Добавим ссылку на fastify для логов
  }
}

export class SocketMiddleware {
  static async authenticate(socket: Socket, next: (err?: Error) => void) {
    try {
      const token = socket.handshake.auth.token || 
                   socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        if (socket.fastify) {
          socket.fastify.log.warn('WebSocket: Попытка подключения без токена');
        } else {
          console.warn('WebSocket: Попытка подключения без токена');
        }
        return next(new Error('Authentication token required'));
      }

      // В Fastify мы используем JWT плагин
      const jwt = require('jsonwebtoken');
      const secret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
      
      const decoded = jwt.verify(token, secret) as {
        id: string;
        email: string;
        username: string;
        iat: number;
        exp: number;
      };

      // Проверяем, не истек ли токен
      if (Date.now() >= decoded.exp * 1000) {
        return next(new Error('Token expired'));
      }

      // Сохраняем пользователя в объекте socket
      socket.user = {
        id: decoded.id,
        email: decoded.email,
        username: decoded.username,
      };

      if (socket.fastify) {
        socket.fastify.log.info(`WebSocket: Пользователь ${socket.user.username} (${socket.user.id}) подключен`);
      } else {
        console.log(`WebSocket: Пользователь ${socket.user.username} (${socket.user.id}) подключен`);
      }
      next();
    } catch (error: any) {
      const errorMessage = error.message || 'Authentication failed';
      if (socket.fastify) {
        socket.fastify.log.error('WebSocket: Ошибка аутентификации:', errorMessage);
      } else {
        console.error('WebSocket: Ошибка аутентификации:', errorMessage);
      }
      next(new Error('Authentication failed'));
    }
  }

  static async requireAuth(socket: Socket, next: (err?: Error) => void) {
    if (!socket.user) {
      return next(new Error('Authentication required'));
    }
    next();
  }

  static async setUserOnline(socket: Socket) {
    if (socket.user) {
      // Redis сервис будет инжектирован позже
      const redisService = (socket as any).redisService;
      if (redisService) {
        await redisService.setUserOnline(socket.user.id, socket.id);
        if (socket.fastify) {
          socket.fastify.log.info(`WebSocket: Пользователь ${socket.user.username} установлен как онлайн`);
        }
      }
    }
  }

  static async setUserOffline(socket: Socket) {
    if (socket.user) {
      const redisService = (socket as any).redisService;
      if (redisService) {
        await redisService.setUserOffline(socket.user.id);
        if (socket.fastify) {
          socket.fastify.log.info(`WebSocket: Пользователь ${socket.user.username} установлен как оффлайн`);
        }
      }
    }
  }
}