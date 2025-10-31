import { v4 as uuidv4 } from 'uuid';
import { generateChatResponse } from '../config/openai';
import { searchProducts, getPopularProducts } from './vectorSearch';
import {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ConversationHistory,
  ChatbotConfig,
} from '../types/product';
import {
  CHATBOT_SYSTEM_PROMPT,
  PRODUCTS_CONTEXT_PROMPT,
  NO_PRODUCTS_FOUND_MESSAGE,
  WELCOME_MESSAGE,
} from '../utils/prompts';
import {
  validateRelevance,
  sanitizeInput,
  isValidSessionId,
} from '../utils/validation';

/**
 * Конфігурація чат-бота
 */
const CHATBOT_CONFIG: ChatbotConfig = {
  model: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-small',
  temperature: 0.7,
  maxTokens: 1500,
  maxConversationHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY || '6'),
  minProductsRequired: parseInt(process.env.MIN_PRODUCTS_PER_RESPONSE || '3'),
};

/**
 * Сховище історії розмов (в production використовуйте Redis або БД)
 */
const conversationStore = new Map<string, ConversationHistory>();

/**
 * Створення нової сесії
 */
export const createSession = (): string => {
  const sessionId = uuidv4();

  conversationStore.set(sessionId, {
    sessionId,
    messages: [],
    createdAt: new Date(),
    lastUpdatedAt: new Date(),
  });

  console.log(`🆕 Створено нову сесію: ${sessionId}`);
  return sessionId;
};

/**
 * Отримання історії розмови
 */
export const getConversationHistory = (sessionId: string): ChatMessage[] => {
  const conversation = conversationStore.get(sessionId);

  if (!conversation) {
    return [];
  }

  // Повертаємо останні N повідомлень
  const messages = conversation.messages.slice(-CHATBOT_CONFIG.maxConversationHistory);
  return messages;
};

/**
 * Додавання повідомлення в історію
 */
const addMessageToHistory = (
  sessionId: string,
  role: 'user' | 'assistant',
  content: string
): void => {
  let conversation = conversationStore.get(sessionId);

  if (!conversation) {
    conversation = {
      sessionId,
      messages: [],
      createdAt: new Date(),
      lastUpdatedAt: new Date(),
    };
    conversationStore.set(sessionId, conversation);
  }

  conversation.messages.push({ role, content });
  conversation.lastUpdatedAt = new Date();

  // Обмежуємо розмір історії
  if (conversation.messages.length > CHATBOT_CONFIG.maxConversationHistory * 2) {
    conversation.messages = conversation.messages.slice(-CHATBOT_CONFIG.maxConversationHistory * 2);
  }
};

/**
 * Видалення сесії
 */
export const deleteSession = (sessionId: string): boolean => {
  if (!isValidSessionId(sessionId)) {
    return false;
  }

  const deleted = conversationStore.delete(sessionId);

  if (deleted) {
    console.log(`🗑️ Видалено сесію: ${sessionId}`);
  }

  return deleted;
};

/**
 * Очищення старих сесій (запускати періодично)
 */
export const cleanupOldSessions = (maxAgeHours: number = 24): number => {
  const now = new Date();
  let deleted = 0;

  conversationStore.forEach((conversation, sessionId) => {
    const ageHours =
      (now.getTime() - conversation.lastUpdatedAt.getTime()) / (1000 * 60 * 60);

    if (ageHours > maxAgeHours) {
      conversationStore.delete(sessionId);
      deleted++;
    }
  });

  if (deleted > 0) {
    console.log(`🧹 Видалено ${deleted} старих сесій`);
  }

  return deleted;
};

/**
 * Форматування товарів для GPT
 */
const formatProductsForGPT = (products: any[]): string => {
  return products
    .map((product, index) => {
      const meta = product.metadata;
      return `
${index + 1}. ${meta.name}
   - Бренд: ${meta.brand}
   - Ціна: ${meta.price} грн
   - Форма: ${meta.form || 'Не вказано'}
   - Упаковка: ${meta.package || 'Не вказано'}
   - Смак: ${meta.flavor || 'Без смаку'}
   - Вік: ${meta.age || 'Для дорослих'}
   - Опис: ${meta.description || 'Немає опису'}
   - Категорії: ${meta.categories || 'Загальні'}
   - SKU: ${meta.sku}
      `.trim();
    })
    .join('\n\n---\n\n');
};

/**
 * Обробка запиту чат-бота
 */
export const processChatMessage = async (
  request: ChatRequest
): Promise<ChatResponse> => {
  try {
    // Санітизація вводу
    const userMessage = sanitizeInput(request.message);

    if (!userMessage) {
      throw new Error('Повідомлення не може бути порожнім');
    }

    // Створення або валідація sessionId
    let sessionId = request.sessionId;

    if (!sessionId) {
      sessionId = createSession();
    } else if (!isValidSessionId(sessionId)) {
      throw new Error('Невалідний sessionId');
    }

    console.log(`💬 Обробка повідомлення для сесії: ${sessionId}`);
    console.log(`📝 Повідомлення: "${userMessage}"`);

    // Перевірка на вітання (перше повідомлення)
    const history = getConversationHistory(sessionId);
    if (history.length === 0 && isGreeting(userMessage)) {
      addMessageToHistory(sessionId, 'user', userMessage);
      addMessageToHistory(sessionId, 'assistant', WELCOME_MESSAGE);

      return {
        response: WELCOME_MESSAGE,
        sessionId,
        productsFound: 0,
        relevanceCheck: {
          isRelevant: true,
          reason: 'Вітальне повідомлення',
        },
      };
    }

    // Валідація релевантності запиту
    const relevanceCheck = await validateRelevance(userMessage);

    if (!relevanceCheck.isRelevant) {
      console.log(`⚠️ Нерелевантний запит: ${relevanceCheck.reason}`);

      addMessageToHistory(sessionId, 'user', userMessage);
      addMessageToHistory(
        sessionId,
        'assistant',
        relevanceCheck.suggestedResponse || ''
      );

      return {
        response: relevanceCheck.suggestedResponse || '',
        sessionId,
        productsFound: 0,
        relevanceCheck: {
          isRelevant: false,
          reason: relevanceCheck.reason,
        },
      };
    }

    // Пошук товарів
    const searchResult = await searchProducts(userMessage);

    // Якщо товарів недостатньо, додаємо популярні
    let products = searchResult.products;

    if (products.length < CHATBOT_CONFIG.minProductsRequired) {
      console.log(
        `⚠️ Знайдено ${products.length} товарів, додаємо популярні...`
      );
      const popularProducts = await getPopularProducts(5);
      products = [...products, ...popularProducts];

      // Видаляємо дублікати
      const uniqueProducts = products.filter(
        (product, index, self) =>
          index === self.findIndex((p) => p.id === product.id)
      );
      products = uniqueProducts.slice(0, 10);
    }

    // Якщо товарів все ще немає
    if (products.length === 0) {
      console.log('❌ Товари не знайдено');

      addMessageToHistory(sessionId, 'user', userMessage);
      addMessageToHistory(sessionId, 'assistant', NO_PRODUCTS_FOUND_MESSAGE);

      return {
        response: NO_PRODUCTS_FOUND_MESSAGE,
        sessionId,
        productsFound: 0,
        relevanceCheck,
      };
    }

    // Формування контексту для GPT
    const productsJson = formatProductsForGPT(products);
    const productsContext = PRODUCTS_CONTEXT_PROMPT(productsJson);

    // Складання повідомлень для GPT
    const gptMessages: any[] = [
      {
        role: 'system',
        content: CHATBOT_SYSTEM_PROMPT,
      },
      {
        role: 'system',
        content: productsContext,
      },
    ];

    // Додаємо історію розмови
    const conversationHistory = getConversationHistory(sessionId);
    conversationHistory.forEach((msg) => {
      gptMessages.push({
        role: msg.role,
        content: msg.content,
      });
    });

    // Додаємо поточне повідомлення
    gptMessages.push({
      role: 'user',
      content: userMessage,
    });

    // Генерація відповіді
    const assistantResponse = await generateChatResponse(
      gptMessages,
      CHATBOT_CONFIG.temperature,
      CHATBOT_CONFIG.maxTokens
    );

    console.log(`✅ Відповідь згенеровано (${products.length} товарів)`);

    // Зберігаємо в історію
    addMessageToHistory(sessionId, 'user', userMessage);
    addMessageToHistory(sessionId, 'assistant', assistantResponse);

    return {
      response: assistantResponse,
      sessionId,
      productsFound: products.length,
      relevanceCheck,
    };
  } catch (error) {
    console.error('❌ Помилка обробки повідомлення:', error);
    throw error;
  }
};

/**
 * Перевірка чи повідомлення є вітанням
 */
const isGreeting = (message: string): boolean => {
  const greetings = [
    'привіт',
    'вітаю',
    'здрастуйте',
    'добрий день',
    'доброго дня',
    'добридень',
    'hi',
    'hello',
    'hey',
    'привет',
  ];

  const lowerMessage = message.toLowerCase().trim();

  // Якщо повідомлення коротке і містить вітання
  return (
    lowerMessage.length < 50 &&
    greetings.some((greeting) => lowerMessage.includes(greeting))
  );
};

/**
 * Отримання статистики сесій
 */
export const getSessionStats = () => {
  return {
    totalSessions: conversationStore.size,
    sessions: Array.from(conversationStore.values()).map((conv) => ({
      sessionId: conv.sessionId,
      messageCount: conv.messages.length,
      createdAt: conv.createdAt,
      lastUpdatedAt: conv.lastUpdatedAt,
    })),
  };
};

// Періодичне очищення старих сесій (кожні 6 годин)
setInterval(() => {
  cleanupOldSessions(24);
}, 6 * 60 * 60 * 1000);