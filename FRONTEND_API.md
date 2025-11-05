# API для Фронтенду - Формат Відповіді Чат-Бота

## 📦 Структура Відповіді

Тепер чат-бот повертає товари у **структурованому форматі** для зручного відображення карточок.

### Приклад Відповіді

```json
{
  "response": "З радістю допоможу! Ось відмінні комплекси для зміцнення імунітету:",
  "sessionId": "uuid-session-id",
  "productsFound": 3,
  "relevanceCheck": {
    "isRelevant": true,
    "reason": "Пошук товарів"
  },
  "products": [
    {
      "id": "product-123",
      "title": "Вітаміни для імунітету, Immune Renew",
      "brand": "Now Foods",
      "price": "653 UAH",
      "article": "NOW-12345",
      "image": "https://vitahub.com.ua/image/catalog/tovary/now-foods/immune.jpg",
      "link": "https://vitahub.com.ua/travy-ta-gryby/gryby/kompleksy-dlya-imunitetu-z-grybamy/vitaminy-dlya-imunitetu-immune-renew-now-foods-grybnyj-imunomodulyator-90-vegetarianskyh-kapsul",
      "reason": "Цей комплекс на основі грибів та екстракту астрагалу підтримує захисні сили організму. Особливо корисний в період сезонних захворювань."
    },
    {
      "id": "product-456",
      "title": "Бета глюкан, Beta Glucan",
      "brand": "Jarrow Formulas",
      "price": "1579 UAH",
      "article": "JAR-67890",
      "image": "https://vitahub.com.ua/image/catalog/tovary/jarrow/beta-glucan.jpg",
      "link": "https://vitahub.com.ua/pidtrymka-organizmu/imunitet/beta-glyukan-3/beta-glyukan-beta-glucan-jarrow-formulas-imunna-pidtrymka-60-kapsul",
      "reason": "Джерело бета-глюканів, яке підтримує імунну систему завдяки натуральним компонентам."
    }
  ]
}
```

## 🎨 Формат Карточки Товару

### Структура Даних

| Поле | Тип | Опис |
|------|-----|------|
| `id` | string | Унікальний ID товару |
| `title` | string | Повна назва товару |
| `brand` | string | Бренд товару |
| `price` | string | Ціна з валютою (наприклад "653 UAH") |
| `article` | string | Артикул/SKU товару |
| `image` | string | URL зображення товару |
| `link` | string | URL сторінки товару на сайті |
| `reason` | string | Пояснення чому рекомендується цей товар (1-2 речення) |

## 📱 Рекомендований UI Дизайн Карточки

```
┌─────────────────────────────────────────────┐
│ ┌───────┐  Назва товару                     │
│ │ ФОТО  │  Ціна: 653 UAH                    │
│ │       │  Бренд: Now Foods                 │
│ └───────┘  Артикул: NOW-12345               │
│                                              │
│  Пояснення чому рекомендується цей товар.   │
│  Може бути 1-2 речення з описом переваг.    │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │    🛒 Перейти до товару              │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### HTML Приклад

```html
<div class="product-card">
  <div class="product-header">
    <img src="{image}" alt="{title}" class="product-image" />
    <div class="product-info">
      <h3 class="product-title">{title}</h3>
      <p class="product-price">{price}</p>
      <p class="product-meta">
        <span class="brand">{brand}</span> •
        <span class="article">Арт: {article}</span>
      </p>
    </div>
  </div>

  <p class="product-reason">{reason}</p>

  <a
    href="{link}"
    target="_blank"
    rel="noopener noreferrer"
    class="product-button"
  >
    🛒 Перейти до товару
  </a>
</div>
```

### CSS Приклад

```css
.product-card {
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  background: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.product-header {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.product-image {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #f0f0f0;
}

.product-info {
  flex: 1;
}

.product-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 8px 0;
  line-height: 1.3;
}

.product-price {
  font-size: 18px;
  font-weight: 700;
  color: #2e7d32;
  margin: 0 0 4px 0;
}

.product-meta {
  font-size: 13px;
  color: #666;
  margin: 0;
}

.product-reason {
  font-size: 14px;
  line-height: 1.5;
  color: #444;
  margin: 12px 0;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 8px;
}

.product-button {
  display: block;
  width: 100%;
  padding: 12px;
  background: #4caf50;
  color: white;
  text-align: center;
  text-decoration: none;
  border-radius: 8px;
  font-weight: 600;
  transition: background 0.3s;
}

.product-button:hover {
  background: #45a049;
}
```

## 🔄 Обробка Відповіді на Фронтенді

### JavaScript/TypeScript

```typescript
interface ProductCard {
  id: string;
  title: string;
  brand: string;
  price: string;
  article: string;
  image: string;
  link: string;
  reason: string;
}

interface ChatResponse {
  response: string;
  sessionId: string;
  productsFound: number;
  products?: ProductCard[] | null;
}

async function sendMessage(message: string, sessionId?: string) {
  const response = await fetch('http://localhost:3000/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      sessionId,
    }),
  });

  const data: ChatResponse = await response.json();

  // Відображаємо текстове повідомлення
  displayMessage(data.response);

  // Якщо є товари - відображаємо карточки
  if (data.products && data.products.length > 0) {
    displayProductCards(data.products);
  }

  return data.sessionId;
}

function displayProductCards(products: ProductCard[]) {
  const container = document.getElementById('products-container');

  products.forEach(product => {
    const card = createProductCard(product);
    container.appendChild(card);
  });
}

function createProductCard(product: ProductCard): HTMLElement {
  const card = document.createElement('div');
  card.className = 'product-card';

  card.innerHTML = `
    <div class="product-header">
      <img src="${product.image}" alt="${product.title}" class="product-image" />
      <div class="product-info">
        <h3 class="product-title">${product.title}</h3>
        <p class="product-price">${product.price}</p>
        <p class="product-meta">
          <span class="brand">${product.brand}</span> •
          <span class="article">Арт: ${product.article}</span>
        </p>
      </div>
    </div>

    <p class="product-reason">${product.reason}</p>

    <a
      href="${product.link}"
      target="_blank"
      rel="noopener noreferrer"
      class="product-button"
    >
      🛒 Перейти до товару
    </a>
  `;

  return card;
}
```

## 🚨 Важливі Зауваження

1. **Перевірка наявності `products`**: Не всі відповіді містять товари (наприклад, вітання або запитання не про товари).

2. **Fallback на текстову відповідь**: Якщо `products` відсутні або null, показуйте тільки текстове повідомлення.

3. **Відкриття посилань**: Завжди відкривайте посилання на товари в новій вкладці (`target="_blank"`).

4. **Обробка помилок**: Перевіряйте чи фото завантажується, якщо ні - показуйте placeholder.

5. **Мобільна адаптація**: Карточки повинні адаптуватися під малі екрани.

## 📊 Приклади Різних Сценаріїв

### 1. Вітання (без товарів)
```json
{
  "response": "Вітаю! Я ваш консультант з вітамінів. Чим можу допомогти?",
  "sessionId": "uuid",
  "productsFound": 0,
  "relevanceCheck": { "isRelevant": true, "reason": "Вітання" },
  "products": null
}
```

### 2. Товари не знайдені
```json
{
  "response": "На жаль, не знайшов товарів за вашим запитом. Уточніть будь ласка.",
  "sessionId": "uuid",
  "productsFound": 0,
  "relevanceCheck": { "isRelevant": true },
  "products": []
}
```

### 3. Успішний пошук з товарами
```json
{
  "response": "Ось відмінні варіанти вітаміну D:",
  "sessionId": "uuid",
  "productsFound": 3,
  "relevanceCheck": { "isRelevant": true },
  "products": [ /* масив товарів */ ]
}
```

## 🔗 Корисні Посилання

- API Endpoint: `POST http://localhost:3000/chat`
- Health Check: `GET http://localhost:3000/health`
- Session Stats: `GET http://localhost:3000/stats`
