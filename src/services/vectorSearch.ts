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
  topK: parseInt(process.env.MAX_PRODUCTS_PER_RESPONSE || '20'), // Збільшено до 20 для більшої кількості варіантів
  minSimilarityScore: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.7'),
  requiredBrands: ['Biotus', 'My Nutri Week'],
  filter: {
    availability: 'in_stock', // Новый формат для vitahub-xml
  },
};

/**
 * Виявлення артикулу в тексті запиту
 */
export const extractArticleFromQuery = (query: string): string | null => {
  // Шаблони артикулів: SOL-01701, BIO-532894, NOW-00702, тощо
  const articlePatterns = [
    /([A-Z]{2,4}[-\s]?\d{4,6})/gi, // SOL-01701, BIO 532894 (без \b для поддержки кириллицы)
    /артикул[:\s]*([A-Z]{2,4}[-\s]?\d{4,6})/gi, // артикул: SOL-01701
    /товар[:\s]+([A-Z]{2,4}[-\s]?\d{4,6})/gi, // товар SOL-01701
    /код[:\s]+([A-Z]{2,4}[-\s]?\d{4,6})/gi, // код: SOL-01701
  ];

  for (const pattern of articlePatterns) {
    const match = query.match(pattern);
    if (match) {
      // Витягуємо код (беремо перший match)
      let article = match[0]
        .replace(/артикул[:\s]*/gi, '')
        .replace(/товар[:\s]*/gi, '')
        .replace(/код[:\s]*/gi, '')
        .trim();
      article = article.toUpperCase().replace(/\s+/g, '-'); // Нормалізуємо: SOL 01701 -> SOL-01701
      console.log(`🔍 Знайдено артикул в тексті "${query}": ${article}`);
      return article;
    }
  }

  return null;
};

/**
 * Пошук товару за артикулом (gtin)
 */
export const searchByArticle = async (article: string): Promise<SearchMatch | null> => {
  try {
    console.log(`🔍 Пошук товару за артикулом: "${article}"`);

    const index = await getPineconeIndex();

    // Генеруємо варіанти артикулу для пошуку
    const variants = [
      article,
      article.replace(/-/g, ''),  // Без дефісу: SOL01701
      article.replace(/-/g, ' '),  // З пробілом: SOL 01701
    ];

    console.log(`🔎 Шукаємо варіанти артикулу: ${variants.join(', ')}`);

    // Спробуємо пошук через запит з артикулом (векторний пошук)
    // Це більш надійно, ніж dummy vector
    const embedding = await createEmbedding(article);

    const searchResponse = await index.query({
      vector: embedding,
      topK: 100, // Збільшуємо topK для більшої вірогідності знайти товар
      includeMetadata: true,
    });

    console.log(`📦 Отримано ${searchResponse.matches?.length || 0} результатів для перевірки`);

    // Шукаємо товар з відповідним gtin в метаданих
    for (const variant of variants) {
      const match = searchResponse.matches?.find(m => {
        const metadata = m.metadata as any;
        const productGtin = metadata.gtin?.toUpperCase() || '';
        const variantUpper = variant.toUpperCase();

        // Перевіряємо точну відповідність або часткову (на випадок різних форматів)
        return productGtin === variantUpper ||
               productGtin.replace(/[-\s]/g, '') === variantUpper.replace(/[-\s]/g, '');
      });

      if (match) {
        const metadata = match.metadata as any;
        console.log(`✅ Знайдено товар за артикулом "${variant}": ${metadata.title} (${metadata.brand})`);
        return {
          id: match.id,
          score: 1.0,
          metadata: match.metadata as unknown as ProductMetadata,
        };
      }
    }

    console.log(`❌ Товар з артикулом "${article}" не знайдено серед ${searchResponse.matches?.length || 0} результатів`);

    // Для дебагу виводимо перші 5 артикулів з результатів
    if (searchResponse.matches && searchResponse.matches.length > 0) {
      console.log('📋 Перші артикули в результатах:');
      searchResponse.matches.slice(0, 5).forEach((m, i) => {
        const meta = m.metadata as any;
        console.log(`   ${i + 1}. ${meta.gtin || 'NO GTIN'} - ${meta.title || 'NO TITLE'}`);
      });
    }

    return null;
  } catch (error) {
    console.error('❌ Помилка пошуку за артикулом:', error);
    return null;
  }
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

    // Виконуємо пошук (без фільтрів, так як в новому індексі немає полів status/quantity)
    const searchResponse = await index.query({
      vector: embedding,
      topK: searchConfig.topK,
      includeMetadata: true,
      // Фильтр по availability можно добавить позже, если понадобится
      // filter: {
      //   availability: { $eq: 'in_stock' },
      // },
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
      console.log(`📝 Перший товар: ${allMatches[0].metadata.title || 'Unknown'}`);
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
        brand: { $eq: 'Biotus' },
      },
    });

    // Пошук товарів My Nutri Week
    const myNutriSearch = await index.query({
      vector: embedding,
      topK: limit,
      includeMetadata: true,
      filter: {
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
      // Без фільтрів для vitahub-xml
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
      // Примечание: categories теперь массив, фильтр может не работать как ожидалось
      // filter: {
      //   categories: { $in: [category] },
      // },
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

/**
 * НОВІ ФУНКЦІЇ З ПОКРАЩЕНЬ
 */

/**
 * Пріоритет брендів (нова константа)
 */
const BRAND_PRIORITY = {
  own: ['Biotus', 'My Nutri Week'], // Власні бренди - найвищий пріоритет
  popular: [
    'Now Foods',
    'Carlson Labs',
    "Doctor's Best",
    'Solgar',
    "Nature's Way",
    'Life Extension',
    'Thorne Research',
    "Nature's Plus",
    'Source Naturals',
    "Puritan's Pride",
    'Pure Encapsulations',
    'California Gold Nutrition',
    'Jarrow Formulas',
  ],
};

/**
 * Визначення пріоритету бренду (нова функція)
 */
function getBrandPriority(brand: string): number {
  if (BRAND_PRIORITY.own.includes(brand)) return 3; // Найвищий пріоритет
  if (BRAND_PRIORITY.popular.includes(brand)) return 2; // Середній пріоритет
  return 1; // Звичайний пріоритет
}

/**
 * Сортування результатів з урахуванням пріоритету брендів (нова функція)
 */
export function sortByBrandPriority(results: SearchMatch[]): SearchMatch[] {
  return results.sort((a, b) => {
    const priorityA = getBrandPriority(a.metadata.brand);
    const priorityB = getBrandPriority(b.metadata.brand);

    // Спочатку по пріоритету бренду
    if (priorityA !== priorityB) {
      return priorityB - priorityA; // Від більшого до меншого
    }

    // Потім по score релевантності
    return (b.score || 0) - (a.score || 0);
  });
}

/**
 * Балансування результатів: один свій бренд + популярні + інші (нова функція)
 */
export function balanceResults(results: SearchMatch[], limit: number = 3): SearchMatch[] {
  const ownBrand = results.filter(r =>
    BRAND_PRIORITY.own.includes(r.metadata.brand)
  );
  const popularBrands = results.filter(r =>
    BRAND_PRIORITY.popular.includes(r.metadata.brand)
  );
  const otherBrands = results.filter(r =>
    !BRAND_PRIORITY.own.includes(r.metadata.brand) &&
    !BRAND_PRIORITY.popular.includes(r.metadata.brand)
  );

  const balanced: SearchMatch[] = [];

  // Додаємо один товар свого бренду (якщо є)
  if (ownBrand.length > 0) {
    balanced.push(ownBrand[0]);
  }

  // Додаємо популярні бренди
  const remainingSlots = limit - balanced.length;
  const popularToAdd = Math.min(popularBrands.length, remainingSlots);
  balanced.push(...popularBrands.slice(0, popularToAdd));

  // Додаємо інші, якщо ще є місця
  const stillRemaining = limit - balanced.length;
  if (stillRemaining > 0) {
    balanced.push(...otherBrands.slice(0, stillRemaining));
  }

  return balanced;
}

/**
 * Покращена версія пошуку схожих товарів з фільтром по ціні ±30% (нова логіка)
 */
export const findSimilarProductsByPrice = async (
  originalProduct: any,
  limit: number = 5
): Promise<SearchMatch[]> => {
  try {
    console.log(`🔄 Пошук аналогів для товару: ${originalProduct.title}`);

    // Критерії для пошуку аналогів
    const priceMin = originalProduct.price * 0.7; // -30%
    const priceMax = originalProduct.price * 1.3; // +30%

    const index = await getPineconeIndex();

    // Формуємо запит для пошуку схожих товарів
    const searchQuery = `${originalProduct.category_main} ${originalProduct.title}`;
    const embedding = await createEmbedding(searchQuery);

    // Шукаємо схожі товари
    const searchResponse = await index.query({
      vector: embedding,
      topK: limit * 5, // Беремо більше для фільтрації
      includeMetadata: true,
    });

    if (!searchResponse.matches || searchResponse.matches.length === 0) {
      return [];
    }

    // Перетворюємо та фільтруємо результати
    const allMatches: SearchMatch[] = searchResponse.matches
      .filter((match) => {
        const meta = match.metadata as any;
        // Виключаємо оригінальний товар
        if (meta.id === originalProduct.id) return false;
        // Фільтруємо по категорії
        if (meta.category_main !== originalProduct.category_main) return false;
        // Фільтруємо по ціні ±30%
        const price = meta.price || 0;
        if (price < priceMin || price > priceMax) return false;
        // Тільки товари в наявності
        if (meta.availability !== 'in_stock') return false;
        return true;
      })
      .map((match) => ({
        id: match.id,
        score: match.score || 0,
        metadata: match.metadata as unknown as ProductMetadata,
      }));

    // Сортуємо по пріоритету брендів
    const sorted = sortByBrandPriority(allMatches);

    // Балансуємо результати
    const balanced = balanceResults(sorted, limit);

    console.log(`✅ Знайдено ${balanced.length} аналогів`);
    return balanced;
  } catch (error) {
    console.error('❌ Помилка пошуку аналогів:', error);
    return [];
  }
};

/**
 * Отримання товару за ID (нова функція)
 */
export const getProductById = async (productId: string): Promise<SearchMatch | null> => {
  try {
    const index = await getPineconeIndex();

    const fetchResponse = await index.fetch([productId]);

    if (!fetchResponse.records || !fetchResponse.records[productId]) {
      console.warn(`⚠️ Товар з ID ${productId} не знайдено`);
      return null;
    }

    const product = fetchResponse.records[productId];

    return {
      id: product.id,
      score: 1.0,
      metadata: product.metadata as unknown as ProductMetadata,
    };
  } catch (error) {
    console.error('❌ Помилка отримання товару за ID:', error);
    return null;
  }
};

/**
 * Пошук для комплексних запитів (нова функція)
 * Наприклад "для імунітету" -> [vitamin d3, vitamin c, zinc]
 */
export const searchForComplexQuery = async (
  components: string[], // Наприклад: ['vitamin d3', 'vitamin c', 'zinc']
  limitPerComponent: number = 3
): Promise<{ component: string; products: SearchMatch[] }[]> => {
  try {
    console.log(`🔍 Комплексний пошук: ${components.join(', ')}`);

    const results: { component: string; products: SearchMatch[] }[] = [];

    for (const component of components) {
      const searchResult = await searchProducts(component, { topK: limitPerComponent });
      results.push({
        component,
        products: searchResult.products,
      });
    }

    console.log(`✅ Завершено комплексний пошук по ${results.length} компонентах`);
    return results;
  } catch (error) {
    console.error('❌ Помилка комплексного пошуку:', error);
    return [];
  }
};