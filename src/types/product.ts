/**
 * Метадані продукту в Pinecone (vitahub-xml)
 */
export interface ProductMetadata {
  id: string; // ID товара
  availability: string; // доступність к заказу (например: "in_stock")
  brand: string; // бренд товара
  categories: string[]; // категории товара (массив)
  category_main: string; // главная категория
  category_path: string; // путь категорий
  description: string; // описание
  gtin: string; // артикул или SKU товара
  image_link: string; // ссылка на фото товара
  link: string; // ссылка на товар
  price: number; // цена товара
  price_currency: string; // валюта цены (например: "UAH")
  price_formatted: string; // форматированная цена (например: "485 UAH")
  search_text: string; // текст для создания embeddings
  title: string; // название товара
}

/**
 * Результат пошуку з Pinecone
 */
export interface SearchMatch {
  id: string;
  score: number;
  metadata: ProductMetadata;
}

/**
 * Результат векторного пошуку
 */
export interface VectorSearchResult {
  products: SearchMatch[];
  hasRequiredBrand: boolean;
  totalFound: number;
}

/**
 * Повідомлення в чаті
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Історія розмови
 */
export interface ConversationHistory {
  sessionId: string;
  messages: ChatMessage[];
  createdAt: Date;
  lastUpdatedAt: Date;
  shownProductIds: Set<string>; // ID товарів, які вже були показані користувачу
  lastSearchQuery?: string; // Останній пошуковий запит для контекстних питань
}

/**
 * Запит до чат-бота
 */
export interface ChatRequest {
  message: string;
  sessionId?: string;
}

/**
 * Структурований товар для фронтенду
 */
export interface StructuredProduct {
  id: string;
  title: string;
  brand: string;
  price: string;
  article: string;
  image: string;
  link: string;
  reason: string;
}

/**
 * Відповідь чат-бота
 */
export interface ChatResponse {
  response: string;
  sessionId: string;
  productsFound: number;
  relevanceCheck: {
    isRelevant: boolean;
    reason?: string;
  };
  products?: StructuredProduct[] | null; // Додано структуровані товари
}

/**
 * Результат валідації релевантності
 */
export interface RelevanceValidation {
  isRelevant: boolean;
  reason: string;
  suggestedResponse?: string;
}

/**
 * Конфігурація пошуку
 */
export interface SearchConfig {
  topK: number;
  minSimilarityScore: number;
  requiredBrands: string[];
  filter?: {
    availability?: string; // например: "in_stock"
  };
}

/**
 * Конфігурація чат-бота
 */
export interface ChatbotConfig {
  model: string;
  embeddingModel: string;
  temperature: number;
  maxTokens: number;
  maxConversationHistory: number;
  minProductsRequired: number;
}
