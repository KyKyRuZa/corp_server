import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authController } from './auth.controller';

// Создаем отдельную функцию для аутентификации
async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Не авторизован' });
  }
}

export async function authRoutes(fastify: FastifyInstance) {
  // Регистрация
  fastify.post('/auth/register', authController.register);

  // Вход
  fastify.post('/auth/login', authController.login);

  // Обновление токена
  fastify.post('/auth/refresh', authController.refresh);

  // Выход
  fastify.post('/auth/logout', authController.logout);

  // Профиль (защищенный маршрут)
  fastify.get('/auth/profile', {
    preHandler: [authenticate]
  }, async (request, reply) => {
    reply.send({
      success: true,
      user: request.user
    });
  });
}