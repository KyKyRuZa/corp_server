import prisma from '../../core/database/prisma';
import { Prisma } from '@prisma/client';
import {
  CreateMessageInput,
  UpdateMessageInput,
  GetMessagesInput,
} from './messages.schema';
import { RedisService } from '../../core/redis/redis.service';

export class MessagesService {
  private redisService: RedisService;
  private fastify: any;

  constructor(fastify: any) {
    this.fastify = fastify;
    this.redisService = fastify.redisService;
  }

  // Создание нового сообщения с WebSocket уведомлением
  async createMessage(input: CreateMessageInput, senderId: string) {
    // Проверяем, существует ли чат
    const chat = await prisma.chat.findUnique({
      where: { id: input.chatId },
      include: {
        participants: {
          where: { userId: senderId },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                name: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!chat) {
      throw new Error('Чат не найден');
    }

    // Проверяем, является ли пользователь участником чата
    if (chat.participants.length === 0) {
      throw new Error('Вы не являетесь участником этого чата');
    }

    // Создаем сообщение
    const message = await prisma.message.create({
      data: {
        content: input.content,
        chatId: input.chatId,
        senderId: senderId,
        type: input.type,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
          },
        },
        chat: {
          include: {
            participants: {
              include: {
                user: {
                  select: {
                    id: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Обновляем время последнего обновления чата
    await prisma.chat.update({
      where: { id: input.chatId },
      data: { updatedAt: new Date() },
    });

    // Отправляем уведомление через WebSocket
    await this.sendMessageNotification(message, chat);

    return message;
  }

  // Отправка уведомления о новом сообщении через WebSocket
  private async sendMessageNotification(message: any, chat: any) {
    try {
      if (this.fastify.socketService) {
        const messageData = {
          id: message.id,
          content: message.content,
          type: message.type,
          chatId: message.chatId,
          senderId: message.senderId,
          sender: message.sender,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
          metadata: message.metadata,
        };

        // Отправляем всем участникам чата
        await this.fastify.socketService.broadcastToChat(
          message.chatId,
          'message:created',
          {
            message: messageData,
            chat: {
              id: chat.id,
              updatedAt: new Date(),
              lastMessage: message.content,
              lastMessageAt: message.createdAt,
            },
          }
        );

        this.fastify.log.info(`📨 Сообщение ${message.id} отправлено через WebSocket`);
      }
    } catch (error) {
      this.fastify.log.error('❌ Ошибка отправки WebSocket уведомления:', error);
    }
  }

  // Получение истории сообщений с пагинацией
  async getMessages(input: GetMessagesInput, userId: string) {
    const { chatId, cursor, limit = 50 } = input;

    // Проверяем, является ли пользователь участником чата
    const participant = await prisma.chatParticipant.findUnique({
      where: {
        chatId_userId: {
          chatId,
          userId,
        },
      },
    });

    if (!participant) {
      throw new Error('Вы не являетесь участником этого чата');
    }

    // Проверяем кэш Redis
    if (!cursor && this.redisService) {
      const cachedMessages = await this.redisService.getCachedMessages(chatId);
      if (cachedMessages && cachedMessages.length > 0) {
        return {
          messages: cachedMessages,
          pagination: {
            hasNextPage: false,
            nextCursor: null,
            total: cachedMessages.length,
            fromCache: true,
          },
        };
      }
    }

    // Получаем сообщения с пагинацией
    const messages = await prisma.message.findMany({
      where: {
        chatId,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    // Получаем следующее сообщение для курсора
    let nextMessage = null;
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage) {
        nextMessage = await prisma.message.findFirst({
          where: {
            chatId,
            id: { lt: lastMessage.id },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
      }
    }

    // Получаем общее количество сообщений в чате
    const totalMessages = await prisma.message.count({
      where: { chatId },
    });

    const result = {
      messages: messages.reverse(),
      pagination: {
        hasNextPage: !!nextMessage,
        nextCursor: nextMessage?.id || null,
        total: totalMessages,
        fromCache: false,
      },
    };

    // Кэшируем результат, если это первая страница
    if (!cursor && this.redisService) {
      setTimeout(async () => {
        try {
          await this.redisService.cacheMessages(chatId, result.messages);
        } catch (error) {
          this.fastify.log.error('❌ Ошибка кэширования сообщений:', error);
        }
      }, 0);
    }

    return result;
  }

  // Обновление сообщения с WebSocket уведомлением
  async updateMessage(messageId: string, input: UpdateMessageInput, userId: string) {
    // Находим сообщение
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        chat: true,
        sender: true,
      },
    });

    if (!message) {
      throw new Error('Сообщение не найдено');
    }

    // Проверяем, является ли пользователь отправителем сообщения
    if (message.senderId !== userId) {
      throw new Error('Вы можете редактировать только свои сообщения');
    }

    // Проверяем, не прошло ли слишком много времени
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    if (message.createdAt < fifteenMinutesAgo) {
      throw new Error('Редактирование сообщения возможно только в течение 15 минут после отправки');
    }

    // Обновляем сообщение
    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: {
        content: input.content,
        metadata: input.metadata as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
          },
        },
        chat: true,
      },
    });

    // Отправляем уведомление об обновлении через WebSocket
    if (this.fastify.socketService) {
      await this.fastify.socketService.broadcastToChat(
        updatedMessage.chatId,
        'message:updated',
        {
          messageId: updatedMessage.id,
          content: updatedMessage.content,
          updatedAt: updatedMessage.updatedAt,
        }
      );
    }

    return updatedMessage;
  }

  // Удаление сообщения с WebSocket уведомлением
  async deleteMessage(messageId: string, userId: string) {
    // Находим сообщение
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        chat: true,
      },
    });

    if (!message) {
      throw new Error('Сообщение не найдено');
    }

    // Проверяем, является ли пользователь отправителем сообщения
    if (message.senderId !== userId) {
      throw new Error('Вы можете удалять только свои сообщения');
    }

    // Удаляем сообщение
    const deletedMessage = await prisma.message.delete({
      where: { id: messageId },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    // Отправляем уведомление об удалении через WebSocket
    if (this.fastify.socketService) {
      await this.fastify.socketService.broadcastToChat(
        message.chatId,
        'message:deleted',
        {
          messageId: deletedMessage.id,
          chatId: message.chatId,
        }
      );
    }

    return deletedMessage;
  }

  // Пометить сообщение как прочитанное с WebSocket уведомлением
  async markAsRead(messageId: string, userId: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new Error('Сообщение не найдено');
    }

    let readBy: string[] = [];
    
    if (message.readBy && typeof message.readBy === 'object' && Array.isArray(message.readBy)) {
      readBy = message.readBy as string[];
    }

    // Добавляем пользователя в список прочитавших, если его еще нет
    if (!readBy.includes(userId)) {
      readBy.push(userId);
      
      await prisma.message.update({
        where: { id: messageId },
        data: {
          readBy,
        },
      });

      // Отправляем уведомление о прочтении через WebSocket
      if (this.fastify.socketService) {
        await this.fastify.socketService.sendToUser(
          message.senderId,
          'message:read',
          {
            messageId: message.id,
            readBy: userId,
            readAt: new Date(),
          }
        );
      }
    }

    return { success: true };
  }

  async getMessage(messageId: string, userId: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true,
          },
        },
        chat: {
          include: {
            participants: {
              where: { userId },
            },
          },
        },
      },
    });

    if (!message) {
      throw new Error('Сообщение не найдено');
    }

    // Проверяем, является ли пользователь участником чата
    if (message.chat.participants.length === 0) {
      throw new Error('Вы не имеете доступа к этому сообщению');
    }

    return message;
  }

  async handleTyping(chatId: string, userId: string, isTyping: boolean) {
    if (this.fastify.socketService) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          name: true,
        },
      });

      if (user) {
        await this.fastify.socketService.broadcastToChat(
          chatId,
          isTyping ? 'typing:start' : 'typing:end',
          {
            chatId,
            userId: user.id,
            username: user.username,
            name: user.name,
          },
          userId // исключаем отправителя
        );
      }
    }

    return { success: true };
  }
}

// Экспортируем класс, а не экземпляр
export default MessagesService;