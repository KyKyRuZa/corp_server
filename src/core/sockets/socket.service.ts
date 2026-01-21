import { Server as SocketIOServer, Socket } from 'socket.io';
import { SocketMiddleware } from './socket.middleware';
import { SocketHandlers } from './socket.handlers';
import { SocketEvents, UserStatus } from './socket.types';
export class SocketService {
  private io: SocketIOServer;
  private fastify: any;
  private userStatuses: Map<string, UserStatus> = new Map();
  private socketUserMap: Map<string, string> = new Map(); // socketId -> userId

  constructor(fastify: any) {
    this.fastify = fastify;
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
      SocketMiddleware.authenticate(socket, next);
    });
    
    // Дополнительные middleware
    this.io.use(async (socket, next) => {
      try {
        await this.setUserOnline(socket);
        next();
      } catch (error: any) {
        next(error);
      }
    });
  }

  private async setUserOnline(socket: Socket) {
    if (!socket.user) return;

    const userId = socket.user.id;
    const now = new Date();

    if (!this.userStatuses.has(userId)) {
      this.userStatuses.set(userId, {
        userId,
        status: 'online',
        socketIds: new Set([socket.id]),
        lastSeen: now,
      });
    } else {
      const userStatus = this.userStatuses.get(userId)!;
      userStatus.socketIds.add(socket.id);
      userStatus.status = 'online';
      userStatus.lastSeen = now;
    }

    this.socketUserMap.set(socket.id, userId);
  }

  private async setUserOffline(socket: Socket) {
    if (!socket.user) return;

    const userId = socket.user.id;
    const userStatus = this.userStatuses.get(userId);

    if (userStatus) {
      userStatus.socketIds.delete(socket.id);
      
      // Если нет активных подключений, помечаем как offline
      if (userStatus.socketIds.size === 0) {
        userStatus.status = 'offline';
        userStatus.lastSeen = new Date();
      }
    }

    this.socketUserMap.delete(socket.id);
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
          await this.setUserOffline(socket);
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

    // Обновляем статус в памяти
    if (this.userStatuses.has(userId)) {
      const userStatus = this.userStatuses.get(userId)!;
      userStatus.status = status;
      userStatus.lastSeen = new Date();
    }

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
    const onlineUsers: string[] = [];
    
    for (const [userId, status] of this.userStatuses) {
      if (status.status === 'online' && status.socketIds.size > 0) {
        onlineUsers.push(userId);
      }
    }
    
    return onlineUsers;
  }

  async getUserSocketIds(userId: string): Promise<string[]> {
    const userStatus = this.userStatuses.get(userId);
    if (!userStatus) return [];
    
    return Array.from(userStatus.socketIds);
  }

  async isUserOnline(userId: string): Promise<boolean> {
    const userStatus = this.userStatuses.get(userId);
    return !!(userStatus && userStatus.status === 'online' && userStatus.socketIds.size > 0);
  }

  // ==================== УТИЛИТЫ ====================

  getStats() {
    if (!this.io || !this.io.sockets) {
      return { connected: false, connections: 0 };
    }

    const sockets = this.io.sockets.sockets;
    const onlineUsers = Array.from(this.userStatuses.entries())
      .filter(([_, status]) => status.status === 'online')
      .map(([userId]) => userId);

    return {
      connected: true,
      connections: sockets.size,
      onlineUsers: onlineUsers.length,
      socketIds: Array.from(sockets.keys()),
    };
  }

  disconnectSocket(socketId: string) {
    const socket = this.io.sockets.sockets.get(socketId);
    if (socket) {
      socket.disconnect(true);
    }
  }

  // Метод для очистки старых записей (опционально)
  cleanupOldSessions(maxAgeHours: number = 24) {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - maxAgeHours);

    for (const [userId, status] of this.userStatuses) {
      if (status.status === 'offline' && status.lastSeen < cutoffTime) {
        this.userStatuses.delete(userId);
      }
    }
  }
}