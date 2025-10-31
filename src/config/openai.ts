import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Ініціалізація клієнта OpenAI
 */
let openaiClient: OpenAI | null = null;

export const initOpenAI = (): OpenAI => {
  if (openaiClient) {
    return openaiClient;
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY не знайдено в змінних середовища');
  }

  try {
    openaiClient = new OpenAI({
      apiKey: apiKey,
    });

    console.log('✅ OpenAI клієнт успішно ініціалізовано');
    return openaiClient;
  } catch (error) {
    console.error('❌ Помилка ініціалізації OpenAI:', error);
    throw new Error('Не вдалося ініціалізувати OpenAI');
  }
};

/**
 * Отримання OpenAI клієнта
 */
export const getOpenAI = (): OpenAI => {
  if (!openaiClient) {
    return initOpenAI();
  }
  return openaiClient;
};

/**
 * Створення embedding для тексту
 */
export const createEmbedding = async (text: string): Promise<number[]> => {
  try {
    const client = getOpenAI();
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float',
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('Отримано порожню відповідь від OpenAI');
    }

    return response.data[0].embedding;
  } catch (error) {
    console.error('❌ Помилка створення embedding:', error);
    throw new Error('Не вдалося створити embedding для тексту');
  }
};

/**
 * Генерація відповіді через GPT
 */
export const generateChatResponse = async (
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  temperature: number = 0.7,
  maxTokens: number = 1000
): Promise<string> => {
  try {
    const client = getOpenAI();
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      temperature: temperature,
      max_tokens: maxTokens,
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('Отримано порожню відповідь від GPT');
    }

    return content;
  } catch (error) {
    console.error('❌ Помилка генерації відповіді GPT:', error);
    throw new Error('Не вдалося згенерувати відповідь');
  }
};

/**
 * Перевірка здоров'я OpenAI з'єднання
 */
export const checkOpenAIHealth = async (): Promise<boolean> => {
  try {
    const client = getOpenAI();

    // Простий запит для перевірки
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 5,
    });

    if (response.choices && response.choices.length > 0) {
      console.log('✅ OpenAI здоров\'я: OK');
      return true;
    }

    return false;
  } catch (error) {
    console.error('❌ Помилка перевірки здоров\'я OpenAI:', error);
    return false;
  }
};
