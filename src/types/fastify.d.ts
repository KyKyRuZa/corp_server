import '@fastify/jwt';
import 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      id: string;
      email: string;
      username: string;
    };
    payload: {
      id: string;
      email: string;
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    jwt: {
      sign: (payload: any) => string;
      verify: (token: string) => any;
    };
    authenticate: (request: any, reply: any) => Promise<void>;
  }
  
  interface FastifyRequest {
    user: {
      id: string;
      email: string;
      username: string;
    };
    requestId: string;
  }
}