import xss from 'xss';

export const xssProtection = {
  options: {
    whiteList: {
      a: ['href', 'title', 'target'],
      b: [], i: [], u: [], code: [], pre: [], br: [], p: []
    },
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed']
  },
  
  sanitize: async (data: any): Promise<any> => {
    const sanitizeValue = (value: any): any => {
      if (typeof value === 'string') {
        return xss(value, xssProtection.options);
      }
      if (Array.isArray(value)) {
        return value.map(sanitizeValue);
      }
      if (value && typeof value === 'object') {
        const sanitized: any = {};
        for (const key in value) {
          sanitized[key] = sanitizeValue(value[key]);
        }
        return sanitized;
      }
      return value;
    };
    
    return sanitizeValue(data);
  }
};