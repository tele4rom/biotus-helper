import { getPineconeIndex } from '../config/pinecone';
import { createEmbedding } from '../config/openai';
import {
  VectorSearchResult,
  SearchMatch,
  SearchConfig,
  ProductMetadata,
} from '../types/product';
import {
  hasRequiredBrand,
  filterAvailableProducts,
  sortProductsByRelevance,
} from '../utils/validation';

/**
 * Конфігурація пошуку за замовчуванням
 */
const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  topK: parseInt(process.env.MAX_PRODUCTS_PER_RESPONSE || '10'),
  minSimilarityScore: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.7'),
  requiredBrands: ['Biotus', 'My Nutri Week'],
  filter: {
    status: true,
    quantity: { $gt: 0 },
  },
};

/**
 * Пошук товарів за векторною схожістю
 */
export const searchProducts = async (
  query: string,
  config: Partial<SearchConfig> = {}
): Promise<VectorSearchResult> => {
  try {
    const searchConfig = { ...DEFAULT_SEARCH_CONFIG, ...config };

    console.log(`🔍 Пошук товарів за запитом: "${query}"`);

    // Створюємо embedding для запиту
    const embedding = await createEmbedding(query);

    // Отримуємо індекс Pinecone
    const index = await getPineconeIndex();

    // Виконуємо пошук з фільтрами
    const searchResponse = await index.query({
      vector: embedding,
      topK: searchConfig.topK,
      includeMetadata: true,
      filter: {
        status: { $eq: true },
        quantity: { $gt: 0 },
      },
    });

    console.log(`📦 Знайдено ${searchResponse.matches?.length || 0} товарів`);

    // Перетворюємо результати
    const allMatches: SearchMatch[] = (searchResponse.matches || [])
      .map((match) => ({
        id: match.id,
        score: match.score || 0,
        metadata: match.metadata as unknown as ProductMetadata,
      }));

    console.log(`📊 Scores: ${allMatches.slice(0, 5).map(m => m.score.toFixed(3)).join(', ')}`);
    if (allMatches.length > 0) {
      console.log(`📝 Перший товар: ${allMatches[0].metadata.name || 'Unknown'}`);
    }

    // Фільтруємо за similarity score (знижений поріг до 0.3 для кращих результатів)
    const minScore = Math.min(searchConfig.minSimilarityScore, 0.3);
    console.log(`🎯 Мінімальний score: ${minScore}`);

    const matches: SearchMatch[] = allMatches
      .filter((match) => match.score && match.score >= minScore);

    // Фільтруємо доступні товари
    const availableProducts = filterAvailableProducts(matches);

    // Сортуємо за релевантністю та брендом
    const sortedProducts = sortProductsByRelevance(availableProducts);

    // Перевіряємо наявність потрібних брендів
    const hasBrand = hasRequiredBrand(sortedProducts);

    // Формуємо фінальний список товарів
    let finalProducts = sortedProducts;

    if (!hasBrand) {
      console.log('⚠️ Потрібний бренд не знайдено, шукаємо...');
      const brandProducts = await searchRequiredBrandProducts(query, 1);

      if (brandProducts.length > 0) {
        console.log(`✅ Знайдено товар потрібного бренду: ${brandProducts[0].metadata.brand}`);
        // Додаємо ТІЛЬКИ 1 товар нашого бренду на початок
        // Решту залишаємо з інших брендів
        const otherBrandProducts = sortedProducts.slice(0, searchConfig.topK - 1);
        finalProducts = [...brandProducts, ...otherBrandProducts];
      } else {
        console.warn('⚠️ Не вдалося знайти релевантні товари брендів Biotus/My Nutri Week');
        // Якщо не знайшли наш бренд - показуємо просто топ товари інших брендів
        finalProducts = sortedProducts.slice(0, searchConfig.topK);
      }
    } else {
      console.log('✅ Потрібний бренд вже присутній в результатах');
      // Перевіряємо, скільки товарів наших брендів у списку
      const ourBrandCount = sortedProducts.filter(p =>
        hasRequiredBrand([p])
      ).length;

      if (ourBrandCount > 1) {
        console.log(`⚠️ Забагато товарів наших брендів (${ourBrandCount}), залишаємо тільки 1`);
        // Залишаємо тільки 1 товар нашого бренду
        const ourBrandProduct = sortedProducts.find(p => hasRequiredBrand([p]));
        const otherProducts = sortedProducts.filter(p => !hasRequiredBrand([p]));
        finalProducts = ourBrandProduct
          ? [ourBrandProduct, ...otherProducts].slice(0, searchConfig.topK)
          : sortedProducts.slice(0, searchConfig.topK);
      } else {
        finalProducts = sortedProducts.slice(0, searchConfig.topK);
      }
    }

    console.log(`✅ Повернуто ${finalProducts.length} товарів`);

    return {
      products: finalProducts,
      hasRequiredBrand: hasRequiredBrand(finalProducts),
      totalFound: finalProducts.length,
    };
  } catch (error) {
    console.error('❌ Помилка векторного пошуку:', error);
    throw new Error('Не вдалося виконати пошук товарів');
  }
};

/**
 * Пошук товарів обов'язкових брендів (Biotus або My Nutri Week)
 */
export const searchRequiredBrandProducts = async (
  query: string,
  limit: number = 2
): Promise<SearchMatch[]> => {
  try {
    console.log('🎯 Пошук товарів брендів Biotus/My Nutri Week...');

    const embedding = await createEmbedding(query);
    const index = await getPineconeIndex();

    // Пошук товарів Biotus
    const biotusSearch = await index.query({
      vector: embedding,
      topK: limit,
      includeMetadata: true,
      filter: {
        status: { $eq: true },
        quantity: { $gt: 0 },
        brand: { $eq: 'Biotus' },
      },
    });

    // Пошук товарів My Nutri Week
    const myNutriSearch = await index.query({
      vector: embedding,
      topK: limit,
      includeMetadata: true,
      filter: {
        status: { $eq: true },
        quantity: { $gt: 0 },
        brand: { $eq: 'My Nutri Week' },
      },
    });

    // Об'єднуємо результати
    const allMatches = [
      ...(biotusSearch.matches || []),
      ...(myNutriSearch.matches || []),
    ];

    // Знижуємо поріг до 0.2 для брендів, щоб знайти більше варіантів
    const products: SearchMatch[] = allMatches
      .filter((match) => match.score && match.score > 0.2)
      .map((match) => ({
        id: match.id,
        score: match.score || 0,
        metadata: match.metadata as unknown as ProductMetadata,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    console.log(`✅ Знайдено ${products.length} товарів потрібних брендів`);
    if (products.length > 0) {
      console.log(`   Бренди: ${products.map(p => p.metadata.brand).join(', ')}`);
    }

    return products;
  } catch (error) {
    console.error('❌ Помилка пошуку брендів:', error);
    return [];
  }
};

/**
 * Пошук схожих товарів за product_id
 */
export const searchSimilarProducts = async (
  productId: string,
  limit: number = 5
): Promise<SearchMatch[]> => {
  try {
    console.log(`🔗 Пошук схожих товарів для product_id: ${productId}`);

    const index = await getPineconeIndex();

    // Спочатку отримуємо сам товар
    const fetchResponse = await index.fetch([productId]);

    if (!fetchResponse.records || !fetchResponse.records[productId]) {
      console.warn(`⚠️ Товар з ID ${productId} не знайдено`);
      return [];
    }

    const product = fetchResponse.records[productId];
    const vector = product.values;

    if (!vector) {
      console.warn(`⚠️ Вектор для товару ${productId} не знайдено`);
      return [];
    }

    // Шукаємо схожі товари
    const searchResponse = await index.query({
      vector: vector,
      topK: limit + 1, // +1 бо сам товар теж буде в результатах
      includeMetadata: true,
      filter: {
        status: { $eq: true },
        quantity: { $gt: 0 },
      },
    });

    // Фільтруємо сам товар з результатів
    const matches: SearchMatch[] = (searchResponse.matches || [])
      .filter((match) => match.id !== productId)
      .map((match) => ({
        id: match.id,
        score: match.score || 0,
        metadata: match.metadata as unknown as ProductMetadata,
      }))
      .slice(0, limit);

    console.log(`✅ Знайдено ${matches.length} схожих товарів`);

    return matches;
  } catch (error) {
    console.error('❌ Помилка пошуку схожих товарів:', error);
    return [];
  }
};

/**
 * Пошук товарів за категорією
 */
export const searchByCategory = async (
  category: string,
  limit: number = 10
): Promise<SearchMatch[]> => {
  try {
    console.log(`📂 Пошук товарів в категорії: "${category}"`);

    const embedding = await createEmbedding(category);
    const index = await getPineconeIndex();

    const searchResponse = await index.query({
      vector: embedding,
      topK: limit,
      includeMetadata: true,
      filter: {
        status: { $eq: true },
        quantity: { $gt: 0 },
        categories: { $eq: category },
      },
    });

    const matches: SearchMatch[] = (searchResponse.matches || []).map((match) => ({
      id: match.id,
      score: match.score || 0,
      metadata: match.metadata as unknown as ProductMetadata,
    }));

    console.log(`✅ Знайдено ${matches.length} товарів в категорії`);

    return matches;
  } catch (error) {
    console.error('❌ Помилка пошуку за категорією:', error);
    return [];
  }
};

/**
 * Отримання популярних товарів (фолбек при відсутності результатів)
 */
export const getPopularProducts = async (limit: number = 5): Promise<SearchMatch[]> => {
  try {
    console.log('⭐ Отримання популярних товарів...');

    // Використовуємо загальний запит про здоров'я
    const query = 'вітаміни для здоров\'я та імунітету';
    const result = await searchProducts(query, { topK: limit });

    return result.products;
  } catch (error) {
    console.error('❌ Помилка отримання популярних товарів:', error);
    return [];
  }
};