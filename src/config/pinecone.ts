import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Ініціалізація клієнта Pinecone
 */
let pineconeClient: Pinecone | null = null;

export const initPinecone = async (): Promise<Pinecone> => {
  if (pineconeClient) {
    return pineconeClient;
  }

  const apiKey = process.env.PINECONE_API_KEY;

  if (!apiKey) {
    throw new Error('PINECONE_API_KEY не знайдено в змінних середовища');
  }

  try {
    pineconeClient = new Pinecone({
      apiKey: apiKey,
    });

    console.log('✅ Pinecone клієнт успішно ініціалізовано');
    return pineconeClient;
  } catch (error) {
    console.error('❌ Помилка ініціалізації Pinecone:', error);
    throw new Error('Не вдалося ініціалізувати Pinecone');
  }
};

/**
 * Отримання індексу Pinecone
 */
export const getPineconeIndex = async () => {
  const indexName = process.env.PINECONE_INDEX_NAME || 'vitamins-catalog-v2';

  try {
    const client = await initPinecone();
    const index = client.index(indexName);

    console.log(`✅ Підключено до індексу: ${indexName}`);
    return index;
  } catch (error) {
    console.error('❌ Помилка підключення до індексу:', error);
    throw new Error(`Не вдалося підключитися до індексу ${indexName}`);
  }
};

/**
 * Перевірка здоров'я Pinecone з'єднання
 */
export const checkPineconeHealth = async (): Promise<boolean> => {
  try {
    const client = await initPinecone();
    const indexName = process.env.PINECONE_INDEX_NAME || 'vitamins-catalog-v2';

    // Перевіряємо, чи існує індекс
    const indexList = await client.listIndexes();
    const indexExists = indexList.indexes?.some(idx => idx.name === indexName);

    if (!indexExists) {
      console.error(`❌ Індекс ${indexName} не знайдено`);
      return false;
    }

    // Отримуємо статистику індексу
    const index = client.index(indexName);
    const stats = await index.describeIndexStats();

    console.log(`✅ Pinecone здоров'я: OK. Векторів в індексі: ${stats.totalRecordCount}`);
    return true;
  } catch (error) {
    console.error('❌ Помилка перевірки здоров\'я Pinecone:', error);
    return false;
  }
};
