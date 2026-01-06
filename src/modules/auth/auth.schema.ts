import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Некорректный email'),
  username: z.string()
    .min(3, 'Имя пользователя должно быть не менее 3 символов')
    .max(50, 'Имя пользователя должно быть не более 50 символов')
    .regex(/^[a-zA-Z0-9_]+$/, 'Имя пользователя может содержать только буквы, цифры и подчеркивания'),
  password: z.string()
    .min(8, 'Пароль должен быть не менее 6 символов')
    .max(100, 'Пароль слишком длинный'),
  name: z.string().max(100, 'Имя слишком длинное').optional()
});

export const loginSchema = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(1, 'Пароль обязателен')
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string()
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;