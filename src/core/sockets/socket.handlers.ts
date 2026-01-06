import { Socket } from 'socket.io';
import { SocketEvents, TypingData, SocketError, SocketErrorCodes } from './socket.types';
import prisma from '../../core/database/prisma';

export class SocketHandlers {
  private socket: Socket;
  
  constructor(socket: Socket) {
    this.socket = socket;
    this.setupHandlers();
  }

  private getRedisService() {
    return (this.socket as any).redisService;
  }

//   private getFastify() {
//     return this.socket.fastify;
//   }

  private log(message: string, level: 'info' | 'error' | 'warn' = 'info') {
    if (this.socket.fastify) {
      this.socket.fastify.log[level](message);
    } else {
      console[level](message);
    }
  }

  private setupHandlers() {
    // Основные события
    this.socket.on(SocketEvents.DISCONNECT, this.handleDisconnect.bind(this));
    this.socket.on(SocketEvents.AUTHENTICATE, this.handleAuthenticate.bind(this));
    
    // События чатов
    this.socket.on(SocketEvents.TYPING_START, this.handleTypingStart.bind(this));
    this.socket.on(SocketEvents.TYPING_END, this.handleTypingEnd.bind(this));
    this.socket.on(SocketEvents.CHAT_READ, this.handleChatRead.bind(this));
    
    // Подписки на чаты
    this.socket.on('subscribe:chat', this.handleSubscribeToChat.bind(this));
    this.socket.on('unsubscribe:chat', this.handleUnsubscribeFromChat.bind(this));
    
    // Пинг для поддержания соединения
    this.socket.on('ping', this.handlePing.bind(this));
  }

  private async handleAuthenticate(data: { token: string }) {
    try {
      // Повторная аутентификация, если нужно
      this.socket.emit(SocketEvents.AUTHENTICATED, {
        userId: this.socket.user?.id,
        username: this.socket.user?.username,
      });
    } catch (error) {
      this.emitError(SocketErrorCodes.UNAUTHORIZED, 'Authentication failed');
    }
  }

  private async handleDisconnect(reason: string) {
    this.log(`WebSocket: Пользователь ${this.socket.user?.username} отключен. Причина: ${reason}`);
    
    // Устанавливаем статус оффлайн
    if (this.socket.user) {
      const redisService = this.getRedisService();
      if (redisService) {
        await redisService.setUserOffline(this.socket.user.id);
      }
    }
    
    // Отписываемся от всех комнат
    const rooms = Array.from(this.socket.rooms);
    rooms.forEach(room => {
      if (room !== this.socket.id) {
        this.socket.leave(room);
      }
    });
  }

  private async handleTypingStart(data: TypingData) {
    try {
      if (!this.socket.user) {
        return this.emitError(SocketErrorCodes.UNAUTHORIZED, 'Not authenticated');
      }

      const { chatId } = data;
      
      // Проверяем, является ли пользователь участником чата
      const participant = await prisma.chatParticipant.findUnique({
        where: {
          chatId_userId: {
            chatId,
            userId: this.socket.user.id,
          },
        },
      });

      if (!participant) {
        return this.emitError(SocketErrorCodes.NOT_PARTICIPANT, 'Not a chat participant');
      }

      // Отправляем событие всем участникам чата, кроме отправителя
      this.socket.to(`chat:${chatId}`).emit(SocketEvents.TYPING_START, {
        chatId,
        userId: this.socket.user.id,
        username: this.socket.user.username,
        timestamp: new Date(),
      });
    } catch (error: any) {
      this.log(`Ошибка при обработке typing:start: ${error.message}`, 'error');
      this.emitError(SocketErrorCodes.INTERNAL_ERROR, error.message);
    }
  }

  private async handleTypingEnd(data: TypingData) {
    try {
      const { chatId } = data;
      
      // Отправляем событие всем участников чата, кроме отправителя
      this.socket.to(`chat:${chatId}`).emit(SocketEvents.TYPING_END, {
        chatId,
        userId: this.socket.user?.id,
        timestamp: new Date(),
      });
    } catch (error: any) {
      this.log(`Ошибка при обработке typing:end: ${error.message}`, 'error');
    }
  }

  private async handleChatRead(data: { chatId: string; messageId?: string }) {
    try {
      if (!this.socket.user) return;

      const { chatId, messageId } = data;
      
      // Обновляем lastSeen в БД
      await prisma.chatParticipant.update({
        where: {
          chatId_userId: {
            chatId,
            userId: this.socket.user.id,
          },
        },
        data: {
          lastSeen: new Date(),
        },
      });

      // Если указано сообщение, отмечаем его как прочитанное
      if (messageId) {
        // Здесь можно добавить логику отметки конкретного сообщения
      }
    } catch (error: any) {
      this.log(`Ошибка при обработке chat:read: ${error.message}`, 'error');
    }
  }

  private async handleSubscribeToChat(chatId: string) {
    try {
      if (!this.socket.user) {
        return this.emitError(SocketErrorCodes.UNAUTHORIZED, 'Not authenticated');
      }

      // Проверяем, является ли пользователь участником чата
      const participant = await prisma.chatParticipant.findUnique({
        where: {
          chatId_userId: {
            chatId,
            userId: this.socket.user.id,
          },
        },
      });

      if (!participant) {
        return this.emitError(SocketErrorCodes.NOT_PARTICIPANT, 'Not a chat participant');
      }

      // Подписываемся на комнату чата
      this.socket.join(`chat:${chatId}`);
      this.log(`Пользователь ${this.socket.user.username} подписался на чат ${chatId}`);
      
      this.socket.emit('subscribed:chat', { chatId });
    } catch (error: any) {
      this.log(`Ошибка при подписке на чат: ${error.message}`, 'error');
      this.emitError(SocketErrorCodes.INTERNAL_ERROR, error.message);
    }
  }

  private async handleUnsubscribeFromChat(chatId: string) {
    this.socket.leave(`chat:${chatId}`);
    this.log(`Пользователь ${this.socket.user?.username} отписался от чата ${chatId}`);
  }

  private handlePing(callback: () => void) {
    // Подтверждаем пинг и обновляем онлайн статус
    if (this.socket.user) {
      const redisService = this.getRedisService();
      if (redisService) {
        redisService.extendUserOnline(this.socket.user.id).catch((err: any) => {
          this.log(`Ошибка при обновлении онлайн статуса: ${err.message}`, 'error');
        });
      }
    }
    callback();
  }

  private emitError(code: string, message: string, details?: any) {
    const error: SocketError = { code, message, details };
    this.socket.emit(SocketEvents.ERROR, error);
  }

  // Публичные методы для внешнего использования
  public async joinChatRoom(chatId: string) {
    this.socket.join(`chat:${chatId}`);
  }

  public async leaveChatRoom(chatId: string) {
    this.socket.leave(`chat:${chatId}`);
  }

  public async sendToUser(userId: string, event: string, data: any) {
    const redisService = this.getRedisService();
    if (redisService) {
      const socketId = await redisService.getUserSocketId(userId);
      if (socketId) {
        this.socket.to(socketId).emit(event, data);
      }
    }
  }

  public async broadcastToChat(chatId: string, event: string, data: any) {
    this.socket.to(`chat:${chatId}`).emit(event, data);
  }
}