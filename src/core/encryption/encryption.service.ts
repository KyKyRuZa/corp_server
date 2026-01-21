import CryptoJS from 'crypto-js';

export class EncryptionService {
  private static ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'corporate-messenger-secret-key-2024';

  static generateKey(userId: string, chatId: string): string {
    return CryptoJS.SHA256(`${userId}:${chatId}:${this.ENCRYPTION_KEY}`).toString();
  }

  static encryptMessage(message: string, userId: string, chatId: string): string {
    try {
      const key = this.generateKey(userId, chatId);
      const encrypted = CryptoJS.AES.encrypt(message, key);
      return encrypted.toString();
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Ошибка шифрования сообщения');
    }
  }

  static decryptMessage(encryptedMessage: string, userId: string, chatId: string): string {
    try {
      const key = this.generateKey(userId, chatId);
      const decrypted = CryptoJS.AES.decrypt(encryptedMessage, key);
      return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Ошибка расшифровки сообщения');
    }
  }

  static isEncrypted(text: string): boolean {
    if (!text) return false;
    
    // Проверяем признаки Base64 (AES шифрование в CryptoJS дает Base64)
    const isBase64 = /^[A-Za-z0-9+/=]+$/.test(text);
    const hasCryptoJSPrefix = text.startsWith('U2FsdGVkX1'); // CryptoJS префикс для AES
    
    return isBase64 || hasCryptoJSPrefix;
  }

  static createMessageHash(message: string, userId: string, chatId: string): string {
    const key = this.generateKey(userId, chatId);
    return CryptoJS.HmacSHA256(message, key).toString();
  }

  static verifyMessageIntegrity(
    encryptedMessage: string, 
    hash: string, 
    userId: string, 
    chatId: string
  ): boolean {
    try {
      const decrypted = this.decryptMessage(encryptedMessage, userId, chatId);
      const newHash = this.createMessageHash(decrypted, userId, chatId);
      return newHash === hash;
    } catch {
      return false;
    }
  }

  // Дополнительный метод для демо - генерация тестовых ключей
  static generateDemoKey(): string {
    return CryptoJS.lib.WordArray.random(256 / 8).toString();
  }
}