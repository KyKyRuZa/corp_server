import prisma from '../../core/database/prisma';
import { Prisma } from '@prisma/client';
import {
  CreateMessageInput,
  UpdateMessageInput,
  GetMessagesInput,
} from './messages.schema';

export class MessagesService {
  private fastify: any;

  constructor(fastify: any) {
    this.fastify = fastify;
  }

  async createMessage(input: CreateMessageInput, senderId: string) {
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

    if (chat.participants.length === 0) {
      throw new Error('Вы не являетесь участником этого чата');
    }

    // Подготовка данных с учетом nullable полей
    const messageData: Prisma.MessageCreateInput = {
      content: input.content,
      chat: { connect: { id: input.chatId } },
      sender: { connect: { id: senderId } },
      type: input.type,
      metadata: input.metadata as Prisma.InputJsonValue,
      isEncrypted: input.isEncrypted ?? false,
    };

    // Добавляем messageHash только если оно не undefined
    if (input.messageHash !== undefined) {
      messageData.messageHash = input.messageHash;
    }

    const message = await prisma.message.create({
      data: messageData,
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

    await prisma.chat.update({
      where: { id: input.chatId },
      data: { updatedAt: new Date() },
    });

    await this.sendMessageNotification(message, chat);

    return message;
  }

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
          isEncrypted: message.isEncrypted,
          messageHash: message.messageHash,
        };

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

  async getMessages(input: GetMessagesInput, userId: string) {
    const { chatId, cursor, limit = 50 } = input;

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

    const totalMessages = await prisma.message.count({
      where: { chatId },
    });

    const result = {
      messages: messages.reverse(),
      pagination: {
        hasNextPage: !!nextMessage,
        nextCursor: nextMessage?.id || null,
        total: totalMessages,
      },
    };

    return result;
  }

  async updateMessage(messageId: string, input: UpdateMessageInput, userId: string) {
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

    if (message.senderId !== userId) {
      throw new Error('Вы можете редактировать только свои сообщения');
    }

    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    if (message.createdAt < fifteenMinutesAgo) {
      throw new Error('Редактирование сообщения возможно только в течение 15 минут после отправки');
    }

    // Подготовка данных обновления
    const updateData: Prisma.MessageUpdateInput = {
      content: input.content,
      metadata: input.metadata as Prisma.InputJsonValue,
      updatedAt: new Date(),
    };

    // Добавляем только если не undefined
    if (input.messageHash !== undefined) {
      updateData.messageHash = input.messageHash;
    }
    
    if (input.isEncrypted !== undefined) {
      updateData.isEncrypted = input.isEncrypted;
    }

    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: updateData,
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

    if (this.fastify.socketService) {
      await this.fastify.socketService.broadcastToChat(
        updatedMessage.chatId,
        'message:updated',
        {
          messageId: updatedMessage.id,
          content: updatedMessage.content,
          updatedAt: updatedMessage.updatedAt,
          isEncrypted: updatedMessage.isEncrypted,
        }
      );
    }

    return updatedMessage;
  }

  async deleteMessage(messageId: string, userId: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        chat: true,
      },
    });

    if (!message) {
      throw new Error('Сообщение не найдено');
    }

    if (message.senderId !== userId) {
      throw new Error('Вы можете удалять только свои сообщения');
    }

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

    if (!readBy.includes(userId)) {
      readBy.push(userId);
      
      await prisma.message.update({
        where: { id: messageId },
        data: {
          readBy,
        },
      });

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
          userId
        );
      }
    }

    return { success: true };
  }
}

export default MessagesService;