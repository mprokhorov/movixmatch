# Деплой MovixMatch на Firebase

Итог: приложение по адресу **https://movixmatch.web.app**, бесплатно (тариф Spark, без карты).
Займёт ~15 минут, нужен только компьютер.

## 1. Создай проект Firebase (в браузере)

1. Открой https://console.firebase.google.com → **Create a project** (Создать проект).
2. Название: `movixmatch`. Под полем видно **Project ID** — проверь, что там `movixmatch`.
   Если занят и Firebase предлагает `movixmatch-1a2b3` — ок, только запомни его (см. шаг 4).
3. Google Analytics можно выключить → **Create project**.

## 2. Включи вход и базу

1. Слева **Build → Authentication** → **Get started** → вкладка **Sign-in method** → **Anonymous** → включить → **Save**.
2. Слева **Build → Firestore Database** → **Create database**:
   - Location: `eur3 (europe-west)` — ближе к нам. Поменять потом нельзя.
   - Режим: **Start in production mode** (правила доступа зальются из репозитория).

## 3. Возьми конфиг веб-приложения

1. Шестерёнка слева сверху → **Project settings** → внизу **Your apps** → иконка **`</>`** (Web).
2. Nickname: `movixmatch`, галочку Hosting можно не ставить → **Register app**.
3. Появится блок `const firebaseConfig = { ... }`. Скопируй значения в файл
   **`public/firebase-config.js`** (или просто пришли их мне — я вставлю и запушу).
   Эти ключи не секретные, данные защищают правила `firestore.rules`.

## 4. Залей (на компьютере)

Нужен Node.js — скачай LTS с https://nodejs.org, если ещё нет.

```bash
git clone https://github.com/mprokhorov/movixmatch.git
cd movixmatch
npm install -g firebase-tools
firebase login
firebase deploy
```

- `firebase login` откроет браузер — войди тем же Google-аккаунтом.
- Если Project ID получился не `movixmatch`, перед deploy выполни `firebase use --add` и выбери свой проект.
- На macOS при ошибке прав в `npm install -g` — запусти с `sudo` или используй `npx firebase-tools deploy`.

В конце будет строка `Hosting URL: https://movixmatch.web.app` — готово.

## 5. Пользуйся

1. Открой https://movixmatch.web.app на телефоне → введи имя → **Создать пару**.
2. Во вкладке «Пара» → **Отправить** ссылку-приглашение своей половинке.
3. Поставь на главный экран: iPhone — Safari → «Поделиться» → «На экран „Домой“»;
   Android — меню Chrome → «Установить приложение».

## Обновления

```bash
git pull
firebase deploy
```

Открытое приложение подтянет новую версию после перезапуска.

## Если что-то не так

| Симптом | Что сделать |
|---|---|
| «Firebase ещё не подключён» | Не заполнен `public/firebase-config.js` → заполни и `firebase deploy` |
| «Нет доступа» при создании пары | Не включён Anonymous (шаг 2.1) или не залились правила: `firebase deploy --only firestore:rules` |
| `auth/configuration-not-found` в консоли | Не включён Anonymous вход (шаг 2.1) |
| После обновления старая версия | Закрой приложение полностью и открой снова |

## Локальная разработка (по желанию)

Нужна Java 11+. Запускает эмуляторы Firebase с теми же правилами, реальный проект не трогается:

```bash
npm run dev
```

Открой http://127.0.0.1:5000 — приложение само подключится к эмуляторам.
