import { Server as SocketIOServer, Socket } from 'socket.io';
import { SocketMiddleware } from './socket.middleware';
import { SocketHandlers } from './socket.handlers';
import { SocketEvents } from './socket.types';
import { RedisService } from '../redis/redis.service';

export class SocketService {
  private io: SocketIOServer;
  private redisService: RedisService;
  private fastify: any;

  constructor(fastify: any, redisService: RedisService) {
    this.fastify = fastify;
    this.redisService = redisService;
    this.io = {} as SocketIOServer; // Временная инициализация
  }

  initialize(io: SocketIOServer) {
    this.io = io;
    this.setupMiddleware();
    this.setupConnectionHandling();

    this.fastify.log.info('✅ WebSocket сервер инициализирован');
    return this.io;
  }

  private setupMiddleware() {
    // Аутентификация при подключении
    this.io.use((socket, next) => {
      socket.fastify = this.fastify;
      (socket as any).redisService = this.redisService;
      SocketMiddleware.authenticate(socket, next);
    });
    
    // Дополнительные middleware
    this.io.use(async (socket, next) => {
      try {
        await SocketMiddleware.setUserOnline(socket);
        next();
      } catch (error: any) {
        next(error);
      }
    });
  }

  private setupConnectionHandling() {
    this.io.on(SocketEvents.CONNECT, (socket: Socket) => {
      this.fastify.log.info(`Новое WebSocket подключение: ${socket.id}`);

      // Создаем обработчики для этого соединения
      new SocketHandlers(socket);

      // Отправляем приветственное сообщение
      if (socket.user) {
        socket.emit(SocketEvents.AUTHENTICATED, {
          userId: socket.user.id,
          username: socket.user.username,
          socketId: socket.id,
        });

        // Подписываем пользователя на его личную комнату
        socket.join(`user:${socket.user.id}`);
        
        // Уведомляем о подключении пользователя
        this.broadcastUserStatus(socket.user.id, 'online');
      }

      // Обработка отключения
      socket.on(SocketEvents.DISCONNECT, async () => {
        if (socket.user) {
          await SocketMiddleware.setUserOffline(socket);
          this.broadcastUserStatus(socket.user.id, 'offline');
        }
        
        this.fastify.log.info(`WebSocket соединение закрыто: ${socket.id}`);
      });

      // Обработка ошибок
      socket.on(SocketEvents.ERROR, (error) => {
        this.fastify.log.error(`WebSocket ошибка (${socket.id}):`, error);
      });
    });
  }

  // ==================== ПУБЛИЧНЫЕ МЕТОДЫ ====================

  async broadcastUserStatus(userId: string, status: 'online' | 'offline') {
    const statusEvent = status === 'online' 
      ? SocketEvents.USER_ONLINE 
      : SocketEvents.USER_OFFLINE;

    // Отправляем всем, кто подписан на статусы пользователя
    this.io.emit(statusEvent, {
      userId,
      status,
      timestamp: new Date(),
    });

    // Также отправляем общее событие изменения статуса
    this.io.emit(SocketEvents.USER_STATUS_CHANGE, {
      userId,
      status,
      timestamp: new Date(),
    });
  }

  async sendToUser(userId: string, event: string, data: any) {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  async sendToSocket(socketId: string, event: string, data: any) {
    this.io.to(socketId).emit(event, data);
  }

  async broadcastToChat(chatId: string, event: string, data: any, excludeSocketId?: string) {
    if (excludeSocketId) {
      this.io.to(`chat:${chatId}`).except(excludeSocketId).emit(event, data);
    } else {
      this.io.to(`chat:${chatId}`).emit(event, data);
    }
  }

  async getOnlineUsers(): Promise<string[]> {
    return this.redisService.getAllOnlineUsers();
  }

  async getUserSocketIds(userId: string): Promise<string[]> {
    const socketId = await this.redisService.getUserSocketId(userId);
    return socketId ? [socketId] : [];
  }

  async isUserOnline(userId: string): Promise<boolean> {
    const status = await this.redisService.getUserStatus(userId);
    return status === 'online';
  }

  // ==================== УТИЛИТЫ ====================

  getStats() {
    if (!this.io || !this.io.sockets) {
      return { connected: false, connections: 0 };
    }

    const sockets = this.io.sockets.sockets;
    return {
      connected: true,
      connections: sockets.size,
      socketIds: Array.from(sockets.keys()),
    };
  }

  disconnectSocket(socketId: string) {
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.disconnect(true);
    }
  }
}