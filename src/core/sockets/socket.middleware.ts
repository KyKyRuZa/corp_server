import { Socket } from 'socket.io';

declare module 'socket.io' {
  interface Socket {
    user?: {
      id: string;
      email: string;
      username: string;
    };
    fastify?: any;
  }
}

export class SocketMiddleware {
  static async authenticate(socket: Socket, next: (err?: Error) => void) {
    try {
      const token = socket.handshake.auth.token || 
                   socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        console.warn('❌ WebSocket: Попытка подключения без токена');
        return next(new Error('Authentication token required'));
      }

      const jwt = require('jsonwebtoken');
      const secret = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
      
      const decoded = jwt.verify(token, secret) as {
        id: string;
        email: string;
        username: string;
        iat: number;
        exp: number;
      };

      if (Date.now() >= decoded.exp * 1000) {
        return next(new Error('Token expired'));
      }

      socket.user = {
        id: decoded.id,
        email: decoded.email,
        username: decoded.username,
      };

      next();
    } catch (error: any) {
      console.error('❌ WebSocket: Ошибка аутентификации:', error.message);
      next(new Error('Authentication failed'));
    }
  }

  static async requireAuth(socket: Socket, next: (err?: Error) => void) {
    if (!socket.user) {
      return next(new Error('Authentication required'));
    }
    next();
  }
}