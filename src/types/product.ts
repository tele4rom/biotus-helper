/**
 * Метадані продукту в Pinecone
 */
export interface ProductMetadata {
  id: string;
  product_id: string;
  name: string;
  brand: string;
  sku: string;
  price: number;
  description: string;
  categories: string;
  form: string;
  package: string;
  flavor: string;
  age: string;
  active: boolean;
  quantity: number;
  status: boolean;
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
}

/**
 * Запит до чат-бота
 */
export interface ChatRequest {
  message: string;
  sessionId?: string;
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
  filter: {
    status: boolean;
    quantity: { $gt: number };
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
