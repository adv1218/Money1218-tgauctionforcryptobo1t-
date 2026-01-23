#  Crypto Auction - High-Load Auction System

> ** Видео-обзор:** [Смотреть на YouTube](https://youtu.be/YNWJzRTDirQ)
> 
> ** Live Demo:** [http://77.232.142.119](http://77.232.142.119)

Высоконагруженная система аукционов для цифровых подарков (Telegram Stars).

## Архитектура

| Компонент | Производительность |
|-----------|-------------------|
| Node.js Cluster | 2 воркера на 2 CPU |
| Fastify | 2-3x быстрее Express |
| Rate Limiting | 1000 req/s API |
| MongoDB | Пул 10-50 соединений |
| Redis | Кэширование лидерборда |
| Bull Queue | Надёжная обработка раундов |
| Socket.io | Real-time обновления |

## 🐳 Запуск через Docker

### 1. Клонировать репозиторий

```bash
git clone https://github.com/adv1218/Money1218-tgauctionforcryptobo1t-.git
cd Money1218-tgauctionforcryptobo1t-
```

### 2. Создать файл `.env`

```bash
cp .env.example .env
```

Отредактировать `.env` при необходимости.

### 3. Запустить всё одной командой

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### 4. Проверить статус

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs app
```

### 5. Открыть в браузере

```
http://localhost
```

---

##  Нагрузочное тестирование

```bash
# Внутри контейнера или на сервере
API_BASE=http://localhost:3000/api npx tsx tests/load/concurrent.ts
```

**Результат:** 500-1000+ одновременных ставок без проблем.

---

##  Возможности

- Многораундовые аукционы с топ-N победителями
- Anti-sniping — продление при ставках в последние секунды  
- Заморозка средств и мгновенный возврат проигравшим
- WebSocket для real-time обновлений UI

---

## 📂 Структура

```
src/
├── cluster.ts   # Multi-worker mode
├── app.ts       # Fastify server
├── models/      # MongoDB schemas
├── services/    # Business logic
├── routes/      # API + Zod validation
├── jobs/        # Bull Queue
└── websocket/   # Socket.io

public/          # Frontend UI
```

---

*Backend Auction Challenge 2026*
