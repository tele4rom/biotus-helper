import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { processChatMessage, deleteSession, getSessionStats } from './services/chatbot';
import { checkPineconeHealth } from './config/pinecone';
import { checkOpenAIHealth } from './config/openai';
import { validateEnvironment } from './utils/validation';
import { ChatRequest } from './types/product';

// Завантаження змінних середовища
dotenv.config();

// Створення Express додатку
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Сервування статичних файлів з папки public
app.use(express.static(path.join(__dirname, '../public')));

// Логування запитів
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`📥 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// CORS headers (опціонально, залежно від вимог)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  next();
});

/**
 * GET /api
 * API інформація
 */
app.get('/api', (_req: Request, res: Response) => {
  res.json({
    message: 'Вітаємо в API чат-бота підтримки магазину вітамінів! 🌟',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health - Перевірка стану сервісу',
      chat: 'POST /chat - Відправити повідомлення боту',
      deleteSession: 'DELETE /chat/:sessionId - Видалити сесію',
      stats: 'GET /stats - Отримати статистику сесій',
    },
    documentation: 'Використовуйте POST /chat з JSON: { "message": "ваше повідомлення", "sessionId": "опціонально" }',
  });
});

/**
 * GET /health
 * Перевірка здоров'я сервісу
 */
app.get('/health', async (_req: Request, res: Response) => {
  try {
    console.log('🏥 Перевірка здоров\'я сервісу...');

    // Валідація середовища
    const envValidation = validateEnvironment();

    if (!envValidation.valid) {
      res.status(500).json({
        status: 'unhealthy',
        errors: envValidation.errors,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Перевірка Pinecone
    const pineconeHealthy = await checkPineconeHealth();

    // Перевірка OpenAI
    const openaiHealthy = await checkOpenAIHealth();

    const isHealthy = pineconeHealthy && openaiHealthy;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'degraded',
      services: {
        pinecone: pineconeHealthy ? 'ok' : 'error',
        openai: openaiHealthy ? 'ok' : 'error',
      },
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        port: PORT,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Помилка перевірки здоров\'я:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Внутрішня помилка сервісу',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /chat
 * Обробка повідомлення від користувача
 */
app.post('/chat', async (req: Request, res: Response) => {
  try {
    const chatRequest: ChatRequest = req.body;

    // Валідація запиту
    if (!chatRequest.message || typeof chatRequest.message !== 'string') {
      res.status(400).json({
        error: 'Поле "message" є обов\'язковим і повинно бути рядком',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (chatRequest.message.trim().length === 0) {
      res.status(400).json({
        error: 'Повідомлення не може бути порожнім',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (chatRequest.message.length > 500) {
      res.status(400).json({
        error: 'Повідомлення занадто довге (максимум 500 символів)',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Обробка повідомлення
    console.log(`💬 Запит від клієнта: "${chatRequest.message.substring(0, 50)}..."`);

    const response = await processChatMessage(chatRequest);

    res.json({
      success: true,
      data: response,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('❌ Помилка обробки чату:', error);

    res.status(500).json({
      success: false,
      error: error.message || 'Внутрішня помилка сервера',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * DELETE /chat/:sessionId
 * Видалення сесії
 */
app.delete('/chat/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      res.status(400).json({
        error: 'sessionId є обов\'язковим параметром',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const deleted = deleteSession(sessionId);

    if (!deleted) {
      res.status(404).json({
        error: 'Сесію не знайдено або вже видалено',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.json({
      success: true,
      message: 'Сесію успішно видалено',
      sessionId,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('❌ Помилка видалення сесії:', error);

    res.status(500).json({
      success: false,
      error: error.message || 'Внутрішня помилка сервера',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /stats
 * Отримання статистики сесій (для адміністрування)
 */
app.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = getSessionStats();

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('❌ Помилка отримання статистики:', error);

    res.status(500).json({
      success: false,
      error: error.message || 'Внутрішня помилка сервера',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * 404 Handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Endpoint не знайдено',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Error Handler
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('❌ Необроблена помилка:', err);

  res.status(500).json({
    error: 'Внутрішня помилка сервера',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Запуск сервера
 */
const startServer = async () => {
  try {
    // Валідація середовища
    const envValidation = validateEnvironment();

    if (!envValidation.valid) {
      console.error('❌ Помилки конфігурації:');
      envValidation.errors.forEach((error) => console.error(`  - ${error}`));
      process.exit(1);
    }

    console.log('✅ Конфігурація валідна');

    // Перевірка підключення до Pinecone
    const pineconeHealthy = await checkPineconeHealth();
    if (!pineconeHealthy) {
      console.warn('⚠️ Попередження: Pinecone не доступний');
    }

    // Перевірка підключення до OpenAI
    const openaiHealthy = await checkOpenAIHealth();
    if (!openaiHealthy) {
      console.warn('⚠️ Попередження: OpenAI не доступний');
    }

    // Запуск сервера
    app.listen(PORT, () => {
      console.log('');
      console.log('🚀 ================================================');
      console.log(`🤖 Чат-бот підтримки магазину вітамінів запущено!`);
      console.log(`📡 Сервер слухає на порту: ${PORT}`);
      console.log(`🌍 Середовище: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 URL: http://localhost:${PORT}`);
      console.log('🛠️  Endpoints:');
      console.log(`   - GET  / - Інформація про API`);
      console.log(`   - GET  /health - Здоров'я сервісу`);
      console.log(`   - POST /chat - Чат з ботом`);
      console.log(`   - DELETE /chat/:sessionId - Видалення сесії`);
      console.log(`   - GET  /stats - Статистика сесій`);
      console.log('================================================');
      console.log('');
    });
  } catch (error) {
    console.error('❌ Критична помилка запуску:', error);
    process.exit(1);
  }
};

// Обробка сигналів завершення
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM отримано, завершення роботи...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT отримано, завершення роботи...');
  process.exit(0);
});

// Запуск
startServer();