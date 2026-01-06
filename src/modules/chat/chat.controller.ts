import { FastifyReply, FastifyRequest } from 'fastify';
import { ChatService } from './chat.service';
import {
  createChatSchema,
  updateChatSchema,
  addParticipantsSchema,
  removeParticipantSchema,
  getMessagesSchema,
  UpdateChatInput,
  AddParticipantsInput,
  RemoveParticipantInput,
  GetMessagesInput
} from './chat.schema';

export class ChatController {
  constructor(private chatService: ChatService) {}

  async createChat(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request.user as { id: string }).id;

      const body = createChatSchema.parse(request.body);
      
      const chat = await this.chatService.createChat(userId, body);
      
      return reply.code(201).send({
        success: true,
        message: 'Чат успешно создан',
        data: chat
      });
    } catch (error) {
      console.error('Ошибка создания чата:', error);
      
      if (error instanceof Error) {
        return reply.code(400).send({
          success: false,
          error: error.message
        });
      }
      
      return reply.code(400).send({
        success: false,
        error: 'Ошибка создания чата'
      });
    }
  }

  async getUserChats(
    request: FastifyRequest<{ Querystring: { page?: string; limit?: string } }>, 
    reply: FastifyReply
  ) {
    try {
      const userId = (request.user as { id: string }).id;

      const page = request.query.page ? parseInt(request.query.page, 10) : 1;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      
      const result = await this.chatService.getUserChats(userId, page, limit);
      
      return reply.send({
        success: true,
        data: result.chats,
        pagination: {
          page,
          limit,
          total: result.total,
          pages: result.pages
        }
      });
    } catch (error) {
      console.error('Ошибка получения чатов:', error);
      return reply.code(500).send({
        success: false,
        error: 'Ошибка получения чатов'
      });
    }
  }

  async getChat(
    request: FastifyRequest<{ Params: { chatId: string } }>, 
    reply: FastifyReply
  ) {
    try {
      const userId = (request.user as { id: string }).id;

      const { chatId } = request.params;
      
      const chat = await this.chatService.getChatById(chatId, userId);
      
      if (!chat) {
        return reply.code(404).send({
          success: false,
          error: 'Чат не найден'
        });
      }
      
      return reply.send({
        success: true,
        data: chat
      });
    } catch (error) {
      console.error('Ошибка получения чата:', error);
      
      if (error instanceof Error) {
        const statusCode = error.message === 'Вы не являетесь участником этого чата' ? 403 : 500;
        return reply.code(statusCode).send({
          success: false,
          error: error.message
        });
      }
      
      return reply.code(500).send({
        success: false,
        error: 'Ошибка получения чата'
      });
    }
  }

  async updateChat(
    request: FastifyRequest<{ 
      Params: { chatId: string };
      Body: UpdateChatInput;
    }>, 
    reply: FastifyReply
  ) {
    try {
      const userId = (request.user as { id: string }).id;

      const { chatId } = request.params;
      const body = updateChatSchema.parse(request.body);
      
      const chat = await this.chatService.updateChat(chatId, userId, body);
      
      return reply.send({
        success: true,
        message: 'Чат успешно обновлен',
        data: chat
      });
    } catch (error) {
      console.error('Ошибка обновления чата:', error);
      
      if (error instanceof Error) {
        return reply.code(400).send({
          success: false,
          error: error.message
        });
      }
      
      return reply.code(400).send({
        success: false,
        error: 'Ошибка обновления чата'
      });
    }
  }

  async addParticipants(
    request: FastifyRequest<{ 
      Params: { chatId: string };
      Body: AddParticipantsInput;
    }>, 
    reply: FastifyReply
  ) {
    try {
      const userId = (request.user as { id: string }).id;

      const { chatId } = request.params;
      const body = addParticipantsSchema.parse(request.body);
      
      const chat = await this.chatService.addParticipants(chatId, userId, body);
      
      return reply.send({
        success: true,
        message: 'Участники успешно добавлены',
        data: chat
      });
    } catch (error) {
      console.error('Ошибка добавления участников:', error);
      
      if (error instanceof Error) {
        return reply.code(400).send({
          success: false,
          error: error.message
        });
      }
      
      return reply.code(400).send({
        success: false,
        error: 'Ошибка добавления участников'
      });
    }
  }

  async removeParticipant(
    request: FastifyRequest<{ 
      Params: { chatId: string };
      Body: RemoveParticipantInput;
    }>, 
    reply: FastifyReply
  ) {
    try {
      const userId = (request.user as { id: string }).id;

      const { chatId } = request.params;
      const { userId: targetUserId } = removeParticipantSchema.parse(request.body);
      
      const chat = await this.chatService.removeParticipant(chatId, userId, targetUserId);
      
      return reply.send({
        success: true,
        message: 'Участник успешно удален',
        data: chat
      });
    } catch (error) {
      console.error('Ошибка удаления участника:', error);
      
      if (error instanceof Error) {
        return reply.code(400).send({
          success: false,
          error: error.message
        });
      }
      
      return reply.code(400).send({
        success: false,
        error: 'Ошибка удаления участника'
      });
    }
  }

  async leaveChat(
    request: FastifyRequest<{ Params: { chatId: string } }>, 
    reply: FastifyReply
  ) {
    try {
      const userId = (request.user as { id: string }).id;

      const { chatId } = request.params;
      
      await this.chatService.leaveChat(chatId, userId);
      
      return reply.send({
        success: true,
        message: 'Вы успешно вышли из чата'
      });
    } catch (error) {
      console.error('Ошибка выхода из чата:', error);
      
      if (error instanceof Error) {
        return reply.code(400).send({
          success: false,
          error: error.message
        });
      }
      
      return reply.code(400).send({
        success: false,
        error: 'Ошибка выхода из чата'
      });
    }
  }

  async deleteChat(
    request: FastifyRequest<{ Params: { chatId: string } }>, 
    reply: FastifyReply
  ) {
    try {
      const userId = (request.user as { id: string }).id;

      const { chatId } = request.params;
      
      await this.chatService.deleteChat(chatId, userId);
      
      return reply.send({
        success: true,
        message: 'Чат успешно удален'
      });
    } catch (error) {
      console.error('Ошибка удаления чата:', error);
      
      if (error instanceof Error) {
        return reply.code(400).send({
          success: false,
          error: error.message
        });
      }
      
      return reply.code(400).send({
        success: false,
        error: 'Ошибка удаления чата'
      });
    }
  }

  async getChatMessages(
    request: FastifyRequest<{ 
      Params: { chatId: string };
      Querystring: GetMessagesInput;
    }>, 
    reply: FastifyReply
  ) {
    try {
      const userId = (request.user as { id: string }).id;

      const { chatId } = request.params;
      const query = getMessagesSchema.parse(request.query);
      
      const result = await this.chatService.getChatMessages(
        chatId, 
        userId, 
        query.page, 
        query.limit
      );
      
      return reply.send({
        success: true,
        data: result.messages,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: result.total,
          pages: result.pages
        }
      });
    } catch (error) {
      console.error('Ошибка получения сообщений:', error);
      
      if (error instanceof Error) {
        return reply.code(400).send({
          success: false,
          error: error.message
        });
      }
      
      return reply.code(400).send({
        success: false,
        error: 'Ошибка получения сообщений'
      });
    }
  }
}