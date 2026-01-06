import { FastifyRequest, FastifyReply } from 'fastify';
import { authService } from './auth.service';
import { registerSchema, loginSchema, refreshTokenSchema } from './auth.schema';

export const authController = {
  async register(request: FastifyRequest, reply: FastifyReply) {
    try {
      const validatedData = registerSchema.parse(request.body);
      const result = await authService.register(request.server, validatedData);
      
      reply.send({
        success: true,
        data: result
      });
    } catch (error) {
      reply.status(400).send({
        success: false,
        error: error instanceof Error ? error.message : 'Ошибка регистрации'
      });
    }
  },

  async login(request: FastifyRequest, reply: FastifyReply) {
    try {
      const validatedData = loginSchema.parse(request.body);
      const result = await authService.login(request.server, validatedData);
      
      reply.send({
        success: true,
        data: result
      });
    } catch (error) {
      reply.status(401).send({
        success: false,
        error: error instanceof Error ? error.message : 'Ошибка входа'
      });
    }
  },

  async refresh(request: FastifyRequest, reply: FastifyReply) {
    try {
      const validatedData = refreshTokenSchema.parse(request.body);
      const result = await authService.refreshToken(request.server, validatedData.refreshToken);
      
      reply.send({
        success: true,
        data: result
      });
    } catch (error) {
      reply.status(401).send({
        success: false,
        error: error instanceof Error ? error.message : 'Ошибка обновления токена'
      });
    }
  },

  async logout(request: FastifyRequest, reply: FastifyReply) {
    try {
      const validatedData = refreshTokenSchema.parse(request.body);
      await authService.logout(validatedData.refreshToken);
      
      reply.send({
        success: true,
        message: 'Успешный выход'
      });
    } catch (error) {
      reply.status(400).send({
        success: false,
        error: 'Ошибка выхода'
      });
    }
  }
};