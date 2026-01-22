# Crypto Auction v2.0

> **🎥 DEMO VIDEO:** [Смотреть демонстрацию работы](https://youtu.be/YNWJzRTDirQ)
 DEMO SITE = https://money1218-tgauctionforcryptobo1t-96hv.onrender.com

- **Fastify** 2-3x быстрее
- **Zod** — строгая валидация всех входных данных
- **Bull Queue** — надёжная обработка раундов вместо polling
- **Socket.io** — real-time обновления для UI
- **Rate Limiting** — защита от спама ставок

## Быстрый старт

### Требования
- Node.js 18+
- MongoDB
- Redis 

### 1. Установка

```bash
npm install
```

### 2. Настройка окружения

```bash
cp .env.example .env
```

Отредактируйте `.env`:

```env
PORT=3000
MONGODB_URI=mongodb+srv://asadveot_db_user:Asat1234@cluster0.2mfxhco.mongodb.net/?appName=Cluster0
REDIS_URL=rediss://default:AX1qAAIncDJlMDJhOTlmODIxNjI0YmE5YWE0MTgyYzBhZTQ2MjU4NHAyMzIxMDY@loyal-skylark-32106.upstash.io:6379
NODE_ENV=development
```

### 3. Запуск

```bash
npm run dev
```

Открыть http://localhost:3000

---

##  Возможности

- **Многораундовые аукционы** — каждый раунд топ-N получают подарки
- **Гибкие настройки** — количество победителей, длительность раундов, минимальная ставка
- **Anti-sniping** — продление раунда при ставках в последние секунды
- **Заморозка средств** — безопасная обработка ставок
- **Мгновенный возврат** — проигравшие получают средства обратно
- **Real-time обновления** — WebSocket для мгновенных обновлений UI

##  Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| PORT | Порт сервера | 3000 |
| MONGODB_URI | MongoDB connection string | — |
| REDIS_URL | Redis connection string | — |
| NODE_ENV | development / production | development |

## Механика аукциона

### Раунды и победители

1. Аукцион создаётся с параметрами:
   - **Количество подарков** (например, 500)
   - **Количество раундов** (например, 5)
   - **Победителей в раунде** (например, топ-100)
   - **Минимальная ставка** (например, 1000)

2. После окончания раунда:
   - **Топ-N** → получают подарки (#1, #2, ...)
   - **Остальные** → полный возврат средств

3. Каждый раунд — **новые ставки**, новый рейтинг

### Ставки

- Минимум = значение `minBid` аукциона (валидируется через Zod)
- Можно повысить ставку (добавляется к текущей)
- Средства замораживаются до конца раунда

### Anti-sniping

- Ставка в топ-3 за последние 30 секунд → таймер +30 сек
- Предотвращает "снайперские" ставки в последний момент
- Автоматически перепланирует обработку раунда в Bull Queue

## WebSocket Events

### Client → Server
| Event | Payload | Описание |
|-------|---------|----------|
| `join:auction` | `auctionId` | Подписаться на обновления аукциона |
| `leave:auction` | `auctionId` | Отписаться от аукциона |

### Server → Client
| Event | Payload | Описание |
|-------|---------|----------|
| `bid:new` | `{ rank, amount, userId, totalBids }` | Новая ставка |
| `leaderboard:update` | `[{ rank, userId, username, amount }]` | Обновление топа |
| `timer:antiSnipe` | `{ newEndAt, extension }` | Таймер продлён |
| `round:end` | `{ roundNumber, winnersCount }` | Раунд завершён |
| `round:start` | `{ roundNumber, endAt, winnersCount }` | Новый раунд |
| `auction:complete` | `{ auctionId }` | Аукцион завершён |

##  API

### Пользователи

| Метод | Путь | Описание |
|-------|------|----------|
| POST | /api/users/login | Вход/регистрация |
| GET | /api/users/me | Профиль |
| POST | /api/users/me/deposit | Пополнить баланс |
| GET | /api/users/me/wins | Мои подарки |

### Аукционы

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /api/auctions | Список аукционов |
| GET | /api/auctions/:id | Детали аукциона |
| POST | /api/auctions | Создать аукцион |
| POST | /api/auctions/:id/bid | Сделать ставку |
| GET | /api/auctions/:id/my-bid | Моя ставка |
| GET | /api/auctions/:id/leaderboard | Топ ставок |

### Health Check

| Метод | Путь | Описание |
|-------|------|----------|
| GET | /api/health | Статус сервера |

## Структура проекта

```
src/
├── config/      # Database, Redis, environment
├── models/      # Mongoose schemas (User, Auction, Bid, Transaction)
├── services/    # Business logic (AuctionService, BidService, BalanceService)
├── controllers/ # HTTP handlers (legacy, migrating to routes/api.ts)
├── routes/      # Fastify API routes with Zod validation
├── schemas/     # Zod validation schemas
├── middleware/  # Auth, error handling
├── jobs/        # Bull Queue processors (queues.ts)
├── websocket/   # Socket.io integration
└── utils/       # Redis locks

public/
├── index.html   # SPA entry point
├── css/         # Telegram-style дизайн (glassmorphism)
└── js/          # Frontend app (vanilla JS)

tests/
└── load/        # Load testing scripts
```

##  Тестирование

```bash
# 50 одновременных ставок (concurrent load test)
npm run test:concurrent


# Боты с постоянными ставками (anti-sniping тест)
npm run test:load
```

## 🛠 Технологии

| Категория | Технология |
|-----------|------------|
| Runtime | Node.js + TypeScript (ES modules) |
| Web Framework | **Fastify** (was Express) |
| Validation | **Zod** |
| Database | MongoDB + Mongoose |
| Cache/Queues | Redis + **Bull Queue** |
| Real-time | **Socket.io** |
| Frontend | Vanilla JS |

## Безопасность

- **Rate Limiting** — 100 req/min общий, 30 req/min на ставки
- **Zod Validation** — все входные данные валидируются
- **MongoDB Transactions** — финансовая целостность (при наличии Replica Set)
- **Redis Distributed Locks** — защита от race conditions

---

*Создано для Backend Auction Challenge 2026*
