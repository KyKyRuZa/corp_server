import { FastifyRequest } from 'fastify';

export const securityHooks = {
  checkSQLInjection: async (request: FastifyRequest): Promise<void> => {
    const sqlInjectionPatterns = [
      /(\b)(SELECT|INSERT|UPDATE|DELETE|DROP|UNION)(\b)/gi,
      /(--|\/\*|\*\/|;)/g,
      /(\b)(EXEC|EXECUTE|DECLARE|CAST|TRUNCATE)(\b)/gi
    ];
    
    const checkValue = (value: any): boolean => {
      if (typeof value === 'string') {
        return sqlInjectionPatterns.some(pattern => pattern.test(value));
      }
      if (typeof value === 'object' && value !== null) {
        return Object.values(value).some(checkValue);
      }
      return false;
    };
    
    const targets = [request.body, request.query, request.params];
    
    for (const target of targets) {
      if (target && checkValue(target)) {
        throw new Error('Potential SQL injection detected');
      }
    }
  }
};