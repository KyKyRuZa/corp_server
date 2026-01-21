import { FastifyInstance } from 'fastify';
import { MessagesController } from './messages.controller';

export async function messagesRoutes(fastify: FastifyInstance) {
  const messagesController = new MessagesController(fastify);

  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({
        success: false,
        message: 'Требуется аутентификация',
      });
    }
  });

  // Отправка сообщения
  fastify.post(
    '/chats/:chatId/messages',
    {
      schema: {
        description: 'Отправка нового сообщения в чат',
        tags: ['messages'],
        params: {
          type: 'object',
          properties: {
            chatId: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 5000 },
            type: { type: 'string', enum: ['TEXT', 'IMAGE', 'FILE', 'SYSTEM'] },
            metadata: { type: 'object' },
          },
        },
        response: {
          201: {
            description: 'Сообщение успешно отправлено',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  content: { type: 'string' },
                  chatId: { type: 'string' },
                  senderId: { type: 'string' },
                  type: { type: 'string' },
                  metadata: { type: 'object' },
                  readBy: { type: 'array', items: { type: 'string' } },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
                  sender: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      username: { type: 'string' },
                      name: { type: 'string' },
                      avatar: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    messagesController.createMessage.bind(messagesController) // Используем bind для сохранения контекста
  );

  // Получение истории сообщений
  fastify.get(
    '/chats/:chatId/messages',
    {
      schema: {
        description: 'Получение истории сообщений чата с пагинацией',
        tags: ['messages'],
        params: {
          type: 'object',
          properties: {
            chatId: { type: 'string', format: 'uuid' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            cursor: { type: 'string', format: 'uuid' },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
          },
        },
        response: {
          200: {
            description: 'Список сообщений с пагинацией',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    content: { type: 'string' },
                    chatId: { type: 'string' },
                    senderId: { type: 'string' },
                    type: { type: 'string' },
                    metadata: { type: 'object' },
                    readBy: { type: 'array', items: { type: 'string' } },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' },
                    sender: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        username: { type: 'string' },
                        name: { type: 'string' },
                        avatar: { type: 'string' },
                      },
                    },
                  },
                },
              },
              pagination: {
                type: 'object',
                properties: {
                  hasNextPage: { type: 'boolean' },
                  nextCursor: { type: 'string' },
                  total: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    messagesController.getMessages.bind(messagesController)
  );

  // Получение одного сообщения
  fastify.get(
    '/chats/:chatId/messages/:messageId',
    {
      schema: {
        description: 'Получение конкретного сообщения',
        tags: ['messages'],
        params: {
          type: 'object',
          required: ['chatId', 'messageId'],
          properties: {
            chatId: { type: 'string', format: 'uuid' },
            messageId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    messagesController.getMessage.bind(messagesController)
  );

  // Редактирование сообщения
  fastify.put(
    '/chats/:chatId/messages/:messageId',
    {
      schema: {
        description: 'Редактирование сообщения',
        tags: ['messages'],
        params: {
          type: 'object',
          required: ['chatId', 'messageId'],
          properties: {
            chatId: { type: 'string', format: 'uuid' },
            messageId: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 5000 },
            metadata: { type: 'object' },
          },
        },
      },
    },
    messagesController.updateMessage.bind(messagesController)
  );

  // Удаление сообщения
  fastify.delete(
    '/chats/:chatId/messages/:messageId',
    {
      schema: {
        description: 'Удаление сообщения',
        tags: ['messages'],
        params: {
          type: 'object',
          required: ['chatId', 'messageId'],
          properties: {
            chatId: { type: 'string', format: 'uuid' },
            messageId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    messagesController.deleteMessage.bind(messagesController)
  );

  // Пометить сообщение как прочитанное
  fastify.post(
    '/chats/:chatId/messages/:messageId/read',
    {
      schema: {
        description: 'Пометить сообщение как прочитанное',
        tags: ['messages'],
        params: {
          type: 'object',
          required: ['chatId', 'messageId'],
          properties: {
            chatId: { type: 'string', format: 'uuid' },
            messageId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    messagesController.markAsRead.bind(messagesController)
  );
  
  fastify.post('/messages/test-encryption', {
  schema: {
    description: 'Тестирование шифрования сообщений (для демо ТПП)',
    tags: ['messages', 'encryption'],
    body: {
      type: 'object',
      required: ['message', 'chatId'],
      properties: {
        message: { type: 'string' },
        chatId: { type: 'string', format: 'uuid' },
        simulateDifferentUser: { type: 'boolean', default: false },
      },
    },
  },
  handler: messagesController.testEncryptionForDemo.bind(messagesController),
});
}
