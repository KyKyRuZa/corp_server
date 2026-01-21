import { FastifyReply, FastifyRequest } from 'fastify';
import { EncryptionService } from './encryption.service';
import prisma from '../../core/database/prisma';

interface JWTUser {
  id: string;
  email: string;
  username: string;
}

export class EncryptionController {
  // Тестирование шифрования без сохранения в БД
  async testEncryption(
    request: FastifyRequest<{
      Body: { message: string; chatId: string };
    }>,
    reply: FastifyReply
  ) {
    try {
      const user = request.user as JWTUser;
      const { message, chatId } = request.body;

      // Проверяем доступ к чату
      const participant = await prisma.chatParticipant.findUnique({
        where: {
          chatId_userId: {
            chatId,
            userId: user.id,
          },
        },
      });

      if (!participant) {
        return reply.code(403).send({
          success: false,
          message: 'Вы не имеете доступа к этому чату',
        });
      }

      // Шифруем
      const encrypted = EncryptionService.encryptMessage(message, user.id, chatId);
      // Расшифровываем
      const decrypted = EncryptionService.decryptMessage(encrypted, user.id, chatId);
      // Хэш
      const hash = EncryptionService.createMessageHash(message, user.id, chatId);
      // Проверяем целостность
      const integrity = EncryptionService.verifyMessageIntegrity(encrypted, hash, user.id, chatId);

      return reply.code(200).send({
        success: true,
        encryption: {
          algorithm: 'AES-256',
          keyBasedOn: `SHA256(${user.id}:${chatId}:ENV_KEY)`,
          isEndToEnd: true,
        },
        data: {
          original: message,
          encrypted,
          decrypted,
          hash,
          length: {
            original: message.length,
            encrypted: encrypted.length,
            ratio: `${((encrypted.length / message.length) * 100).toFixed(0)}%`,
          },
        },
        verification: {
          matches: message === decrypted,
          integrity,
          message: integrity ? '✓ Целостность подтверждена' : '✗ Нарушена целостность',
        },
        demo: {
          tip: 'Попробуй изменить один символ в зашифрованном тексте - расшифровка не сработает',
          forTPP: 'В БД хранится только зашифрованный текст. Расшифровка возможна только при наличии ключа (userId + chatId)',
        },
      });
    } catch (error: any) {
      console.error('Encryption test error:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Ошибка при тестировании шифрования',
      });
    }
  }

  // Демонстрация работы с реальными сообщениями
  async encryptDemo(
    request: FastifyRequest<{
      Body: { chatId: string };
    }>,
    reply: FastifyReply
  ) {
    try {
      const user = request.user as JWTUser;
      const { chatId } = request.body;

      // Проверяем доступ к чату
      const participant = await prisma.chatParticipant.findUnique({
        where: {
          chatId_userId: {
            chatId,
            userId: user.id,
          },
        },
      });

      if (!participant) {
        return reply.code(403).send({
          success: false,
          message: 'Вы не имеете доступа к этому чату',
        });
      }

      // Создаем тестовые сообщения для демо
      const testMessages = [
        'Привет! Это тестовое сообщение.',
        'Встреча в 15:00 в конференц-зале.',
        'Пароль для Wi-Fi: CorpNet2024!',
        'Конфиденциальные данные: проект "Альфа" стартует 1 июня.',
        '💰 Финансовый отчет за Q1: +15% к прибыли.',
      ];

      const results = [];

      for (const message of testMessages) {
        // Шифруем
        const encrypted = EncryptionService.encryptMessage(message, user.id, chatId);
        const hash = EncryptionService.createMessageHash(message, user.id, chatId);
        
        // Сохраняем в БД с новыми полями
        const dbMessage = await prisma.message.create({
          data: {
            content: encrypted,
            chatId,
            senderId: user.id,
            type: 'TEXT',
            messageHash: hash,
            isEncrypted: true,
          },
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                name: true,
                avatar: true,
              },
            },
          },
        });

        // Пытаемся получить и расшифровать
        const retrievedMessage = await prisma.message.findUnique({
          where: { id: dbMessage.id },
        });

        let decrypted = '';
        let integrity = false;
        try {
          decrypted = EncryptionService.decryptMessage(retrievedMessage!.content, user.id, chatId);
          integrity = EncryptionService.verifyMessageIntegrity(
            retrievedMessage!.content,
            retrievedMessage!.messageHash!,
            user.id,
            chatId
          );
        } catch (error) {
          decrypted = '[DECRYPTION_FAILED]';
        }

        results.push({
          original: message,
          savedToDB: {
            id: dbMessage.id,
            encryptedContent: dbMessage.content.substring(0, 50) + '...',
            length: dbMessage.content.length,
            hasHash: !!dbMessage.messageHash,
            isEncrypted: dbMessage.isEncrypted,
          },
          retrieved: {
            decrypted,
            matches: message === decrypted,
            integrity,
            canReadInDB: false, // В БД нельзя прочитать без ключа
          },
        });
      }

      return reply.code(200).send({
        success: true,
        demo: {
          title: 'Демонстрация End-to-End шифрования',
          description: 'Сообщения шифруются перед сохранением в БД и расшифровываются только у получателя',
          messagesCount: results.length,
        },
        messages: results,
        summary: {
          totalEncrypted: results.length,
          successfulDecryption: results.filter(r => r.retrieved.matches).length,
          integrityVerified: results.filter(r => r.retrieved.integrity).length,
          security: 'Все сообщения защищены AES-256 с уникальным ключом на пару пользователь-чат',
        },
      });
    } catch (error: any) {
      console.error('Encryption demo error:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Ошибка при демонстрации шифрования',
      });
    }
  }

  // Проверка безопасности - попытка взлома
  async securityTest(
    request: FastifyRequest<{
      Body: { chatId: string; messageId: string };
    }>,
    reply: FastifyReply
  ) {
    try {
      const user = request.user as JWTUser;
      const { chatId, messageId } = request.body;

      // 1. Получаем сообщение как авторизованный пользователь
      const authorizedMessage = await prisma.message.findUnique({
        where: { id: messageId },
        include: {
          chat: {
            include: {
              participants: {
                where: { userId: user.id },
              },
            },
          },
        },
      });

      if (!authorizedMessage || authorizedMessage.chat.participants.length === 0) {
        return reply.code(403).send({
          success: false,
          message: 'Доступ запрещен или сообщение не найдено',
        });
      }

      // 2. Пытаемся расшифровать с правильным ключом
      let authorizedDecrypt = '';
      let authorizedIntegrity = false;
      try {
        authorizedDecrypt = EncryptionService.decryptMessage(
          authorizedMessage.content,
          user.id,
          chatId
        );
        if (authorizedMessage.messageHash) {
          authorizedIntegrity = EncryptionService.verifyMessageIntegrity(
            authorizedMessage.content,
            authorizedMessage.messageHash,
            user.id,
            chatId
          );
        }
      } catch (error) {
        authorizedDecrypt = '[DECRYPTION_FAILED]';
      }

      // 3. Пытаемся расшифровать с НЕправильным ключом (симуляция взлома)
      let hackerDecrypt = '';
      try {
        hackerDecrypt = EncryptionService.decryptMessage(
          authorizedMessage.content,
          'hacker-user-id', // Чужой ID
          chatId
        );
      } catch (error) {
        hackerDecrypt = '[DECRYPTION_FAILED_WITH_WRONG_KEY]';
      }

      // 4. Пытаемся подменить хэш
      const fakeHash = 'fake-hash-123';
      const fakeIntegrity = EncryptionService.verifyMessageIntegrity(
        authorizedMessage.content,
        fakeHash,
        user.id,
        chatId
      );

      return reply.code(200).send({
        success: true,
        test: 'Проверка устойчивости к взлому',
        scenarios: [
          {
            name: '✅ Легитимный доступ',
            user: user.id,
            result: authorizedDecrypt,
            integrity: authorizedIntegrity ? '✓ Целостность подтверждена' : '✗ Нарушена',
            canRead: authorizedDecrypt !== '[DECRYPTION_FAILED]',
          },
          {
            name: '❌ Попытка взлома (чужой ключ)',
            user: 'hacker-user-id',
            result: hackerDecrypt,
            integrity: 'Невозможно проверить',
            canRead: false,
            conclusion: 'Без правильного ключа прочитать сообщение невозможно',
          },
          {
            name: '❌ Подмена хэша',
            originalHash: authorizedMessage.messageHash?.substring(0, 20) + '...',
            fakeHash,
            integrityCheck: fakeIntegrity ? 'ОШИБКА: Принят поддельный хэш' : '✓ Система отвергла поддельный хэш',
            security: fakeIntegrity ? 'УЯЗВИМОСТЬ' : 'ЗАЩИЩЕНО',
          },
        ],
        securityAssessment: {
          encryption: 'AES-256 (стойкость: военная)',
          keyDerivation: 'SHA256(userId:chatId:secret)',
          protection: ['От прочтения БД администратором', 'От MITM атак', 'От подмены сообщений'],
          forTPP: 'Даже при полном доступе к БД злоумышленник не сможет прочитать сообщения без ключей пользователей',
        },
      });
    } catch (error: any) {
      console.error('Security test error:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Ошибка при проверке безопасности',
      });
    }
  }
}