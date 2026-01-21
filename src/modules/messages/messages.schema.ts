import { z } from 'zod';

export const MessageType = z.enum(['TEXT', 'IMAGE', 'FILE', 'SYSTEM']);

export const createMessageSchema = z.object({
  content: z.string().min(1, 'Сообщение не может быть пустым').max(3000, 'Сообщение слишком длинное'),
  chatId: z.string().uuid('Некорректный ID чата'),
  type: MessageType.default('TEXT'),
  metadata: z.any().optional(),
  messageHash: z.string().optional(),
  isEncrypted: z.boolean().optional(),
});

export const updateMessageSchema = z.object({
  content: z.string().min(1, 'Сообщение не может быть пустым').max(3000, 'Сообщение слишком длинное'),
  metadata: z.any().optional(),
  messageHash: z.string().optional(),
  isEncrypted: z.boolean().optional(),
});

export const getMessagesSchema = z.object({
  chatId: z.string().uuid('Некорректный ID чата'),
  cursor: z.string().uuid().optional(),
  limit: z.number().min(1).max(100).default(50),
});

export const messageParamsSchema = z.object({
  chatId: z.string().uuid('Некорректный ID чата'),
  messageId: z.string().uuid('Некорректный ID сообщения'),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type UpdateMessageInput = z.infer<typeof updateMessageSchema>;
export type GetMessagesInput = z.infer<typeof getMessagesSchema>;
export type MessageParams = z.infer<typeof messageParamsSchema>;

export const messageResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.object({
    id: z.string(),
    content: z.string(),
    chatId: z.string(),
    senderId: z.string(),
    type: z.string(),
    metadata: z.any().nullable(),
    readBy: z.array(z.string()).nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
    sender: z.object({
      id: z.string(),
      username: z.string(),
      name: z.string().nullable(),
      avatar: z.string().nullable(),
    }).optional(),
  }).optional(),
});

export const messagesListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(
    z.object({
      id: z.string(),
      content: z.string(),
      chatId: z.string(),
      senderId: z.string(),
      type: z.string(),
      metadata: z.any().nullable(),
      readBy: z.array(z.string()).nullable(),
      createdAt: z.date(),
      updatedAt: z.date(),
      sender: z.object({
        id: z.string(),
        username: z.string(),
        name: z.string().nullable(),
        avatar: z.string().nullable(),
      }),
    })
  ),
  pagination: z.object({
    hasNextPage: z.boolean(),
    nextCursor: z.string().nullable(),
    total: z.number().optional(),
  }),
});