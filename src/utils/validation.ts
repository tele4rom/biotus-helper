import { generateChatResponse } from '../config/openai';
import { RELEVANCE_VALIDATION_PROMPT, IRRELEVANT_REQUEST_MESSAGE } from './prompts';
import { RelevanceValidation } from '../types/product';

/**
 * Валідація релевантності запиту користувача
 */
export const validateRelevance = async (userMessage: string): Promise<RelevanceValidation> => {
  try {
    const messages = [
      {
        role: 'system' as const,
        content: RELEVANCE_VALIDATION_PROMPT,
      },
      {
        role: 'user' as const,
        content: userMessage,
      },
    ];

    const response = await generateChatResponse(messages, 0.3, 300);

    // Парсимо JSON відповідь
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('⚠️ Не вдалося розпарсити JSON відповідь валідації');
      return {
        isRelevant: true, // За замовчуванням пропускаємо
        reason: 'Помилка валідації',
      };
    }

    const validation = JSON.parse(jsonMatch[0]);

    return {
      isRelevant: validation.isRelevant ?? true,
      reason: validation.reason || 'Невідомо',
      suggestedResponse: validation.suggestedResponse || IRRELEVANT_REQUEST_MESSAGE,
    };
  } catch (error) {
    console.error('❌ Помилка валідації релевантності:', error);
    // У разі помилки пропускаємо запит
    return {
      isRelevant: true,
      reason: 'Помилка системи валідації',
    };
  }
};

/**
 * Перевірка, чи містить список товарів бренди Biotus або My Nutri Week
 */
export const hasRequiredBrand = (products: any[]): boolean => {
  const requiredBrands = ['biotus', 'my nutri week'];

  return products.some((product) => {
    const brand = product.metadata?.brand?.toLowerCase() || '';
    return requiredBrands.some((requiredBrand) => brand.includes(requiredBrand));
  });
};

/**
 * Фільтрація товарів за доступністю
 */
export const filterAvailableProducts = (products: any[]): any[] => {
  return products.filter((product) => {
    const metadata = product.metadata;
    return (
      metadata &&
      metadata.status === true &&
      metadata.quantity > 0 &&
      metadata.active !== false
    );
  });
};

/**
 * Сортування товарів за релевантністю та брендом
 */
export const sortProductsByRelevance = (products: any[]): any[] => {
  const requiredBrands = ['biotus', 'my nutri week'];

  return products.sort((a, b) => {
    const brandA = a.metadata?.brand?.toLowerCase() || '';
    const brandB = b.metadata?.brand?.toLowerCase() || '';

    const aHasRequired = requiredBrands.some((brand) => brandA.includes(brand));
    const bHasRequired = requiredBrands.some((brand) => brandB.includes(brand));

    // Спочатку товари з потрібними брендами
    if (aHasRequired && !bHasRequired) return -1;
    if (!aHasRequired && bHasRequired) return 1;

    // Потім за score (якщо є)
    return (b.score || 0) - (a.score || 0);
  });
};

/**
 * Валідація конфігурації середовища
 */
export const validateEnvironment = (): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!process.env.PINECONE_API_KEY) {
    errors.push('PINECONE_API_KEY не встановлено');
  }

  if (!process.env.OPENAI_API_KEY) {
    errors.push('OPENAI_API_KEY не встановлено');
  }

  if (!process.env.PINECONE_INDEX_NAME) {
    errors.push('PINECONE_INDEX_NAME не встановлено');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

/**
 * Санітизація користувацького вводу
 */
export const sanitizeInput = (input: string): string => {
  // Видалення зайвих пробілів
  let sanitized = input.trim();

  // Обмеження довжини
  const maxLength = 500;
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  return sanitized;
};

/**
 * Валідація sessionId
 */
export const isValidSessionId = (sessionId: string): boolean => {
  // UUID v4 формат
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(sessionId);
};

/**
 * Форматування ціни
 */
export const formatPrice = (price: number): string => {
  return new Intl.NumberFormat('uk-UA', {
    style: 'currency',
    currency: 'UAH',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(price);
};

/**
 * Форматування товару для відображення
 */
export const formatProductForDisplay = (product: any): string => {
  const metadata = product.metadata;

  return `
Товар: ${metadata.name}
Бренд: ${metadata.brand}
Ціна: ${formatPrice(metadata.price)}
Форма: ${metadata.form || 'Не вказано'}
Опис: ${metadata.description || 'Немає опису'}
SKU: ${metadata.sku}
`.trim();
};