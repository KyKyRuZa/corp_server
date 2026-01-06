import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

export async function chatRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {
  const chatService = new ChatService();
  const chatController = new ChatController(chatService);
  
  // Защита маршрутов - проверка JWT
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({
        success: false,
        error: 'Требуется аутентификация'
      });
    }
  });
  
  // Маршруты чатов
  fastify.post('/chats', chatController.createChat.bind(chatController));
  fastify.get('/chats', chatController.getUserChats.bind(chatController));
  
  // Маршруты конкретного чата
  fastify.get('/chats/:chatId', chatController.getChat.bind(chatController));
  fastify.put('/chats/:chatId', chatController.updateChat.bind(chatController));
  fastify.delete('/chats/:chatId', chatController.deleteChat.bind(chatController));
  
  // Управление участниками
  fastify.post('/chats/:chatId/participants', chatController.addParticipants.bind(chatController));
  fastify.delete('/chats/:chatId/participants', chatController.removeParticipant.bind(chatController));
  fastify.post('/chats/:chatId/leave', chatController.leaveChat.bind(chatController));
}