import { z } from 'zod';

// ================ ВАЛИДАЦИОННЫЕ СХЕМЫ ================
export const createChatSchema = z.object({
  type: z.enum(['DIRECT', 'GROUP']).default('DIRECT'),
  name: z.string().min(1, 'Название обязательно для групповых чатов').optional(),
  userIds: z.array(z.string().uuid()).min(1, 'Добавьте хотя бы одного участника'),
});

export const updateChatSchema = z.object({
  name: z.string().min(1, 'Название не может быть пустым').optional(),
});

export const addParticipantsSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1, 'Добавьте хотя бы одного участника'),
});

export const removeParticipantSchema = z.object({
  userId: z.string().uuid('Неверный формат ID пользователя'),
});

export const getMessagesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const getChatsSchema = z.object({
  page: z.coerce.number().int().positive().default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
});

export const markAsReadSchema = z.object({
  messageId: z.string().uuid('Неверный формат ID сообщения').optional(),
  untilMessageId: z.string().uuid('Неверный формат ID сообщения').optional(),
});

// ================ ТИПЫ ================
export type CreateChatInput = z.infer<typeof createChatSchema>;
export type UpdateChatInput = z.infer<typeof updateChatSchema>;
export type AddParticipantsInput = z.infer<typeof addParticipantsSchema>;
export type RemoveParticipantInput = z.infer<typeof removeParticipantSchema>;
export type GetMessagesInput = z.infer<typeof getMessagesSchema>;
export type GetChatsInput = z.infer<typeof getChatsSchema>;
export type MarkAsReadInput = z.infer<typeof markAsReadSchema>;

// ================ ИНТЕРФЕЙСЫ ОТВЕТОВ ================
export interface ChatResponse {
  id: string;
  type: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  participants: ParticipantResponse[];
  lastMessage?: MessageResponse | null;
  unreadCount?: number;
}

export interface ParticipantResponse {
  id: string;
  user: {
    id: string;
    username: string;
    name: string | null;
    avatar: string | null;
    online: boolean;
  };
  role: string;
  joinedAt: Date;
  lastSeen: Date | null;
}

export interface MessageResponse {
  id: string;
  content: string;
  type: string;
  metadata: any | null;
  createdAt: Date;
  updatedAt: Date;
  sender: {
    id: string;
    username: string;
    name: string | null;
    avatar: string | null;
  };
  readBy: string[]; // ID пользователей, которые прочитали сообщение
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}