export enum SocketEvents {
  // Подключение/отключение
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  
  // Аутентификация
  AUTHENTICATE = 'authenticate',
  AUTHENTICATED = 'authenticated',
  
  // Сообщения
  MESSAGE_NEW = 'message:new',
  MESSAGE_CREATED = 'message:created',
  MESSAGE_UPDATED = 'message:updated',
  MESSAGE_DELETED = 'message:deleted',
  
  // Онлайн статусы
  USER_ONLINE = 'user:online',
  USER_OFFLINE = 'user:offline',
  USER_STATUS_CHANGE = 'user:status:change',
  
  // Набор текста
  TYPING_START = 'typing:start',
  TYPING_END = 'typing:end',
  
  // Чат события
  CHAT_UPDATED = 'chat:updated',
  CHAT_READ = 'chat:read',
  
  // Ошибки
  ERROR = 'error',
  UNAUTHORIZED = 'unauthorized',
}

export interface SocketUser {
  userId: string;
  email: string;
  username: string;
  socketId: string;
}

export interface SocketMessage {
  id?: string;
  content: string;
  chatId: string;
  senderId: string;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'SYSTEM';
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface TypingData {
  chatId: string;
  userId: string;
  username: string;
}

export interface UserStatusData {
  userId: string;
  status: 'online' | 'offline';
  lastSeen?: Date;
}

export interface SocketAuth {
  token: string;
}

export interface SocketError {
  code: string;
  message: string;
  details?: any;
}

export interface ExtendedError extends Error {
  data?: any;
  code?: string;
  type?: string;
}

export const SocketErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  CHAT_NOT_FOUND: 'CHAT_NOT_FOUND',
  NOT_PARTICIPANT: 'NOT_PARTICIPANT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;