import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { authRoutes } from './modules/auth/auth.routes';
import { chatRoutes } from './modules/chat/chat.routes';
import { messagesRoutes } from './modules/messages/messages.routes';
import { encryptionRoutes } from './core/encryption/encryption.routes';

import prisma from './core/database/prisma';
import { SocketService } from './core/sockets/socket.service';
import { securityHooks } from './core/security/hooks';
import { xssProtection } from './core/security/xss';

dotenv.config();

const fastify = Fastify({
  logger: {
    level: 'debug',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        singleLine: true,
        colorize: false,
        messageFormat: '{msg}'
      }
    }
  },
  trustProxy: true
});

const HTTP_PORT = parseInt(process.env.HTTP_PORT || '5000', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '5001', 10);

fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    }
  }
});

fastify.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: '0.1 minute'
});

fastify.register(cors, {
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://ваш-домен.ru']
    : ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
});

fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
  sign: { expiresIn: '15m' }
});

fastify.addHook('onRequest', async (request) => {
  request.requestId = crypto.randomUUID();
  fastify.log.info({
    requestId: request.requestId,
    method: request.method,
    url: request.url,
    ip: request.ip
  }, 'Incoming request');
 
  await securityHooks.checkSQLInjection(request);
});

fastify.addHook('preHandler', async (request, reply) => {
  const publicRoutes = ['/api/auth/login', '/api/auth/register', '/health', '/'];
  
  if (!publicRoutes.includes(request.url)) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Требуется авторизация' });
    }
  }
});

fastify.addHook('preValidation', async (request) => {
  if (request.body) request.body = await xssProtection.sanitize(request.body);
  if (request.query) request.query = await xssProtection.sanitize(request.query);
  if (request.params) request.params = await xssProtection.sanitize(request.params);
});

const httpServer = createServer();
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ['https://ваш-домен.ru']
      : ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
    if (!token) return next(new Error('No token provided'));
    
    const decoded = await fastify.jwt.verify(token.replace('Bearer ', ''));
    socket.data.user = decoded;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

const socketService = new SocketService(fastify);
socketService.initialize(io);

fastify.decorate('socketService', socketService);
fastify.decorate('io', io);

fastify.register(authRoutes, { prefix: '/api' });
fastify.register(chatRoutes, { prefix: '/api' });
fastify.register(messagesRoutes, { prefix: '/api' });
fastify.register(encryptionRoutes, { prefix: '/api' });

fastify.get('/', async () => {
  return {
    message: 'Secure Corporate Messenger API',
    version: '1.2.0',
  };
});

fastify.get('/health', async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const socketStats = socketService.getStats();
    
    return {
      status: 'OK',
      timestamp: new Date().toISOString(),
      security: {
        rateLimiting: 'active',
        xssProtection: 'active',
        sqlInjectionProtection: 'active'
      },
      database: 'connected',
      websocket: socketStats.connected ? 'running' : 'not running',
      connections: socketStats.connections
    };
  } catch {
    return {
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      database: 'disconnected'
    };
  }
});

fastify.get('/security-test', {
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
}, async () => {
  return {
    message: 'Security features are working',
    features: {
      rateLimiting: 'Test this endpoint more than 5 times in a minute',
      xssProtection: 'Try sending <script>alert("xss")</script> in any input'
    }
  };
});

const start = async () => {
  try {
    console.log('🔐 Initializing security...');
    
    await prisma.$connect();
    console.log('✅ PostgreSQL connected');

    await fastify.listen({ port: HTTP_PORT, host: '0.0.0.0' });
    console.log(`✅ HTTP server: http://localhost:${HTTP_PORT}`);

    httpServer.listen(WS_PORT, '0.0.0.0', () => {
      console.log(`⚡ WebSocket server: ws://localhost:${WS_PORT}`);
      console.log(`📊 Health: http://localhost:${HTTP_PORT}/health`);
      console.log(`🔒 Security test: http://localhost:${HTTP_PORT}/security-test`);
    });
    
  } catch (err) {
    console.error('Server error:', err);
    process.exit(1);
  }
};

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  httpServer.close();
  await fastify.close();
  process.exit(0);
});

start();