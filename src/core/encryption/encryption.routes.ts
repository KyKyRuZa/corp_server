import { FastifyInstance } from 'fastify';
import { EncryptionController } from './encryption.controller';

export async function encryptionRoutes(fastify: FastifyInstance) {
  const encryptionController = new EncryptionController();

  // Добавляем хук аутентификации для всех роутов
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

  // Тест шифрования
  fastify.post('/encryption/test', {
    schema: {
      description: 'Тестирование шифрования без сохранения в БД',
      tags: ['encryption'],
      body: {
        type: 'object',
        required: ['message', 'chatId'],
        properties: {
          message: { type: 'string', minLength: 1 },
          chatId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            encryption: { type: 'object' },
            data: { type: 'object' },
            verification: { type: 'object' },
            demo: { type: 'object' },
          },
        },
      },
    },
    handler: encryptionController.testEncryption.bind(encryptionController),
  });

  // Демо с сохранением в БД
  fastify.post('/encryption/demo', {
    schema: {
      description: 'Демонстрация работы шифрования с сохранением в БД',
      tags: ['encryption'],
      body: {
        type: 'object',
        required: ['chatId'],
        properties: {
          chatId: { type: 'string', format: 'uuid' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            demo: { type: 'object' },
            messages: { type: 'array' },
            summary: { type: 'object' },
          },
        },
      },
    },
    handler: encryptionController.encryptDemo.bind(encryptionController),
  });

  // Проверка безопасности
  fastify.post('/encryption/security-test', {
    schema: {
      description: 'Проверка устойчивости к взлому',
      tags: ['encryption'],
      body: {
        type: 'object',
        required: ['chatId', 'messageId'],
        properties: {
          chatId: { type: 'string', format: 'uuid' },
          messageId: { type: 'string', format: 'uuid' },
        },
      },
    },
    handler: encryptionController.securityTest.bind(encryptionController),
  });


}