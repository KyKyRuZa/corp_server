import { PrismaClient } from '@prisma/client';

// Создаем глобальный экземпляр PrismaClient для предотвращения множественных подключений
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'info', 'warn', 'error'] 
    : ['error']
});

// В режиме разработки сохраняем в глобальный объект, чтобы не создавать новые подключения при hot reload
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;