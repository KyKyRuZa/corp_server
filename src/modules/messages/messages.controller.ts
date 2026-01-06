import { FastifyReply, FastifyRequest } from 'fastify';
import { MessagesService } from './messages.service';
import {
  createMessageSchema,
  updateMessageSchema,
  getMessagesSchema,
  CreateMessageInput,
  UpdateMessageInput,
} from './messages.schema';

// Объявляем тип для пользователя из JWT
interface JWTUser {
  id: string;
  email: string;
  username: string;
}

export class MessagesController {
  private messagesService: MessagesService;

  constructor(fastify: any) {
    this.messagesService = new MessagesService(fastify);
  }

  // Отправка сообщения
  async createMessage(
    request: FastifyRequest<{ 
      Params: { chatId: string }; 
      Body: Omit<CreateMessageInput, 'chatId'>;
    }>,
    reply: FastifyReply
  ) {
    try {
      // Валидация входных данных
      const validatedData = createMessageSchema.parse({
        ...request.body,
        chatId: request.params.chatId,
      });

      // Получаем user из JWT
      const user = request.user as JWTUser;

      const message = await this.messagesService.createMessage(
        validatedData,
        user.id
      );

      return reply.code(201).send({
        success: true,
        message: 'Сообщение отправлено',
        data: message,
      });
    } catch (error: any) {
      console.error('Ошибка при создании сообщения:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Ошибка при отправке сообщения',
      });
    }
  }

  // Получение истории сообщений
  async getMessages(
    request: FastifyRequest<{ 
      Params: { chatId: string }; 
      Querystring: {
        cursor?: string;
        limit?: string;
      };
    }>,
    reply: FastifyReply
  ) {
    try {
      const validatedData = getMessagesSchema.parse({
        chatId: request.params.chatId,
        cursor: request.query.cursor,
        limit: request.query.limit ? Number(request.query.limit) : 50,
      });

      // Получаем user из JWT
      const user = request.user as JWTUser;

      const result = await this.messagesService.getMessages(
        validatedData,
        user.id
      );

      return reply.code(200).send({
        success: true,
        data: result.messages,
        pagination: result.pagination,
      });
    } catch (error: any) {
      console.error('Ошибка при получении сообщений:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Ошибка при получении сообщений',
      });
    }
  }

  // Редактирование сообщения
  async updateMessage(
    request: FastifyRequest<{ 
      Params: { chatId: string; messageId: string }; 
      Body: UpdateMessageInput;
    }>,
    reply: FastifyReply
  ) {
    try {
      // Валидация входных данных
      const validatedData = updateMessageSchema.parse(request.body);

      // Получаем user из JWT
      const user = request.user as JWTUser;

      const message = await this.messagesService.updateMessage(
        request.params.messageId,
        validatedData,
        user.id
      );

      return reply.code(200).send({
        success: true,
        message: 'Сообщение обновлено',
        data: message,
      });
    } catch (error: any) {
      console.error('Ошибка при обновлении сообщения:', error);
      
      const statusCode = error.message.includes('Редактирование') || 
                         error.message.includes('свои') ? 403 : 400;
      
      return reply.code(statusCode).send({
        success: false,
        message: error.message || 'Ошибка при обновлении сообщения',
      });
    }
  }

  // Удаление сообщения
  async deleteMessage(
    request: FastifyRequest<{ Params: { chatId: string; messageId: string } }>,
    reply: FastifyReply
  ) {
    try {
      // Получаем user из JWT
      const user = request.user as JWTUser;

      const message = await this.messagesService.deleteMessage(
        request.params.messageId,
        user.id
      );

      return reply.code(200).send({
        success: true,
        message: 'Сообщение удалено',
        data: message,
      });
    } catch (error: any) {
      console.error('Ошибка при удалении сообщения:', error);
      
      const statusCode = error.message.includes('свои') ? 403 : 400;
      
      return reply.code(statusCode).send({
        success: false,
        message: error.message || 'Ошибка при удалении сообщения',
      });
    }
  }

  // Получение одного сообщения
  async getMessage(
    request: FastifyRequest<{ Params: { chatId: string; messageId: string } }>,
    reply: FastifyReply
  ) {
    try {
      // Получаем user из JWT
      const user = request.user as JWTUser;

      const message = await this.messagesService.getMessage(
        request.params.messageId,
        user.id
      );

      return reply.code(200).send({
        success: true,
        data: message,
      });
    } catch (error: any) {
      console.error('Ошибка при получении сообщения:', error);
      return reply.code(404).send({
        success: false,
        message: error.message || 'Сообщение не найдено',
      });
    }
  }

  // Пометить сообщение как прочитанное
  async markAsRead(
    request: FastifyRequest<{ Params: { chatId: string; messageId: string } }>,
    reply: FastifyReply
  ) {
    try {
      // Получаем user из JWT
      const user = request.user as JWTUser;

      await this.messagesService.markAsRead(
        request.params.messageId,
        user.id
      );

      return reply.code(200).send({
        success: true,
        message: 'Сообщение помечено как прочитанное',
      });
    } catch (error: any) {
      console.error('Ошибка при отметке сообщения как прочитанного:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Ошибка при отметке сообщения',
      });
    }
  }
}