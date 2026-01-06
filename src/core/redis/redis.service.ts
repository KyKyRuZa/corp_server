import Redis, { RedisOptions } from 'ioredis';

export class RedisService {
  private redis: Redis;
  private subscriber: Redis;
  private publisher: Redis;

  constructor(private fastify?: any) {
    // Создаем базовую конфигурацию без пароля
    const baseConfig: RedisOptions = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10000,
    };

    // Добавляем пароль только если он есть и не пустой
    const password = process.env.REDIS_PASSWORD;
    const finalConfig: RedisOptions = password 
      ? { ...baseConfig, password }
      : baseConfig;

    this.redis = new Redis(finalConfig);
    this.subscriber = new Redis(finalConfig);
    this.publisher = new Redis(finalConfig);

    this.setupEventListeners();
  }

  private setupEventListeners() {
    this.redis.on('connect', () => {
      if (this.fastify) {
        this.fastify.log.info('✅ Redis подключен');
      } else {
        console.log('✅ Redis подключен');
      }
    });

    this.redis.on('error', (error) => {
      if (this.fastify) {
        this.fastify.log.error('❌ Ошибка Redis:', error);
      } else {
        console.error('❌ Ошибка Redis:', error);
      }
    });

    this.redis.on('close', () => {
      if (this.fastify) {
        this.fastify.log.warn('⚠️  Соединение с Redis закрыто');
      } else {
        console.warn('⚠️  Соединение с Redis закрыто');
      }
    });
  }

  // ==================== ОНЛАЙН СТАТУСЫ ====================

  async setUserOnline(userId: string, socketId: string): Promise<void> {
    const key = `user:${userId}:status`;
    const socketKey = `user:${userId}:socket`;
    
    const pipeline = this.redis.pipeline();
    pipeline.set(key, 'online');
    pipeline.set(socketKey, socketId);
    pipeline.expire(key, 300); // 5 минут TTL
    pipeline.expire(socketKey, 300);
    
    await pipeline.exec();
    
    // Публикуем событие об изменении статуса
    await this.publisher.publish('user:status', JSON.stringify({
      userId,
      status: 'online',
    }));
  }

  async setUserOffline(userId: string): Promise<void> {
    const key = `user:${userId}:status`;
    const socketKey = `user:${userId}:socket`;
    
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    pipeline.del(socketKey);
    
    await pipeline.exec();
    
    // Публикуем событие об изменении статуса
    await this.publisher.publish('user:status', JSON.stringify({
      userId,
      status: 'offline',
    }));
  }

  async getUserStatus(userId: string): Promise<'online' | 'offline'> {
    const status = await this.redis.get(`user:${userId}:status`);
    return status === 'online' ? 'online' : 'offline';
  }

  async getUserSocketId(userId: string): Promise<string | null> {
    return this.redis.get(`user:${userId}:socket`);
  }

  async getAllOnlineUsers(): Promise<string[]> {
    const keys = await this.redis.keys('user:*:status');
    const onlineUsers: string[] = [];
    
    for (const key of keys) {
      const status = await this.redis.get(key);
      if (status === 'online') {
        const userId = key.replace('user:', '').replace(':status', '');
        onlineUsers.push(userId);
      }
    }
    
    return onlineUsers;
  }

  async extendUserOnline(userId: string): Promise<void> {
    const key = `user:${userId}:status`;
    const socketKey = `user:${userId}:socket`;
    
    await this.redis.expire(key, 300);
    await this.redis.expire(socketKey, 300);
  }

  // ==================== КЭШИРОВАНИЕ ====================

  async cacheMessages(chatId: string, messages: any[]): Promise<void> {
    const key = `chat:${chatId}:messages`;
    await this.redis.setex(key, 600, JSON.stringify(messages)); // 10 минут TTL
  }

  async getCachedMessages(chatId: string): Promise<any[] | null> {
    const key = `chat:${chatId}:messages`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async invalidateChatCache(chatId: string): Promise<void> {
    const key = `chat:${chatId}:messages`;
    await this.redis.del(key);
  }

  async cacheUserChats(userId: string, chats: any[]): Promise<void> {
    const key = `user:${userId}:chats`;
    await this.redis.setex(key, 300, JSON.stringify(chats)); // 5 минут TTL
  }

  async getCachedUserChats(userId: string): Promise<any[] | null> {
    const key = `user:${userId}:chats`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  // ==================== ПУБЛИКАЦИЯ/ПОДПИСКА ====================

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, msg) => {
      if (ch === channel) {
        callback(msg);
      }
    });
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.publisher.publish(channel, message);
  }

  // ==================== УТИЛИТЫ ====================

  async ping(): Promise<string> {
    return this.redis.ping();
  }

  async getStats(): Promise<any> {
    const info = await this.redis.info();
    const keys = await this.redis.keys('*');
    
    return {
      connected: this.redis.status === 'ready',
      totalKeys: keys.length,
      memory: info.match(/used_memory_human:(\S+)/)?.[1] || 'unknown',
      info: info.split('\r\n').slice(0, 20).join('\n'),
    };
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
    await this.subscriber.quit();
    await this.publisher.quit();
  }
}