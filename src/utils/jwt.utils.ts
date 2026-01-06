import { FastifyInstance } from 'fastify';

export interface JwtPayload {
  id: string;
  email: string;
}

export const jwtUtils = {
  async generateToken(fastify: FastifyInstance, payload: JwtPayload): Promise<string> {
    return fastify.jwt.sign(payload);
  },

  async verifyToken(fastify: FastifyInstance, token: string): Promise<JwtPayload> {
    return fastify.jwt.verify(token);
  }
};