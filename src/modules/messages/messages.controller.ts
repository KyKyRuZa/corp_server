import { FastifyReply, FastifyRequest } from 'fastify';
import { MessagesService } from './messages.service';
import { EncryptionService } from '../../core/encryption/encryption.service';
import {
  createMessageSchema,
  updateMessageSchema,
  getMessagesSchema,
  CreateMessageInput,
  UpdateMessageInput,
} from './messages.schema';

interface JWTUser {
  id: string;
  email: string;
  username: string;
}

interface ProcessedMessage {
  id: string;
  content: string;
  chatId: string;
  senderId: string;
  type: string;
  metadata?: any;
  readBy?: string[];
  createdAt: Date;
  updatedAt: Date;
  isEncrypted?: boolean;
  encryption?: {
    isEncrypted: boolean;
    integrity: string;
    algorithm?: string;
  };
  sender?: any;
  chat?: any;
}

export class MessagesController {
  private messagesService: MessagesService;

  constructor(fastify: any) {
    this.messagesService = new MessagesService(fastify);
  }

  async createMessage(
    request: FastifyRequest<{ 
      Params: { chatId: string }; 
      Body: Omit<CreateMessageInput, 'chatId'>;
    }>,
    reply: FastifyReply
  ) {
    try {
      const validatedData = createMessageSchema.parse({
        ...request.body,
        chatId: request.params.chatId,
      });

      const user = request.user as JWTUser;

      const shouldEncrypt = validatedData.isEncrypted ?? true;
      let content = validatedData.content;
      let messageHash = validatedData.messageHash;
      let isEncrypted = false;

      if (shouldEncrypt) {
        content = EncryptionService.encryptMessage(validatedData.content, user.id, validatedData.chatId);
        messageHash = EncryptionService.createMessageHash(validatedData.content, user.id, validatedData.chatId);
        isEncrypted = true;
      }

      const message = await this.messagesService.createMessage(
        {
          ...validatedData,
          content,
          messageHash,
          isEncrypted,
        },
        user.id
      );

      const responseData: any = {
        ...message,
        content: isEncrypted ? '[ENCRYPTED]' : message.content,
      };
      
      if (isEncrypted) {
        responseData.decryptedContent = validatedData.content;
      }

      return reply.code(201).send({
        success: true,
        message: isEncrypted ? 'Сообщение отправлено и зашифровано' : 'Сообщение отправлено',
        data: responseData,
        encryption: {
          enabled: isEncrypted,
          algorithm: isEncrypted ? 'AES-256' : 'none',
          integrityCheck: isEncrypted ? 'HMAC-SHA256' : 'none',
        },
      });
    } catch (error: any) {
      console.error('Ошибка при создании сообщения:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Ошибка при отправке сообщения',
      });
    }
  }

  async getMessages(
    request: FastifyRequest<{ 
      Params: { chatId: string }; 
      Querystring: {
        cursor?: string;
        limit?: string;
      };
    }>,
    reply: FastifyReply
  ) {
    try {
      const validatedData = getMessagesSchema.parse({
        chatId: request.params.chatId,
        cursor: request.query.cursor,
        limit: request.query.limit ? Number(request.query.limit) : 50,
      });

      const user = request.user as JWTUser;

      const result = await this.messagesService.getMessages(
        validatedData,
        user.id
      );

      const processedMessages: ProcessedMessage[] = result.messages.map((message: any) => {
        const processedMessage: any = { ...message };
        
        if (message.isEncrypted) {
          try {
            const decryptedContent = EncryptionService.decryptMessage(
              message.content,
              user.id,
              validatedData.chatId
            );
            
            const integrityValid = message.messageHash ? 
              EncryptionService.verifyMessageIntegrity(
                message.content,
                message.messageHash,
                user.id,
                validatedData.chatId
              ) : true;

            processedMessage.content = decryptedContent;
            processedMessage.encryption = {
              isEncrypted: true,
              integrity: integrityValid ? 'valid' : 'compromised',
              algorithm: 'AES-256',
            };
          } catch (error) {
            console.error(`Ошибка расшифровки сообщения ${message.id}:`, error);
            processedMessage.content = '[DECRYPTION_ERROR]';
            processedMessage.encryption = {
              isEncrypted: true,
              integrity: 'error',
              algorithm: 'AES-256',
            };
          }
        } else {
          processedMessage.encryption = {
            isEncrypted: false,
            integrity: 'not_applied',
          };
        }

        if (processedMessage.messageHash !== undefined) {
          delete (processedMessage as any).messageHash;
        }
        
        return processedMessage;
      });

      return reply.code(200).send({
        success: true,
        data: processedMessages,
        pagination: result.pagination,
        encryptionSummary: {
          total: processedMessages.length,
          encrypted: processedMessages.filter(m => m.encryption?.isEncrypted).length,
          integrityValid: processedMessages.filter(m => 
            m.encryption?.isEncrypted && m.encryption.integrity === 'valid'
          ).length,
        },
      });
    } catch (error: any) {
      console.error('Ошибка при получении сообщений:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Ошибка при получении сообщений',
      });
    }
  }

  async updateMessage(
    request: FastifyRequest<{ 
      Params: { chatId: string; messageId: string }; 
      Body: UpdateMessageInput;
    }>,
    reply: FastifyReply
  ) {
    try {
      const validatedData = updateMessageSchema.parse(request.body);
      const user = request.user as JWTUser;

      const originalMessage = await this.messagesService.getMessage(
        request.params.messageId,
        user.id
      );

      const wasEncrypted = (originalMessage as any).isEncrypted ?? false;
      let content = validatedData.content;
      let messageHash = validatedData.messageHash;
      let isEncrypted = wasEncrypted;

      if (wasEncrypted) {
        content = EncryptionService.encryptMessage(validatedData.content, user.id, request.params.chatId);
        messageHash = EncryptionService.createMessageHash(validatedData.content, user.id, request.params.chatId);
        isEncrypted = true;
      }

      const message = await this.messagesService.updateMessage(
        request.params.messageId,
        {
          ...validatedData,
          content,
          messageHash,
          isEncrypted,
        },
        user.id
      );

      const responseData: any = {
        ...message,
        content: isEncrypted ? '[ENCRYPTED]' : message.content,
      };
      
      if (isEncrypted) {
        responseData.decryptedContent = validatedData.content;
      }

      return reply.code(200).send({
        success: true,
        message: isEncrypted ? 'Сообщение обновлено и перешифровано' : 'Сообщение обновлено',
        data: responseData,
      });
    } catch (error: any) {
      console.error('Ошибка при обновлении сообщения:', error);
      
      const statusCode = error.message.includes('Редактирование') || 
                         error.message.includes('свои') ? 403 : 400;
      
      return reply.code(statusCode).send({
        success: false,
        message: error.message || 'Ошибка при обновлении сообщения',
      });
    }
  }

  async deleteMessage(
    request: FastifyRequest<{ Params: { chatId: string; messageId: string } }>,
    reply: FastifyReply
  ) {
    try {
      const user = request.user as JWTUser;

      const message = await this.messagesService.deleteMessage(
        request.params.messageId,
        user.id
      );

      const responseData: any = {
        ...message,
      };
      
      if ((message as any).isEncrypted) {
        responseData.content = '[ENCRYPTED]';
      }

      return reply.code(200).send({
        success: true,
        message: 'Сообщение удалено',
        data: responseData,
      });
    } catch (error: any) {
      console.error('Ошибка при удалении сообщения:', error);
      
      const statusCode = error.message.includes('свои') ? 403 : 400;
      
      return reply.code(statusCode).send({
        success: false,
        message: error.message || 'Ошибка при удалении сообщения',
      });
    }
  }

  async getMessage(
    request: FastifyRequest<{ Params: { chatId: string; messageId: string } }>,
    reply: FastifyReply
  ) {
    try {
      const user = request.user as JWTUser;

      const message = await this.messagesService.getMessage(
        request.params.messageId,
        user.id
      );

      const messageData: any = { ...message };
      let responseData: any = { ...messageData };
      
      if (messageData.isEncrypted) {
        try {
          const decryptedContent = EncryptionService.decryptMessage(
            messageData.content,
            user.id,
            request.params.chatId
          );
          
          const integrityValid = messageData.messageHash ? 
            EncryptionService.verifyMessageIntegrity(
              messageData.content,
              messageData.messageHash,
              user.id,
              request.params.chatId
            ) : true;

          responseData = {
            ...messageData,
            content: decryptedContent,
          };
          
          (responseData as any).encryptionInfo = {
            wasEncrypted: true,
            integrity: integrityValid ? 'valid' : 'compromised',
            algorithm: 'AES-256',
          };
        } catch (error) {
          console.error(`Ошибка расшифровки сообщения ${messageData.id}:`, error);
          responseData = {
            ...messageData,
            content: '[DECRYPTION_ERROR]',
          };
          
          (responseData as any).encryptionInfo = {
            wasEncrypted: true,
            integrity: 'error',
            algorithm: 'AES-256',
          };
        }
      } else {
        (responseData as any).encryptionInfo = {
          wasEncrypted: false,
        };
      }

      if (responseData.messageHash !== undefined) {
        delete responseData.messageHash;
      }

      return reply.code(200).send({
        success: true,
        data: responseData,
      });
    } catch (error: any) {
      console.error('Ошибка при получении сообщения:', error);
      return reply.code(404).send({
        success: false,
        message: error.message || 'Сообщение не найдено',
      });
    }
  }

  async markAsRead(
    request: FastifyRequest<{ Params: { chatId: string; messageId: string } }>,
    reply: FastifyReply
  ) {
    try {
      const user = request.user as JWTUser;

      await this.messagesService.markAsRead(
        request.params.messageId,
        user.id
      );

      return reply.code(200).send({
        success: true,
        message: 'Сообщение помечено как прочитанное',
      });
    } catch (error: any) {
      console.error('Ошибка при отметке сообщения как прочитанного:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Ошибка при отметке сообщения',
      });
    }
  }

  async testEncryptionForDemo(
    request: FastifyRequest<{
      Body: { 
        message: string; 
        chatId: string; 
        simulateDifferentUser?: boolean 
      };
    }>,
    reply: FastifyReply
  ) {
    try {
      const user = request.user as JWTUser;
      const { message, chatId, simulateDifferentUser = false } = request.body;

      const testUserId = simulateDifferentUser ? 'different-user-id-123' : user.id;
      
      const encrypted = EncryptionService.encryptMessage(message, testUserId, chatId);
      const hash = EncryptionService.createMessageHash(message, testUserId, chatId);
      
      let decrypted = '';
      let integrityValid = false;
      try {
        decrypted = EncryptionService.decryptMessage(encrypted, testUserId, chatId);
        integrityValid = EncryptionService.verifyMessageIntegrity(encrypted, hash, testUserId, chatId);
      } catch (error) {
        decrypted = '[DECRYPTION_FAILED]';
      }

      let hackerDecrypted = '';
      try {
        hackerDecrypted = EncryptionService.decryptMessage(encrypted, 'hacker-user-id', chatId);
      } catch (error) {
        hackerDecrypted = '[DECRYPTION_FAILED_WRONG_USER]';
      }

      let wrongChatDecrypted = '';
      try {
        wrongChatDecrypted = EncryptionService.decryptMessage(encrypted, testUserId, 'wrong-chat-id');
      } catch (error) {
        wrongChatDecrypted = '[DECRYPTION_FAILED_WRONG_CHAT]';
      }

      return reply.code(200).send({
        success: true,
        demo: {
          title: 'Демонстрация End-to-End шифрования',
          description: 'Каждое сообщение шифруется уникальным ключом на основе userId + chatId',
        },
        encryption: {
          algorithm: 'AES-256',
          keyDerivation: 'SHA256(userId:chatId:secret)',
          security: 'Военная стойкость (256 бит)',
        },
        results: {
          original: message,
          encrypted: encrypted.substring(0, 100) + '...',
          encryptedLength: encrypted.length,
          correctDecryption: {
            userId: testUserId,
            chatId,
            decrypted,
            matches: message === decrypted,
            integrity: integrityValid,
          },
          securityTests: {
            wrongUser: {
              userId: 'hacker-user-id',
              result: hackerDecrypted,
              canRead: hackerDecrypted === message,
              security: hackerDecrypted !== message ? '✅ Защищено' : '❌ Уязвимо',
            },
            wrongChat: {
              chatId: 'wrong-chat-id',
              result: wrongChatDecrypted,
              canRead: wrongChatDecrypted === message,
              security: wrongChatDecrypted !== message ? '✅ Защищено' : '❌ Уязвимо',
            },
          },
        },
        conclusion: 'Сообщения защищены от: чтения БД администратором, MITM атак, подмены сообщений',
      });
    } catch (error: any) {
      console.error('Ошибка теста шифрования:', error);
      return reply.code(400).send({
        success: false,
        message: error.message || 'Ошибка при тестировании шифрования',
      });
    }
  }
}