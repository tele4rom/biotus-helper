import { v4 as uuidv4 } from 'uuid';
import { generateChatResponse } from '../config/openai';
import {
  searchProducts,
  getPopularProducts,
  searchByArticle,
  findSimilarProductsByPrice,
  balanceResults,
} from './vectorSearch';
import {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ConversationHistory,
  ChatbotConfig,
} from '../types/product';
import {
  CHATBOT_SYSTEM_PROMPT,
  NO_PRODUCTS_FOUND_MESSAGE,
  WELCOME_MESSAGE,
  createUserPrompt,
  getTemperatureForTask,
} from '../utils/prompts';
import {
  sanitizeInput,
  isValidSessionId,
} from '../utils/validation';

/**
 * Конфігурація чат-бота
 */
const CHATBOT_CONFIG: ChatbotConfig = {
  model: 'gpt-4o-mini',
  embeddingModel: 'text-embedding-3-large', // Обновлено для vitahub-xml
  temperature: 0.7,
  maxTokens: 1500,
  maxConversationHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY || '6'),
  minProductsRequired: parseInt(process.env.MIN_PRODUCTS_PER_RESPONSE || '1'), // Змінено на 1 - краще показати те що є, ніж додавати нерелевантні
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
    shownProductIds: new Set<string>(),
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
      shownProductIds: new Set<string>(),
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
 * Додавання показаних товарів до трекінгу
 */
const trackShownProducts = (sessionId: string, productIds: string[]): void => {
  const conversation = conversationStore.get(sessionId);
  if (conversation) {
    productIds.forEach(id => conversation.shownProductIds.add(id));
  }
};

/**
 * Отримання ID вже показаних товарів
 */
const getShownProductIds = (sessionId: string): Set<string> => {
  const conversation = conversationStore.get(sessionId);
  return conversation?.shownProductIds || new Set<string>();
};

/**
 * Фільтрація товарів, які вже були показані
 */
const filterNewProducts = (products: any[], shownIds: Set<string>): any[] => {
  return products.filter(product => !shownIds.has(product.id));
};

// Функція formatProductsForGPT видалена - замінена на createUserPrompt з prompts.ts

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

    // УНІВЕРСАЛЬНИЙ AI-ПІДХІД: Використовуємо AI для повного розуміння контексту
    // Швидка попередня перевірка: артикули визначаємо без AI
    const articlePattern = /[A-Z]{2,4}-\d{4,6}/i;
    const articleMatch = userMessage.match(articlePattern);

    let intent: UserIntent;
    let relevanceCheck = { isRelevant: true, reason: '' };

    if (articleMatch) {
      // Артикул - обробляємо без AI
      intent = {
        searchType: 'article_search',
        searchQuery: articleMatch[0],
        context: 'Пошук по артикулу',
        needsMultipleComponents: false,
      };
      console.log(`⚡ Швидке визначення: артикул ${articleMatch[0]}`);
    } else {
      // Для всіх інших запитів - використовуємо AI для розуміння контексту
      intent = await analyzeUserIntentWithAI(userMessage, history);
      console.log(`🤖 AI визначила: ${intent.searchType}, Запит: "${intent.searchQuery}"`);

      // Перевіряємо релевантність (AI вже це зробила в analyzeUserIntentWithAI)
      if (!intent.context.includes('релевантн')) {
        relevanceCheck = { isRelevant: true, reason: intent.context };
      } else {
        // Якщо AI визначила що запит нерелевантний
        const responseText = 'Вибачте, я спеціалізуюсь на консультаціях щодо вітамінів, мінералів та біологічно активних добавок. Чим можу допомогти у цій сфері?';

        addMessageToHistory(sessionId, 'user', userMessage);
        addMessageToHistory(sessionId, 'assistant', responseText);

        return {
          response: responseText,
          sessionId,
          productsFound: 0,
          relevanceCheck: {
            isRelevant: false,
            reason: 'Запит не стосується здоров\'я та БАДів',
          },
        };
      }
    }

    let products: any[] = [];

    // Виконуємо пошук в залежності від типу запиту
    switch (intent.searchType) {
      case 'article_search':
        // Пошук за артикулом
        console.log(`🔢 Пошук за артикулом: ${intent.searchQuery}`);
        const articleProduct = await searchByArticle(intent.searchQuery);
        if (articleProduct) {
          products = [articleProduct];
        }
        break;

      case 'find_similar':
        // Пошук аналогів
        console.log(`🔄 Пошук аналогів для: ${intent.searchQuery}`);
        // Спочатку знаходимо оригінальний товар
        const originalSearchResult = await searchProducts(intent.searchQuery, { topK: 1 });
        if (originalSearchResult.products.length > 0) {
          const original = originalSearchResult.products[0];
          // Використовуємо нову функцію з фільтром по ціні ±30%
          const similarProducts = await findSimilarProductsByPrice(original.metadata, 5);
          products = similarProducts;
        }
        break;

      case 'recommendation':
        // Звичайний пошук товарів (AI вже сформувала запит з урахуванням контексту)
        console.log(`🔍 Пошук товарів: "${intent.searchQuery}"`);
        const limit = intent.needsMultipleComponents ? 9 : 6;
        const searchResult = await searchProducts(intent.searchQuery, { topK: limit });
        products = searchResult.products;

        // Застосовуємо балансування брендів
        if (products.length > 3) {
          products = balanceResults(products, limit);
        }
        break;
    }

    // Отримуємо ID вже показаних товарів
    const shownProductIds = getShownProductIds(sessionId);

    // Фільтруємо товари, виключаючи вже показані (якщо це не пошук по артикулу)
    const isArticleSearch = intent.searchType === 'article_search';
    if (!isArticleSearch) {
      products = filterNewProducts(products, shownProductIds);
      console.log(`🔍 Знайдено товарів, з них нових: ${products.length}`);
    }

    // Якщо товарів недостатньо, додаємо популярні (НЕ для пошуку по артикулу та НЕ для аналогів!)
    const isSimilarSearch = intent.searchType === 'find_similar';
    if (products.length < CHATBOT_CONFIG.minProductsRequired && !isArticleSearch && !isSimilarSearch) {
      console.log(
        `⚠️ Знайдено ${products.length} нових товарів, додаємо популярні...`
      );
      const popularProducts = await getPopularProducts(10);
      const newPopularProducts = filterNewProducts(popularProducts, shownProductIds);
      products = [...products, ...newPopularProducts];

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

    // НОВА ЛОГІКА: Використовуємо createUserPrompt для динамічного формування промпта
    // Формуємо промпт з результатами пошуку та історією (history вже оголошена вище)
    const userPrompt = createUserPrompt(
      userMessage,
      products,
      history
    );

    // Визначаємо temperature в залежності від типу запиту
    const temperature = getTemperatureForTask(intent.searchType);

    console.log(`📝 Тип запиту: ${intent.searchType}, Temperature: ${temperature}`);

    // Генерація відповіді через GPT
    const assistantResponse = await generateChatResponse(
      [
        {
          role: 'system',
          content: CHATBOT_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      temperature,
      CHATBOT_CONFIG.maxTokens
    );

    console.log(`✅ Відповідь згенеровано (${products.length} товарів)`);
    console.log('🔍 Сирий ответ GPT:', assistantResponse.substring(0, 150));

    // Парсимо JSON відповідь для структурованих даних
    let parsedResponse: any = null;
    let finalResponse = assistantResponse;

    try {
      // Видаляємо markdown блоки ```json ... ```
      let cleanedResponse = assistantResponse.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

      // Спробуємо знайти JSON за допомогою балансування дужок
      const startIdx = cleanedResponse.indexOf('{');
      if (startIdx !== -1) {
        let depth = 0;
        let endIdx = -1;

        for (let i = startIdx; i < cleanedResponse.length; i++) {
          if (cleanedResponse[i] === '{') depth++;
          if (cleanedResponse[i] === '}') depth--;

          if (depth === 0) {
            endIdx = i + 1;
            break;
          }
        }

        if (endIdx !== -1) {
          const jsonStr = cleanedResponse.substring(startIdx, endIdx);
          parsedResponse = JSON.parse(jsonStr);

          console.log('📦 JSON розпарсено:', {
            hasMessage: !!parsedResponse.message,
            hasProducts: !!parsedResponse.products,
            messagePreview: parsedResponse.message?.substring(0, 50)
          });

          // Формуємо відповідь: тільки текст + окремо масив товарів
          if (parsedResponse.products && Array.isArray(parsedResponse.products) && parsedResponse.products.length > 0) {
            // ОБМЕЖЕННЯ: максимум 3 товари
            const maxProducts = 3;
            parsedResponse.products = parsedResponse.products.slice(0, maxProducts);

            console.log(`✅ Підготовлено ${parsedResponse.products.length} товарів для відправки`);

            // Відправляємо тільки текстове повідомлення (без товарів)
            finalResponse = parsedResponse.message || 'Ось що я знайшов для вас:';
            console.log(`✅ Текст відповіді: "${finalResponse}"`);
          } else if (parsedResponse.message) {
            // Якщо є тільки message без товарів
            finalResponse = parsedResponse.message;
            console.log(`✅ Використовуємо тільки message без товарів`);
          } else {
            console.log('⚠️ JSON не містить ні message ні products');
          }
        } else {
          console.log('ℹ️ Не знайдено закриваючу дужку JSON');
        }
      } else {
        console.log('ℹ️ JSON не знайдено у відповіді');
      }
    } catch (error) {
      console.warn('⚠️ Не вдалося розпарсити JSON:', error);
      console.log('Відповідь бота:', assistantResponse.substring(0, 200));
    }

    // Трекаємо показані товари
    const productIds = products.map(p => p.id);
    trackShownProducts(sessionId, productIds);
    console.log(`📊 Всього показано товарів у цій сесії: ${getShownProductIds(sessionId).size}`);

    // Зберігаємо в історію
    addMessageToHistory(sessionId, 'user', userMessage);
    addMessageToHistory(sessionId, 'assistant', finalResponse);

    return {
      response: finalResponse,
      sessionId,
      productsFound: products.length,
      relevanceCheck,
      products: parsedResponse?.products || null, // Додаємо структуровані товари
    };
  } catch (error) {
    console.error('❌ Помилка обробки повідомлення:', error);
    throw error;
  }
};

// Стара функція analyzeQueryContext видалена - замінена на analyzeUserIntent

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
 * НОВА ФУНКЦІЯ: AI-аналіз типу запиту користувача
 * Визначає чи це: пошук за артикулом, пошук аналогів, чи звичайна рекомендація
 */
interface UserIntent {
  searchType: 'article_search' | 'find_similar' | 'recommendation';
  searchQuery: string;
  context: string;
  needsMultipleComponents: boolean;
}

/**
 * НОВА УНІВЕРСАЛЬНА AI-ФУНКЦІЯ: Аналіз намерень з розумінням контексту
 * Об'єднує аналіз намерень + перевірку релевантності в один запит
 */
const analyzeUserIntentWithAI = async (
  userMessage: string,
  conversationHistory: ChatMessage[]
): Promise<UserIntent> => {
  try {
    // Беремо останні 3 повідомлення для контексту
    const recentHistory = conversationHistory.slice(-6)
      .map(m => `${m.role === 'user' ? 'Користувач' : 'Асистент'}: ${m.content.substring(0, 200)}`)
      .join('\n');

    const analysisPrompt = `Ти - AI асистент магазину вітамінів та БАДів.

ІСТОРІЯ РОЗМОВИ:
${recentHistory || 'Немає історії'}

НОВИЙ ЗАПИТ КОРИСТУВАЧА: "${userMessage}"

ТВОЄ ЗАВДАННЯ:
1. Визнач чи запит стосується вітамінів/БАДів/здоров'я
2. Якщо ТАК - визнач тип запиту і СФОРМУЙ ПОШУКОВИЙ ЗАПИТ з урахуванням контексту розмови
3. Якщо НІ - позначень як нерелевантний

ВАЖЛИВО ПРО КОНТЕКСТ:
- Якщо користувач питає "а є від [бренд]?" або "а що є [бренду]?" - це уточнення до ПОПЕРЕДНЬОГО запиту
- Поєднай попередній запит користувача з новим уточненням (наприклад: "вітамін д3 Now Foods")
- Якщо питає "ще варіанти" або "інші" - використай той самий попередній запит

ТИПИ ЗАПИТІВ:
- article_search: пошук конкретного товару за артикулом (формат XXX-12345)
- find_similar: пошук аналогів/альтернатив до товару
- recommendation: звичайна рекомендація товарів

ПОВЕРНИ JSON:
{
  "searchType": "recommendation",
  "searchQuery": "повний пошуковий запит з урахуванням контексту",
  "context": "коротке пояснення що зрозумів",
  "needsMultipleComponents": false,
  "isRelevant": true
}

Якщо запит НЕ стосується здоров'я/вітамінів:
{
  "searchType": "recommendation",
  "searchQuery": "",
  "context": "нерелевантний запит",
  "needsMultipleComponents": false,
  "isRelevant": false
}`;

    const response = await generateChatResponse(
      [{ role: 'user', content: analysisPrompt }],
      0.3,
      500
    );

    // Витягуємо JSON з відповіді
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Якщо нерелевантний
      if (parsed.isRelevant === false) {
        return {
          searchType: 'recommendation',
          searchQuery: '',
          context: 'нерелевантний запит',
          needsMultipleComponents: false,
        };
      }

      console.log(`🤖 AI зрозуміла контекст: "${parsed.context}"`);
      return {
        searchType: parsed.searchType || 'recommendation',
        searchQuery: parsed.searchQuery || userMessage,
        context: parsed.context || 'AI-аналіз',
        needsMultipleComponents: parsed.needsMultipleComponents || false,
      };
    }

    // Fallback: якщо AI не повернула JSON
    return detectIntentFallback(userMessage, conversationHistory);
  } catch (error) {
    console.error('❌ Помилка AI-аналізу:', error);
    return detectIntentFallback(userMessage, conversationHistory);
  }
};

/**
 * ШВИДКА ФУНКЦІЯ: Перевірка чи запит стосується здоров'я/БАДів (без AI)
 */
const isHealthRelatedQuery = (message: string): boolean => {
  const lowerMessage = message.toLowerCase();

  // Ключові слова що вказують на здоров'я/БАДи
  const healthKeywords = [
    'вітамін', 'витамин', 'мінерал', 'добавк', 'бад', 'омега', 'магній', 'кальцій',
    'залізо', 'цинк', 'для здоров', 'для імунітет', 'для сну', 'для суглоб',
    'для очей', 'для серця', 'для печінк', 'для шкір', 'для волос', 'для нігт',
    'коензим', 'колаген', 'пробіотик', 'пребіотик', 'антиоксидант',
    'для схуднення', 'для енергії', 'для стрес', 'для пам\'ят', 'для концентрації',
    'глюкозамін', 'хондроїтин', 'куркум', 'імбир', 'женьшень', 'спіруліна',
    'хлорела', 'ашваганда', 'мелатонін', 'триптофан', 'амінокислот',
    'протеїн', 'bcaa', 'креатин', 'л-карнітин', 'коралов', 'йод',
    'селен', 'хром', 'мідь', 'марганець', 'молібден', 'бор',
    'при гіпертонії', 'при діабет', 'при артроз', 'при остеопороз',
    'biotus', 'solgar', 'now foods', 'jarrow', 'myprotein'
  ];

  // Якщо знайдено хоча б одне ключове слово - запит релевантний
  return healthKeywords.some(keyword => lowerMessage.includes(keyword));
};

/**
 * ШВИДКА ФУНКЦІЯ: Евристика для визначення типу запиту (без AI)
 */
const detectIntentFallback = (
  userMessage: string,
  conversationHistory: ChatMessage[]
): UserIntent => {
  const message = userMessage.toLowerCase();

  // Перевірка на артикул (формат XXX-XXXXX)
  const articlePattern = /[A-Z]{2,4}-\d{4,6}/i;
  const articleMatch = userMessage.match(articlePattern);

  if (articleMatch) {
    return {
      searchType: 'article_search',
      searchQuery: articleMatch[0],
      context: 'Пошук по артикулу',
      needsMultipleComponents: false,
    };
  }

  // Перевірка на запит аналогів
  const similarKeywords = ['аналог', 'аналоги', 'похож', 'замена', 'заменить', 'вместо', 'альтернатив', 'ще варіант', 'інші варіант', 'що ще'];
  const isSimilarRequest = similarKeywords.some(keyword => message.includes(keyword));

  if (isSimilarRequest && conversationHistory.length > 0) {
    // Шукаємо останнє повідомлення асистента
    const lastAssistantMessage = conversationHistory
      .filter(m => m.role === 'assistant')
      .pop();

    if (lastAssistantMessage) {
      return {
        searchType: 'find_similar',
        searchQuery: extractProductFromHistory(lastAssistantMessage.content),
        context: 'Пошук аналогів до попереднього товару',
        needsMultipleComponents: false,
      };
    }
  }

  // Перевірка на уточнення з брендом (наприклад: "а є від Now Foods?", "а що є бренду Solgar?")
  const brandKeywords = ['бренд', 'брендів', 'від бренду', 'фірм', 'виробник', 'компані', 'компанії', 'марк'];
  const brandQuestionWords = ['а є', 'а що є', 'а є що', 'можна', 'покажи', 'хочу', 'є що', 'дай', 'а от', 'а якщо', 'що там', 'може'];

  const hasBrandMention = brandKeywords.some(keyword => message.includes(keyword)) ||
                          /now foods|нау фудс|solgar|солгар|biotus|біотус|jarrow|джарроу|myprotein|май протеїн|my nutri week|май нутрі|21st century|california gold|каліфорнія/i.test(userMessage);
  const isBrandQuestion = brandQuestionWords.some(word => message.includes(word)) || message.includes('?');

  if ((hasBrandMention || isBrandQuestion) && conversationHistory.length > 0) {
    // Шукаємо попередній запит користувача
    const userMessages = conversationHistory.filter(m => m.role === 'user');
    const previousQuery = userMessages[userMessages.length - 2]; // Передостанній запит

    if (previousQuery && previousQuery.content.length > 5) {
      // Витягуємо згадку бренду з поточного запиту
      const brandMatch = userMessage.match(/now foods|нау фудс|solgar|солгар|biotus|біотус|jarrow|джарроу|myprotein|май протеїн|my nutri week|май нутрі|21st century|california gold|каліфорнія/i);
      const extractedBrand = brandMatch ? brandMatch[0] : '';

      // Нормалізуємо назву бренду (переводимо українські на англійські)
      const brandNormalization: { [key: string]: string } = {
        'нау фудс': 'now foods',
        'солгар': 'solgar',
        'біотус': 'biotus',
        'джарроу': 'jarrow',
        'май протеїн': 'myprotein',
        'май нутрі': 'my nutri week',
        'каліфорнія': 'california gold'
      };
      const normalizedBrand = brandNormalization[extractedBrand.toLowerCase()] || extractedBrand;

      // Об'єднуємо попередній запит з уточненням бренду (використовуємо нормалізовану назву)
      const combinedQuery = extractedBrand
        ? `${previousQuery.content} ${normalizedBrand}`
        : previousQuery.content;

      return {
        searchType: 'recommendation',
        searchQuery: combinedQuery,
        context: `Уточнення з брендом до попереднього запиту: "${previousQuery.content}"`,
        needsMultipleComponents: false,
      };
    }
  }

  // Перевірка на продовження розмови ("ще", "інші" і т.д.)
  const continueKeywords = ['ще', 'інші', 'інше', 'ще варіант', 'другі', 'додатков', 'більше'];
  const isContinuation = continueKeywords.some(keyword => message.includes(keyword));

  if (isContinuation && conversationHistory.length > 0) {
    // Шукаємо попередній запит користувача
    const userMessages = conversationHistory.filter(m => m.role === 'user');
    const previousQuery = userMessages[userMessages.length - 2]; // Передостанній запит

    if (previousQuery) {
      return {
        searchType: 'recommendation',
        searchQuery: previousQuery.content,
        context: 'Продовження попереднього запиту',
        needsMultipleComponents: false,
      };
    }
  }

  // Перевірка на складний запит (для імунітету, для суглобів і т.д.)
  const complexKeywords = ['для ', 'при ', 'від ', 'проти '];
  const needsMultiple = complexKeywords.some(keyword => message.includes(keyword));

  return {
    searchType: 'recommendation',
    searchQuery: userMessage,
    context: 'Звичайний запит',
    needsMultipleComponents: needsMultiple,
  };
};

/**
 * НОВА ФУНКЦІЯ: Витягування назви товару з історії
 */
const extractProductFromHistory = (assistantMessage: string): string => {
  // Шукаємо перше згадування товару після емодзі або номера
  const productMatch = assistantMessage.match(/[📦1-3️⃣]\s*([^-\n]+)-/);
  if (productMatch) {
    return productMatch[1].trim();
  }

  // Якщо не знайшли, беремо перший рядок з назвою
  const lines = assistantMessage.split('\n');
  for (const line of lines) {
    if (line.includes('-') && !line.includes('💰') && !line.includes('✅')) {
      return line.split('-')[0].trim();
    }
  }

  return '';
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