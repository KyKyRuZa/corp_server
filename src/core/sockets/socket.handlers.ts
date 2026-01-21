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
    
    // События сообщений
    this.socket.on(SocketEvents.MESSAGE_NEW, this.handleMessageNew.bind(this));
    
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
  private async handleMessageNew(data: { 
    chatId: string; 
    content: string; 
    type: 'TEXT' | 'IMAGE' | 'FILE';
    metadata?: any;
  }, callback?: (response: any) => void) {
    try {
      if (!this.socket.user) {
        console.error('❌ Не аутентифицирован для отправки сообщения');
        if (callback) {
          callback({ success: false, error: 'Not authenticated' });
        }
        return this.emitError('UNAUTHORIZED', 'Not authenticated');
      }

      console.log('📨 Обработка нового сообщения:', {
        chatId: data.chatId,
        content: data.content,
        senderId: this.socket.user.id,
        senderUsername: this.socket.user.username
      });

      const { chatId, content, type, metadata } = data;
      
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
        console.error(`❌ Пользователь ${this.socket.user.id} не является участником чата ${chatId}`);
        if (callback) {
          callback({ success: false, error: 'Not a chat participant' });
        }
        return this.emitError('NOT_PARTICIPANT', 'Not a chat participant');
      }

      // Получаем базовую информацию о чате для отправки в обновлении
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        select: {
          id: true,
          type: true,
          name: true,
          createdById: true,
          createdAt: true, // ← Добавил
          updatedAt: true,
          participants: {
            select: {
              id: true,
              userId: true,
              role: true,
              joinedAt: true, // ← Добавил
              lastSeen: true, // ← Добавил
              user: {
                select: {
                  id: true,
                  username: true,
                  name: true,
                  avatar: true
                }
              }
            }
          }
        }
      });

      if (!chat) {
        console.error(`❌ Чат с ID ${chatId} не найден`);
        if (callback) {
          callback({ success: false, error: 'Chat not found' });
        }
        return this.emitError('CHAT_NOT_FOUND', 'Chat not found');
      }

      // Создаем сообщение в БД
      const message = await prisma.message.create({
        data: {
          content,
          type,
          metadata: metadata || {},
          chatId,
          senderId: this.socket.user.id,
          readBy: [this.socket.user.id],
        },
        include: {
          sender: true,
        },
      });

      console.log(`✅ Сообщение создано: ${message.id} в чате ${chatId}`);

      // Обновляем время обновления чата
      await prisma.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() }
      });

      // Подготовка данных сообщения для рассылки
      const messageData = {
        id: message.id,
        content: message.content,
        chatId: message.chatId,
        senderId: message.senderId,
        type: message.type,
        metadata: message.metadata,
        readBy: message.readBy,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
        sender: message.sender ? {
          id: message.sender.id,
          username: message.sender.username,
          name: message.sender.name,
          avatar: message.sender.avatar,
          email: message.sender.email,
          online: message.sender.online,
          createdAt: message.sender.createdAt.toISOString(),
          updatedAt: message.sender.updatedAt.toISOString(),
        } : null
      };

      // Подготовка данных чата для рассылки (БЕЗ дополнительных запросов к БД)
      const chatData = {
        id: chat.id,
        type: chat.type,
        name: chat.name,
        createdById: chat.createdById,
        createdAt: chat.createdAt.toISOString(),
        updatedAt: new Date().toISOString(), // Обновляем время
        lastMessage: messageData,
        participants: chat.participants.map(p => ({
          id: p.id,
          chatId: chat.id,
          userId: p.userId,
          role: p.role,
          joinedAt: p.joinedAt.toISOString(),
          lastSeen: p.lastSeen?.toISOString() || null,
          user: p.user ? {
            id: p.user.id,
            username: p.user.username,
            name: p.user.name,
            avatar: p.user.avatar
          } : null
        }))
      };

      // Отправляем подтверждение клиенту
      if (callback) {
        callback({ success: true, messageId: message.id });
      }

      // Отправляем событие обновления чата всем участникам
      console.log(`📤 Рассылка обновления чата для ${chatId}`);
      this.socket.to(`chat:${chatId}`).emit('chat:updated', chatData);
      this.socket.emit('chat:updated', chatData);

      // Отправляем событие сообщения всем участникам чата
      console.log(`📤 Рассылка сообщения в комнату chat:${chatId}`);
      this.socket.to(`chat:${chatId}`).emit('message:created', messageData);
      
      // Также отправляем отправителю
      this.socket.emit('message:created', messageData);
      
    } catch (error: any) {
      console.error('❌ Ошибка при создании сообщения:', error);
      if (callback) {
        callback({ success: false, error: error.message });
      }
      this.emitError('INTERNAL_ERROR', error.message);
    }
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