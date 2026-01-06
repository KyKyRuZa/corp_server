import prisma from '../../core/database/prisma';
import { 
  CreateChatInput, 
  UpdateChatInput, 
  AddParticipantsInput,
  ChatResponse,
  MessageResponse 
} from './chat.schema';

export class ChatService {
  
  /**
   * Создать новый чат
   */
  async createChat(userId: string, data: CreateChatInput): Promise<ChatResponse> {
    // Для личных чатов проверяем существующий
    if (data.type === 'DIRECT') {
      if (data.userIds.length !== 1) {
        throw new Error('Личный чат может быть только с одним пользователем');
      }
      
      const targetUserId = data.userIds[0];
      if (!targetUserId) {
        throw new Error('Не указан ID пользователя для личного чата');
      }
      
      // Ищем существующий личный чат между пользователями
      const existingChat = await this.findDirectChat(userId, targetUserId);
      if (existingChat) {
        return this.enrichChatResponse(existingChat, userId);
      }
      
      // Создаем новый личный чат
      const chat = await prisma.chat.create({
        data: {
            type: 'DIRECT',
            creator: { connect: { id: userId } },
            participants: {
            create: [
                { user: { connect: { id: userId } } },
                { user: { connect: { id: targetUserId } } }
            ]
            }
        },
        include: this.getChatInclude(),
        });
      
      return this.enrichChatResponse(chat, userId);
    }
    
    // Для групповых чатов
    if (data.type === 'GROUP') {
      if (!data.name) {
        throw new Error('Групповой чат должен иметь название');
      }
      
      const userIds = [...data.userIds];
      if (!userIds.includes(userId)) {
        userIds.push(userId);
      }
      
      const chat = await prisma.chat.create({
        data: {
            type: 'GROUP',
            name: data.name,
            creator: { connect: { id: userId } },
            participants: {
            create: userIds.map(id => ({ 
                user: { connect: { id } }
            }))
            }
        },
        include: this.getChatInclude(),
        });
      
      return this.enrichChatResponse(chat, userId);
    }
    
    throw new Error('Неверный тип чата');
  }
  
  /**
   * Получить список чатов пользователя
   */
  async getUserChats(userId: string, page: number = 1, limit: number = 50): Promise<{
    chats: ChatResponse[];
    total: number;
    pages: number;
  }> {
    const skip = (page - 1) * limit;
    
    // Получаем чаты пользователя с последним сообщением
    const [chats, total] = await Promise.all([
      prisma.chat.findMany({
        where: {
          participants: {
            some: { userId }
          }
        },
        include: {
          ...this.getChatInclude(),
          messages: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: {
              sender: {
                select: {
                  id: true,
                  username: true,
                  name: true,
                  avatar: true
                }
              }
            }
          }
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.chat.count({
        where: {
          participants: {
            some: { userId }
          }
        }
      })
    ]);
    
    const enrichedChats = await Promise.all(
      chats.map(chat => this.enrichChatResponse(chat, userId))
    );
    
    return {
      chats: enrichedChats,
      total,
      pages: Math.ceil(total / limit)
    };
  }
  
  /**
   * Получить информацию о чате
   */
  async getChatById(chatId: string, userId: string): Promise<ChatResponse | null> {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: this.getChatInclude(),
    });
    
    if (!chat) return null;
    
    // Проверяем, является ли пользователь участником чата
    const isParticipant = chat.participants.some(p => p.userId === userId);
    if (!isParticipant) {
      throw new Error('Вы не являетесь участником этого чата');
    }
    
    return this.enrichChatResponse(chat, userId);
  }
  
  /**
   * Обновить информацию о чате
   */
  async updateChat(chatId: string, userId: string, data: UpdateChatInput): Promise<ChatResponse> {
    // Проверяем права (только для групповых чатов)
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: { participants: true }
    });
    
    if (!chat) {
      throw new Error('Чат не найден');
    }
    
    if (chat.type !== 'GROUP') {
      throw new Error('Можно редактировать только групповые чаты');
    }
    
    const isParticipant = chat.participants.some(p => p.userId === userId);
    if (!isParticipant) {
      throw new Error('Вы не являетесь участником этого чата');
    }
    
    // Создаем объект для обновления
    const updateData: { name?: string; updatedAt: Date } = { updatedAt: new Date() };
    
    // Добавляем имя только если оно передано
    if (data.name !== undefined) {
      updateData.name = data.name;
    }
    
    const updatedChat = await prisma.chat.update({
      where: { id: chatId },
      data: updateData,
      include: this.getChatInclude(),
    });
    
    return this.enrichChatResponse(updatedChat, userId);
  }
  
  /**
   * Добавить участников в групповой чат
   */
  async addParticipants(
    chatId: string, 
    userId: string, 
    data: AddParticipantsInput
  ): Promise<ChatResponse> {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: { participants: true }
    });
    
    if (!chat) {
      throw new Error('Чат не найден');
    }
    
    if (chat.type !== 'GROUP') {
      throw new Error('Добавлять участников можно только в групповые чаты');
    }
    
    const isParticipant = chat.participants.some(p => p.userId === userId);
    if (!isParticipant) {
      throw new Error('Вы не являетесь участником этого чата');
    }
    
    // Фильтруем уже добавленных пользователей
    const existingUserIds = chat.participants.map(p => p.userId);
    const newUserIds = data.userIds.filter(id => !existingUserIds.includes(id));
    
    if (newUserIds.length === 0) {
      throw new Error('Все пользователи уже добавлены в чат');
    }
    
    // Добавляем участников
    await prisma.chatParticipant.createMany({
      data: newUserIds.map(userId => ({
        chatId,
        userId
      })),
      skipDuplicates: true
    });
    
    // Обновляем дату изменения чата
    await prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() }
    });
    
    const updatedChat = await this.getChatById(chatId, userId);
    if (!updatedChat) {
      throw new Error('Ошибка при получении обновленного чата');
    }
    
    return updatedChat;
  }
  
  /**
   * Удалить участника из группового чата
   */
  async removeParticipant(
    chatId: string, 
    userId: string, 
    targetUserId: string
  ): Promise<ChatResponse> {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: { participants: true }
    });
    
    if (!chat) {
      throw new Error('Чат не найден');
    }
    
    if (chat.type !== 'GROUP') {
      throw new Error('Удалять участников можно только из групповых чатов');
    }
    
    // Проверяем, является ли пользователь участником
    const isParticipant = chat.participants.some(p => p.userId === userId);
    if (!isParticipant) {
      throw new Error('Вы не являетесь участником этого чата');
    }
    
    // Нельзя удалить себя (для этого есть выход из чата)
    if (userId === targetUserId) {
      throw new Error('Используйте метод выхода из чата для удаления себя');
    }
    
    // Удаляем участника
    await prisma.chatParticipant.delete({
      where: {
        chatId_userId: {
          chatId,
          userId: targetUserId
        }
      }
    });
    
    // Обновляем дату изменения чата
    await prisma.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() }
    });
    
    const updatedChat = await this.getChatById(chatId, userId);
    if (!updatedChat) {
      throw new Error('Ошибка при получении обновленного чата');
    }
    
    return updatedChat;
  }
  
  /**
   * Выйти из чата
   */
  async leaveChat(chatId: string, userId: string): Promise<void> {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: { participants: true }
    });
    
    if (!chat) {
      throw new Error('Чат не найден');
    }
    
    if (chat.type === 'DIRECT') {
      throw new Error('Нельзя выйти из личного чата');
    }
    
    // Удаляем участника
    await prisma.chatParticipant.delete({
      where: {
        chatId_userId: {
          chatId,
          userId
        }
      }
    });
    
    // Если в чате не осталось участников, удаляем чат
    if (chat.participants.length === 1) {
      await prisma.chat.delete({
        where: { id: chatId }
      });
    } else {
      // Обновляем дату изменения чата
      await prisma.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() }
      });
    }
  }
  
  /**
   * Удалить чат
   */
  async deleteChat(chatId: string, userId: string): Promise<void> {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: { participants: true }
    });
    
    if (!chat) {
      throw new Error('Чат не найден');
    }
    
    const isParticipant = chat.participants.some(p => p.userId === userId);
    if (!isParticipant) {
      throw new Error('Вы не являетесь участником этого чата');
    }
    
    // Удаляем чат (каскадно удалятся все связанные записи)
    await prisma.chat.delete({
      where: { id: chatId }
    });
  }
  
  /**
   * Получить сообщения чата
   */
  async getChatMessages(
    chatId: string, 
    userId: string, 
    page: number = 1, 
    limit: number = 50
  ): Promise<{
    messages: MessageResponse[];
    total: number;
    pages: number;
  }> {
    const skip = (page - 1) * limit;
    
    // Проверяем доступ к чату
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: { participants: true }
    });
    
    if (!chat) {
      throw new Error('Чат не найден');
    }
    
    const isParticipant = chat.participants.some(p => p.userId === userId);
    if (!isParticipant) {
      throw new Error('Вы не являетесь участником этого чата');
    }
    
    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { chatId },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.message.count({
        where: { chatId }
      })
    ]);
    
    // Преобразуем сообщения к нужному типу
    const messageResponses: MessageResponse[] = messages.reverse().map(msg => ({
      id: msg.id,
      content: msg.content,
      type: msg.type,
      metadata: msg.metadata,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
      sender: {
        id: msg.sender.id,
        username: msg.sender.username,
        name: msg.sender.name,
        avatar: msg.sender.avatar
      },
      readBy: Array.isArray(msg.readBy) 
        ? (msg.readBy as string[]) 
        : typeof msg.readBy === 'string' 
          ? JSON.parse(msg.readBy) as string[]
          : []
    }));
    
    return {
      messages: messageResponses,
      total,
      pages: Math.ceil(total / limit)
    };
  }
  
  /**
   * Найти личный чат между двумя пользователями
   */
  private async findDirectChat(userId1: string, userId2: string) {
    const chats = await prisma.chat.findMany({
      where: {
        type: 'DIRECT',
        AND: [
          { participants: { some: { userId: userId1 } } },
          { participants: { some: { userId: userId2 } } }
        ]
      },
      include: this.getChatInclude(),
    });
    
    return chats.length > 0 ? chats[0] : null;
  }
  
  private async enrichChatResponse(chat: any, currentUserId: string): Promise<ChatResponse> {
    // Получаем последнее сообщение
    const lastMessage = await prisma.message.findFirst({
      where: { chatId: chat.id },
      orderBy: { createdAt: 'desc' },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            avatar: true
          }
        }
      }
    });
    
    // Получаем количество непрочитанных (пока всегда 0, можно расширить)
    const unreadCount = 0;
    
    // Преобразуем последнее сообщение к нужному типу
    const lastMessageResponse = lastMessage ? {
      id: lastMessage.id,
      content: lastMessage.content,
      type: lastMessage.type,
      metadata: lastMessage.metadata,
      createdAt: lastMessage.createdAt,
      updatedAt: lastMessage.updatedAt,
      sender: {
        id: lastMessage.sender.id,
        username: lastMessage.sender.username,
        name: lastMessage.sender.name,
        avatar: lastMessage.sender.avatar
      },
      readBy: Array.isArray(lastMessage.readBy) 
        ? (lastMessage.readBy as string[]) 
        : typeof lastMessage.readBy === 'string' 
          ? JSON.parse(lastMessage.readBy) as string[]
          : []
    } : null;
    
    return {
      id: chat.id,
      type: chat.type,
      name: chat.name,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      createdById: chat.creator ? chat.creator.id : '',
      participants: chat.participants.map((p: any) => ({
        id: p.id,
        user: {
          id: p.user.id,
          username: p.user.username,
          name: p.user.name,
          avatar: p.user.avatar,
          online: p.user.online
        },
        role: p.role || 'MEMBER',
        joinedAt: p.joinedAt,
        lastSeen: p.lastSeen
      })),
      lastMessage: lastMessageResponse,
      unreadCount
    };
  }

  private getChatInclude() {
    return {
      creator: {
        select: {
          id: true,
          username: true,
          name: true,
          avatar: true
        }
      },
      participants: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
              name: true,
              avatar: true,
              online: true
            }
          }
        }
      }
    };
  }
}