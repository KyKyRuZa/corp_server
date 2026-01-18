import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { authRoutes } from './modules/auth/auth.routes';
import { chatRoutes } from './modules/chat/chat.routes';
import { messagesRoutes } from './modules/messages/messages.routes';
import prisma from './core/database/prisma';
import { RedisService } from './core/redis/redis.service';

dotenv.config();

const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        colorize: true,
        messageFormat: '{msg}'
      }
    },
    serializers: {
      req: (req) => {
        return {
          method: req.method,
          url: req.url,
          hostname: req.hostname
        }
      }
    }
  }
});

const HTTP_PORT = parseInt(process.env.HTTP_PORT || '5000', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '5001', 10);

// Создаем Redis сервис
const redisService = new RedisService(fastify);

// Создаем отдельный HTTP сервер для Socket.IO
const httpServer = createServer();
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});
console.log(process.env.CORS_ORIGIN)
fastify.decorate('redisService', redisService);

fastify.register(cors, {
    origin: '*',
    credentials: true,
});

fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
});

fastify.register(authRoutes, { prefix: '/api' });
fastify.register(chatRoutes, { prefix: '/api' });
fastify.register(messagesRoutes, { prefix: '/api' });

// ================ МАРШРУТЫ ================
fastify.get('/', async () => {
  return {
    message: 'Corporate Messenger API',
    version: '1.0.0',
    description: 'API для корпоративного мессенджера',
    endpoints: {
      http: `http://localhost:${HTTP_PORT}`,
      websocket: `ws://localhost:${WS_PORT}`,
      health: 'GET /health',
      redisStatus: 'GET /api/redis/status',
      onlineUsers: 'GET /api/users/online',
    }
  };
});

fastify.get('/health', async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    
    let redisStatus = 'not connected';
    try {
      await redisService.ping();
      redisStatus = 'connected';
    } catch {
      redisStatus = 'disconnected';
    }
    
    return {
      status: 'OK',
      timestamp: new Date().toISOString(),
      database: 'connected',
      redis: redisStatus,
      websocket: 'running on separate port',
      httpPort: HTTP_PORT,
      wsPort: WS_PORT
    };
  } catch (error) {
    console.error('❌ Ошибка подключения к БД:', error);
    return {
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: 'Database connection failed'
    };
  }
});

// Настройка WebSocket
setupWebSocket(io, redisService, fastify);

function setupWebSocket(io: SocketIOServer, redisService: RedisService, fastify: any) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || 
                   socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
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

      socket.data.user = {
        id: decoded.id,
        email: decoded.email,
        username: decoded.username,
      };

      // Устанавливаем пользователя онлайн в Redis
      await redisService.setUserOnline(decoded.id, socket.id);
      
      fastify.log.info(`WebSocket: Пользователь ${decoded.username} подключен`);
      next();
    } catch (error: any) {
      fastify.log.error('WebSocket: Ошибка аутентификации:', error.message);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    fastify.log.info(`Новое WebSocket подключение: ${socket.id}`);
    
    const user = socket.data.user;
    if (user) {
      // Отправляем подтверждение аутентификации
      socket.emit('authenticated', {
        userId: user.id,
        username: user.username,
        socketId: socket.id,
      });

      // Подписываем на личную комнату
      socket.join(`user:${user.id}`);
      
      // Уведомляем о подключении
      io.emit('user:online', {
        userId: user.id,
        username: user.username,
        timestamp: new Date(),
      });
    }

    // Ping/Pong для поддержания соединения
    socket.on('ping', (callback) => {
      if (callback && typeof callback === 'function') {
        callback();
      }
    });

    // Подписка на чат
    socket.on('subscribe:chat', async (chatId: string) => {
      if (!user) return;
      
      try {
        // Проверяем, является ли пользователь участником чата
        const participant = await prisma.chatParticipant.findUnique({
          where: {
            chatId_userId: {
              chatId,
              userId: user.id,
            },
          },
        });

        if (participant) {
          socket.join(`chat:${chatId}`);
          socket.emit('subscribed:chat', { chatId });
          fastify.log.info(`Пользователь ${user.username} подписался на чат ${chatId}`);
        }
      } catch (error) {
        fastify.log.error('Ошибка подписки на чат:', error);
      }
    });

    // Отписка от чата
    socket.on('unsubscribe:chat', (chatId: string) => {
      socket.leave(`chat:${chatId}`);
    });

    // Typing indicator
    socket.on('typing:start', (data: { chatId: string }) => {
      if (!user) return;
      
      socket.to(`chat:${data.chatId}`).emit('typing:start', {
        chatId: data.chatId,
        userId: user.id,
        username: user.username,
        timestamp: new Date(),
      });
    });

    socket.on('typing:end', (data: { chatId: string }) => {
      socket.to(`chat:${data.chatId}`).emit('typing:end', {
        chatId: data.chatId,
        userId: user.id,
        timestamp: new Date(),
      });
    });

    // Обработка отключения
    socket.on('disconnect', async () => {
      if (user) {
        await redisService.setUserOffline(user.id);
        
        io.emit('user:offline', {
          userId: user.id,
          username: user.username,
          timestamp: new Date(),
        });
        
        fastify.log.info(`Пользователь ${user.username} отключился`);
      }
    });
  });

  // Регистрируем функции для отправки сообщений через WebSocket
  fastify.decorate('ws', {
    broadcastToChat: async (chatId: string, event: string, data: any, excludeSocketId?: string) => {
      if (excludeSocketId) {
        io.to(`chat:${chatId}`).except(excludeSocketId).emit(event, data);
      } else {
        io.to(`chat:${chatId}`).emit(event, data);
      }
    },
    
    sendToUser: async (userId: string, event: string, data: any) => {
      io.to(`user:${userId}`).emit(event, data);
    },
    
    broadcastToAll: async (event: string, data: any) => {
      io.emit(event, data);
    },
    
    getStats: () => {
      const sockets = io.sockets.sockets;
      return {
        connected: true,
        connections: sockets.size,
        socketIds: Array.from(sockets.keys()),
      };
    }
  });

  fastify.log.info('✅ WebSocket сервер настроен');
}

const start = async () => {
  try {
    console.log('🔌 Проверяем подключение к PostgreSQL...');
    await prisma.$connect();
    console.log('✅ PostgreSQL подключен');

    // Проверяем Redis
    console.log('🔌 Проверяем подключение к Redis...');
    try {
      await redisService.ping();
      console.log('✅ Redis подключен');
    } catch {
      console.warn('⚠️  Redis недоступен, некоторые функции будут ограничены');
    }

    // Запускаем HTTP сервер Fastify
    await fastify.listen({ 
      port: HTTP_PORT, 
      host: '0.0.0.0' 
    });
    console.log(`✅ HTTP сервер запущен на http://localhost:${HTTP_PORT}`);

    // Запускаем WebSocket сервер на отдельном порту
    httpServer.listen(WS_PORT, '0.0.0.0', () => {
      console.log(`⚡ WebSocket сервер запущен на ws://localhost:${WS_PORT}`);
      console.log(`📊 Health check: http://localhost:${HTTP_PORT}/health`);
      console.log(`🔴 Redis status: http://localhost:${HTTP_PORT}/api/redis/status`);
      console.log(`👥 Online users: http://localhost:${HTTP_PORT}/api/users/online`);
    });
    
  } catch (err) {
    console.error('❌ Ошибка запуска сервера:', err);
    process.exit(1);
  }
};

const shutdown = async () => {
  console.log('Завершение работы сервера...');
  try {
    await prisma.$disconnect();
    console.log('✅ Подключение к БД закрыто');
    
    await redisService.disconnect();
    console.log('✅ Redis соединение закрыто');
    
    // Закрываем WebSocket сервер
    httpServer.close(() => {
      console.log('✅ WebSocket сервер остановлен');
    });
    
    await fastify.close();
    console.log('✅ HTTP сервер остановлен');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при завершении работы:', error);
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();