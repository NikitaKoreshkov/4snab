# Интерфейс зав. склада + amoCRM

Веб-инструмент для заведующего складом. Работает поверх amoCRM: диспетчер
переводит сделку на этап «Отгрузка» → создаётся связанная сделка в воронке
«Склад» → зав. склада заполняет цену, доставку и бюджет в этом приложении →
данные пишутся обратно в amoCRM, сделка переходит на «Готово».

## Стек

- Next.js 16 (App Router), TypeScript, Tailwind
- amoCRM API v4 (долгосрочный токен, хранится только в env на сервере)
- Деплой: Vercel

## Запуск локально

```bash
npm install
cp .env.local.example .env.local   # заполнить значения
npm run discover                    # вывести ID воронок / этапов / полей
# перенести нужные ID в .env.local
npm run dev
```

Открыть `http://localhost:3000/s/<токен-из-WAREHOUSE_USERS>`.

## Переменные окружения

См. `.env.local.example`. Обязательные для старта: `AMOCRM_SUBDOMAIN`,
`AMOCRM_ACCESS_TOKEN`. Остальные ID заполняются после `npm run discover`.

## Вебхук amoCRM

В настройках amoCRM добавить вебхук на событие **«Смена этапа сделки»**:

```
URL: https://<домен>/api/amo-webhook?secret=<AMOCRM_WEBHOOK_SECRET>
```

Приложение реагирует только на переход в воронке диспетчера
(`AMOCRM_DISPATCH_PIPELINE_ID`) на этап `AMOCRM_DISPATCH_SHIPPING_STATUS_ID`.

## Структура

```
src/lib/amocrm.ts     — клиент amoCRM API
src/lib/env.ts        — переменные окружения
src/lib/auth.ts       — именные ссылки зав. склада
src/lib/requests.ts   — доменный слой (сделка ⇄ заявка на отгрузку)
src/app/api/amo-webhook/route.ts   — приём вебхука
src/app/s/[token]/                 — интерфейс зав. склада
scripts/discover.mjs  — вывод ID из amoCRM
```

## Что ещё не сделано

- Загрузка накладной и фото подписанной накладной (amoCRM Files API)
- Уведомления зав. складу о новой заявке (Wazzup)
- Отчёт «Табель отгрузки» (Excel, прибыль по каждой отгрузке)
- Поддержка нескольких рейсов в одной заявке
