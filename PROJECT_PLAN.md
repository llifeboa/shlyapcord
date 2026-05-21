# Shlyapcord Project Plan

## Цель

Сделать web-приложение для голосового общения через браузер.

На первом этапе приложение должно поддерживать:

- доступ по заранее созданной ссылке-приглашению;
- ввод имени при входе;
- одну централизованную серверную точку;
- голосовое общение через WebRTC;
- запуск всего проекта через Docker.

## Модель доступа

Доступ должен происходить по ссылке, а не через ручной ввод токена.

Пример ссылки:

```text
https://example.com/invite/{uuid}
```

или:

```text
https://example.com/?invite={uuid}
```

Пользователь открывает ссылку, видит форму регистрации или входа и работает только в рамках валидного invite.
Сервер проверяет invite-токен из ссылки и, если он валиден, разрешает регистрацию или авторизацию.

На MVP-этапе invite-токены можно хранить в конфигурации сервера или `.env`.
Позже можно добавить базу данных, срок действия ссылок, лимиты участников и админ-панель.

## Рекомендуемый стек

- Frontend: React, Vite, TypeScript
- Backend: Java, Spring Boot
- Build tool: Gradle или Maven
- Realtime signaling: Spring WebSocket
- Auth: Spring Security, JWT access tokens, long-lived refresh tokens
- Database: PostgreSQL для пользователей, refresh-токенов, аватарок и пользовательских настроек
- DB migrations: Liquibase YAML
- Voice: WebRTC
- Containerization: Docker, Docker Compose
- Reverse proxy: nginx или Caddy
- TURN-сервер для стабильной работы через интернет: coturn

## Регистрация и авторизация

Целевая модель доступа меняется с временного входа по имени на полноценную регистрацию и авторизацию. Регистрация и авторизация доступны только через invite-ссылку.

### Общий flow

1. Пользователь открывает invite-ссылку `/invite/{token}`.
2. Frontend проверяет invite-токен на backend.
3. Если invite невалиден, показывается `403 Forbidden`.
4. Если в браузере уже есть валидный access token, пользователь автоматически попадает в основное приложение. Для уже авторизованной сессии invite больше не нужен.
5. Если access token отсутствует или истек, но есть валидный refresh token в cookie, frontend обновляет access token и переводит пользователя в приложение. Refresh тоже не требует invite.
6. Если токенов нет, пользователь видит форму регистрации/входа для данного invite.
7. При регистрации пользователь вводит:
   - login;
   - password;
   - repeated password;
   - nickname, опционально.
8. Если nickname пустой, backend сохраняет nickname равным login.
9. После успешной регистрации пользователь автоматически переходит на экран входа.
10. После входа пользователь получает access token и refresh token.
11. Дальше REST API и WebSocket работают с JWT, а не с invite token + name.

### Ограничения полей

`login`:

- обязательный;
- длина от 1 до 50 символов;
- допустимы только латинские буквы, цифры, `_`, `-`;
- case-insensitive;
- перед сохранением приводится к lowercase;
- должен быть уникальным после приведения к lowercase.

`nickname`:

- необязательный;
- длина от 1 до 50 символов, если заполнен, любые символы;
- перед сохранением делается `trim`;
- пустая строка после `trim` считается незаполненным nickname;
- если пустой, используется `login`;
- отображается в интерфейсе вместо login.

`password`:

- обязательный;
- длина от 6 до 128 символов;
- должен совпадать с repeated password;
- хранится только в виде password hash, исходный пароль не сохраняется.

`id`:

- UUID;
- генерируется backend при создании пользователя.

### Хранение паролей

Пароль должен храниться не в зашифрованном обратимо виде, а как необратимый hash.

Рекомендуемый вариант:

- BCrypt через Spring Security `PasswordEncoder`;
- поле в базе: `passwordHash`;
- сравнение пароля только через `passwordEncoder.matches(rawPassword, passwordHash)`.

### Токены

Access token:

- JWT;
- подпись JWT: RSA;
- приватный ключ хранится только на backend и передается через env/secret, публичный ключ используется для проверки токена внутри backend;
- короткоживущий, срок жизни 15 минут;
- используется для REST API и WebSocket auth;
- содержит минимум `sub=userId`, `sessionId`, `login`, `nickname`, `iat`, `exp`;
- `sessionId` нужен, чтобы новый login мог сразу инвалидировать старое устройство и старое WebSocket-подключение.

Refresh token:

- долгоживущий, срок жизни 1 год;
- должен храниться на сервере в базе в виде HMAC-SHA256 hash;
- raw token должен быть криптографически случайным opaque-токеном, не JWT;
- raw refresh token передается клиенту только через `HttpOnly Secure SameSite=Strict` cookie;
- refresh token не возвращается в JSON-ответах;
- используется для получения нового access token;
- должен быть отзываемым;
- один refresh token живет до 1 года, rotation на каждый refresh не делаем;
- на первом этапе разрешено только одно устройство на пользователя, новый login отзывает предыдущий refresh token пользователя;
- новый login должен сразу закрывать старое активное WebSocket-подключение этого пользователя.

Рекомендуемая схема хранения на клиенте:

- access token: memory ;
- REST API получает access token через заголовок `Authorization: Bearer <accessToken>`;
- refresh token: `HttpOnly Secure SameSite=Strict` cookie;

Cookie mode:

- production: `Secure=true`;
- local dev over plain `http://localhost`: `Secure=false`;
- если local dev запускается через HTTPS, можно использовать `Secure=true`.
- refresh cookie `Path=/api/auth`;
- refresh cookie не должна отправляться на статику, avatar endpoints и WebSocket.

CSRF:

- для MVP отдельный CSRF token не добавляем;
- защита опирается на `SameSite=Strict`, JSON API и отсутствие cross-site сценариев;
- при появлении внешних интеграций или embedded-клиентов нужно пересмотреть CSRF-защиту.

### Invite-only auth

Регистрация и вход должны требовать invite token.

Правила:

- `POST /api/auth/register` принимает invite token;
- `POST /api/auth/login` принимает invite token;
- без invite token регистрация и вход возвращают `403 Forbidden`;
- с битым invite token регистрация и вход возвращают `403 Forbidden`;
- WebSocket больше не принимает произвольное имя, а принимает JWT access token.
- обычный login/password без invite не поддерживается;
- уже авторизованный пользователь может открыть основное приложение без invite, если access token или refresh cookie валидны.


- invite многоразовый;
- invite token на MVP хранится в `.env`/конфигурации backend, таблицу invite-ссылок пока не добавляем;
- нужно ли ограничивать количество зарегистрированных пользователей на один invite - нет;
- нужно ли привязывать пользователя к invite, по которому он зарегистрировался - нет;
- можно ли уже зарегистрированному пользователю входить без invite на обычном `/login`, или строго только через `/invite/{token}` - login/password только через invite, но уже существующая валидная сессия может открывать приложение без invite.

Для текущего требования считаем: регистрация и login/password авторизация только через invite-ссылку; продолжение уже валидной сессии invite не требует.

### Backend API

Планируемые endpoint'ы:

```text
GET  /api/invites/{token}
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
```

`POST /api/auth/register`:

```json
{
  "inviteToken": "local-dev",
  "login": "ilya",
  "nickname": "Ilya",
  "password": "secret",
  "passwordRepeat": "secret"
}
```

`POST /api/auth/login`:

```json
{
  "inviteToken": "local-dev",
  "login": "ilya",
  "password": "secret"
}
```

Успешный ответ login/register:

```json
{
  "accessToken": "...",
  "user": {
    "id": "uuid",
    "login": "ilya",
    "nickname": "Ilya"
  }
}
```

Refresh token при этом выставляется отдельным `Set-Cookie` заголовком с `HttpOnly`, `Secure`, `SameSite=Strict`, сроком жизни 1 год.

### WebSocket auth

Текущий `auth.join` должен быть заменен.

Новый вариант:

- frontend открывает WebSocket;
- первым сообщением отправляет `auth.token` с access token;
- backend валидирует JWT;
- backend проверяет `sessionId` из JWT;
- backend создает online-сессию для userId из JWT;
- публичное имя берется из `nickname`.

Пример:

```json
{
  "type": "auth.token",
  "payload": {
    "accessToken": "..."
  }
}
```

Access token живет 15 минут, поэтому WebSocket должен поддерживать обновление auth.

WebSocket refresh flow:

- frontend периодически вызывает REST `POST /api/auth/refresh`;
- при access token TTL 15 минут frontend обновляет токен примерно на 12-й минуте, за 3 минуты до истечения;
- backend обновляет access token на основании refresh cookie;
- frontend отправляет новый access token в WebSocket сообщением `auth.refresh`;
- backend валидирует новый JWT и продлевает WebSocket auth-состояние;
- если клиент не прислал валидный `auth.refresh` до истечения текущего access token, backend закрывает WebSocket.

Пример:

```json
{
  "type": "auth.refresh",
  "payload": {
    "accessToken": "..."
  }
}
```

Если пользователь логинится на другом устройстве, backend отзывает старую session_id и закрывает старое WebSocket-подключение.

WebSocket close/error reasons должны быть различимыми на frontend:

- access token expired;
- user disabled;
- logged in from another device;
- auth failed.

Старый сценарий `auth.join` с invite token + name нужно удалить после миграции frontend.

### Список пользователей

Список пользователей остается в правой колонке, где он находится сейчас.

После добавления постоянных аккаунтов frontend должен показывать всех зарегистрированных пользователей, а не только активные WebSocket-сессии.

Текущий пользователь тоже отображается в правом списке.

Статусы в списке пользователей:

- `online` - пользователь авторизован и имеет активное WebSocket-подключение;
- `offline` - пользователь зарегистрирован, но сейчас не подключен;
- `inVoice` - пользователь online и находится в голосовой комнате.

`muted` не является общим статусом пользователя в правом списке. Это состояние участника голосовой комнаты и может отображаться только в voice-контексте, например рядом с пользователем внутри голосового канала.

Рекомендуемая сортировка:

- правый список разделен на секции как в Discord;
- секция `Online - N`;
- секция `Offline - N`;
- внутри `Online` сначала пользователи `inVoice`, затем остальные online;
- внутри `Offline` пользователи визуально приглушены.

Для online пользователей можно показывать дополнительную строку состояния, например `В голосовой комнате`, если пользователь сейчас находится в voice room.

### Модели данных

`users`:

- `id uuid primary key`
- `login varchar(50) unique not null`
- `nickname varchar(50) not null`
- `password_hash text not null`
- `avatar_updated_at timestamp null`
- `created_at timestamp not null`
- `updated_at timestamp not null`
- `disabled boolean not null default false`

Disabled-пользователь не может пользоваться приложением:

- `/api/auth/login` возвращает отказ;
- `/api/auth/refresh` возвращает отказ и очищает refresh cookie;
- `/api/auth/me` возвращает отказ;
- WebSocket `auth.token` возвращает отказ.

`refresh_tokens`:

- `id uuid primary key`
- `user_id uuid not null`
- `session_id uuid not null`
- `token_hash text not null`
- `created_at timestamp not null`
- `expires_at timestamp not null`
- `revoked_at timestamp null`
- `user_agent text null`
- `ip_address text null`

Для MVP у пользователя может быть только один активный refresh token. Новый успешный login отзывает предыдущий активный refresh token этого пользователя.

`session_id` попадает в access token. Backend проверяет, что session_id не отозван:

- при `/api/auth/refresh`;
- при `/api/auth/me`;
- при WebSocket `auth.token`;
- при WebSocket `auth.refresh`.

Если пользователь `disabled=true`, backend отказывает на следующем refresh, `/me` или WebSocket reconnect/auth. Мгновенно закрывать уже активную сессию при disable на MVP не требуется.

`user_avatars`:

- `user_id uuid primary key`
- `content_type text not null`
- `data bytea not null`
- `size_bytes integer not null`
- `animated boolean not null default false`
- `created_at timestamp not null`
- `updated_at timestamp not null`

`user_settings`:

- `user_id uuid primary key`
- `ui_sound_volume integer not null default 200`
- `noise_mode text not null default 'rnnoise'`
- `updated_at timestamp not null`

`user_voice_volumes`:

- `owner_user_id uuid not null`
- `target_user_id uuid not null`
- `volume_percent integer not null`
- `updated_at timestamp not null`
- `primary key (owner_user_id, target_user_id)`

На первом этапе invites остаются в `.env`/конфигурации backend, но для регистрации пользователей нужна постоянная база данных.

### Пользовательские настройки

После появления постоянных аккаунтов настройки пользователя должны храниться на backend, а не только в `localStorage`.

Хранимые настройки:

- громкость UI-звуков;
- выбранный режим шумоподавления;
- индивидуальная громкость других пользователей.

Индивидуальная громкость хранится по стабильным userId:

- `owner_user_id` - пользователь, который настраивает;
- `target_user_id` - пользователь, чью громкость меняют;
- `volume_percent` - громкость для этого target.

Планируемые endpoint'ы:

```text
GET /api/settings
PUT /api/settings
GET /api/settings/voice-volumes
PUT /api/settings/voice-volumes/{targetUserId}
DELETE /api/settings/voice-volumes/{targetUserId}
```

UX-правило для громкости участников:

- frontend применяет изменение громкости сразу локально;
- сохранение на backend делается debounce'ом 300-500 мс;
- при открытии приложения frontend загружает настройки и применяет их до подключения remote audio, насколько это возможно.

### Настройки профиля

В приложении должен быть раздел настроек профиля, доступный из текущей кнопки настроек в нижней левой панели.

Профильные настройки:

- смена nickname;
- загрузка/смена аватарки;
- удаление аватарки.

Nickname:

- редактируется отдельно от login;
- проходит те же правила `trim`, длина 1-50, пустое значение заменяется login;
- после сохранения обновляется в правом списке пользователей, voice-канале и текущей пользовательской панели.

Avatar:

- загрузка запускает Discord-like crop modal;
- после подтверждения frontend отправляет avatar payload на backend;
- после успешного сохранения frontend обновляет avatar URL/version без hard refresh;
- удаление avatar возвращает пользователя к дефолтной букве/цвету.

Планируемые endpoint'ы профиля:

```text
GET /api/me
PATCH /api/me/profile
GET /api/users/{userId}/avatar
PUT /api/me/avatar
DELETE /api/me/avatar
```

`PATCH /api/me/profile`:

```json
{
  "nickname": "New Nick"
}
```

После изменения профиля backend должен разослать realtime-событие, чтобы другие клиенты обновили отображение пользователя без перезахода.

WebSocket event:

```json
{
  "type": "user.updated",
  "payload": {
    "user": {
      "id": "uuid",
      "nickname": "New Nick",
      "avatarUpdatedAt": "..."
    }
  }
}
```

### Аватарки

Аватарки нужно заложить сразу вместе с постоянными аккаунтами.

MVP-решение:

- аватарка хранится в базе в отдельной таблице `user_avatars`;
- в `users` хранится только `avatar_updated_at` для cache busting;
- backend хранит уже обработанное изображение, а не исходный файл;
- формат хранения для статичных аватарок: `webp`;
- формат хранения для анимированных аватарок: animated `webp`, если pipeline поддерживает; иначе optimized `gif`;
- размер хранения: `256x256`;
- `64x64` thumbnail на первом этапе можно не хранить отдельно, frontend может использовать тот же `256x256`;
- max upload исходного изображения: 10 MB;
- max upload animated avatar: 10 MB;
- max stored avatar after processing: 5 MB;
- допустимые исходные форматы: `jpg`, `png`, `webp`, `gif`.

UX редактирования должен быть похож на Discord:

- пользователь выбирает изображение;
- frontend открывает modal `Edit Image`;
- внутри модалки показывается preview с круглой crop-зоной;
- пользователь может двигать изображение и менять zoom slider'ом;
- frontend отправляет файл и crop-параметры на backend;
- backend одинаково обрабатывает статичные и animated avatar через один upload API.

Для анимированных аватарок frontend не должен пытаться кропать GIF через обычный canvas, потому что canvas сохранит только первый кадр.

Avatar upload API:

- формат запроса: `multipart/form-data`;
- поле `file` - исходный файл;
- поля crop: `cropX`, `cropY`, `cropSize`, `zoom`;
- backend валидирует файл и crop-параметры;
- backend кропает и ресайзит изображение до `256x256`.

Animated avatar flow:

- frontend показывает crop UI по первому кадру/preview;
- frontend отправляет backend исходный animated файл и crop параметры через общий avatar upload API;
- backend кропает и ресайзит все кадры;
- backend оптимизирует результат;
- backend сохраняет animated `webp` или optimized `gif`;
- если итоговый файл после обработки больше 5 MB, backend возвращает ошибку;
- если обработка анимации не удалась, backend возвращает ошибку, а не молча превращает avatar в статичный.

Backend должен:

- проверить размер payload;
- проверить content type;
- для статичных изображений повторно валидировать/перекодировать изображение;
- для animated avatar обработать все кадры через серверный image pipeline;
- сохранить avatar binary в `user_avatars`;
- обновить `users.avatar_updated_at`;
- отдавать аватарку через endpoint с cache-control и версией по `avatar_updated_at`.

`users.list` и другие realtime-события не должны передавать `avatar_data`.
В публичной модели пользователя передаются только:

- `id`;
- `nickname`;
- `online`;
- `inVoice`;
- `avatarUpdatedAt`;
- avatar URL вида `/api/users/{userId}/avatar?v={avatarUpdatedAt}`.

`login` не передается другим пользователям и доступен только самому пользователю через `/api/auth/me` или `/api/me`.

Backend image pipeline:

- используем ImageMagick в Docker image;
- backend вызывает ImageMagick для crop/resize/optimization статичных и animated avatar;
- обработка ImageMagick должна иметь timeout и resource limits, чтобы тяжелые animated avatar не могли подвесить backend;
- animated WebP/GIF processing считается частью MVP для аватарок.

Планируемые endpoint'ы:

```text
GET /api/users/{userId}/avatar
PUT /api/me/avatar
DELETE /api/me/avatar
```

В будущем, если аватарок станет много, хранение можно вынести из БД в Docker volume, S3-compatible storage или CDN, а в `users` оставить только `avatar_url` и `avatar_version`.

## Архитектура MVP

Приложение состоит из трех основных частей:

- `web` - frontend-приложение;
- `server` - Java backend API и WebSocket signaling;
- `turn` - TURN/STUN сервер, можно подключить после базового прототипа.

Backend отвечает за:

- проверку invite-ссылки;
- регистрацию и авторизацию пользователя по invite-ссылке;
- выпуск и проверку JWT access token;
- выпуск, хранение и отзыв refresh token;
- хранение текущих подключений;
- список пользователей онлайн;
- состояние голосовой комнаты;
- обмен WebRTC signaling-сообщениями между клиентами.

Аудиопоток на MVP-этапе идет напрямую между браузерами через WebRTC mesh.
Сервер не передает аудио, а только помогает клиентам установить соединение.

## Backend на Java

Рекомендуемая база для MVP:

- Java 21;
- Spring Boot 3;
- Spring Web;
- Spring WebSocket;
- Liquibase YAML для миграций схемы БД;
- Jackson для JSON-сообщений;
- PostgreSQL-хранилище для пользователей, refresh-токенов, аватарок, настроек и индивидуальных громкостей;
- invite-ссылки на первом этапе хранятся в `.env`/конфигурации backend;
- in-memory состояние онлайн-сессий и комнат.

На MVP-этапе лучше использовать простой WebSocket-протокол с JSON-сообщениями.
STOMP можно добавить позже, если появится необходимость в topic-based messaging и более формальной маршрутизации событий.

Пример серверных модулей:

- `InviteService` - проверка invite-токенов;
- `UserSessionService` - активные пользователи и WebSocket-сессии;
- `VoiceRoomService` - состояние голосовой комнаты;
- `SignalingHandler` - прием и пересылка WebRTC offer, answer и ICE candidates;
- `HealthController` - healthcheck для Docker.

## Основные сущности

### Invite

- `token`
- `name`
- `enabled`
- `expiresAt`, опционально
- `maxUsers`, опционально

### UserAccount

- `id`
- `login`
- `nickname`
- `passwordHash`
- `createdAt`
- `updatedAt`
- `disabled`

### UserPresence

- `userId`
- `online`
- `inVoice`

### VoiceParticipant

- `userId`
- `muted`

### Room

- `id`
- `name`
- `users`

Для первой версии достаточно одной общей комнаты `main`.

## Основные пользовательские сценарии

1. Пользователь открывает invite-ссылку.
2. Frontend извлекает invite-токен из URL.
3. Если есть валидные токены, frontend автоматически переводит пользователя в основное приложение.
4. Если токенов нет, пользователь регистрируется или входит по login/password.
5. Backend проверяет invite-токен, login/password и выдает access token + refresh token.
6. Frontend сохраняет токены и подключается к WebSocket с JWT access token.
7. Пользователь видит список участников.
8. Пользователь входит в голосовую комнату.
9. Браузер запрашивает доступ к микрофону.
10. Клиенты обмениваются WebRTC offer, answer и ICE candidates через сервер.
11. Пользователи слышат друг друга.

## WebSocket сообщения

Минимальный набор сообщений:

- `auth.token` - WebSocket-аутентификация по JWT access token;
- `users.list` - список пользователей онлайн;
- `voice.join` - вход в голосовую комнату;
- `voice.leave` - выход из голосовой комнаты;
- `voice.mute` - изменение состояния микрофона;
- `webrtc.offer` - WebRTC offer для другого клиента;
- `webrtc.answer` - WebRTC answer для другого клиента;
- `webrtc.iceCandidate` - ICE candidate для другого клиента;
- `user.joined` - новый пользователь подключился;
- `user.left` - пользователь отключился.

Пример JSON-обертки:

```json
{
  "type": "webrtc.offer",
  "targetUserId": "user-2",
  "payload": {
    "sdp": "..."
  }
}
```

## Docker структура

Планируемая структура репозитория:

```text
Shlyapcord/
├─ apps/
│  ├─ server/
│  └─ web/
├─ docker/
│  └─ nginx/
├─ docker-compose.yml
├─ .env.example
├─ PROJECT_PLAN.md
└─ README.md
```

Планируемые сервисы:

- `server` - Java backend API и WebSocket signaling;
- `web` - frontend build;
- `proxy` - nginx или Caddy как единая точка входа;
- `turn` - coturn, нужен для надежной работы WebRTC через интернет.

## Этапы разработки

### Этап 1: Базовый каркас

- Создать структуру проекта.
- Настроить Docker Compose.
- Добавить Java backend-сервис.
- Добавить frontend-сервис.
- Добавить healthcheck endpoint на backend.

### Этап 2: Доступ по ссылке

- Добавить invite-токены в конфигурацию backend.
- Реализовать страницу регистрации и входа по invite-ссылке.
- Проверять invite-токен на сервере.
- Создавать постоянного пользователя при регистрации.
- Выдавать JWT access token и refresh token после входа.
- Автоматически переводить пользователя в основное приложение при наличии валидного токена.

### Этап 2.1: Постоянная авторизация

Реализацию нужно делать инкрементами, чтобы каждый шаг можно было отдельно собрать, проверить и при необходимости раскатить.

#### Шаг 2.1.1: PostgreSQL и миграции

- Добавить PostgreSQL в Docker Compose.
- Добавить подключение backend к PostgreSQL через env.
- Подключить Liquibase YAML.
- Добавить Liquibase migrations для `users` и `refresh_tokens`.
- Добавить Liquibase migrations для `user_avatars`.
- Добавить Liquibase migrations для `user_settings` и `user_voice_volumes`.
- Добавить `avatar_updated_at` в `users`.
- Проверить старт backend на пустой БД и повторный старт без повторного применения миграций.

#### Шаг 2.1.2: Backend auth domain

- Добавить Spring Security и `PasswordEncoder`.
- Реализовать модели, repository и service для `users`.
- Реализовать модели, repository и service для `refresh_tokens`.
- Реализовать проверку invite token из `.env`/конфигурации backend.
- Реализовать RSA-подпись JWT access token.
- Хранить refresh token в БД как HMAC-SHA256 hash.
- Добавить `sessionId` в access token и refresh token storage.
- Запретить login, refresh и `/me` для `disabled=true`.

#### Шаг 2.1.3: REST auth API

- Реализовать `AuthController` и `AuthService`.
- Реализовать регистрацию по invite-ссылке.
- Реализовать login по invite-ссылке.
- Реализовать refresh access token через долгоживущий refresh token сроком 1 год.
- Реализовать refresh token через `HttpOnly Secure SameSite=Strict` cookie.
- Реализовать logout с отзывом только текущего refresh token.
- Ограничить пользователя одним активным устройством: новый login отзывает предыдущий refresh token.
- Вернуть единообразные `403 Forbidden` для отсутствующего или битого invite token.
- Добавить backend tests для register/login/refresh/logout и disabled user.

#### Шаг 2.1.4: Frontend auth screens

- Реализовать страницу invite register/login.
- Добавить формы login/password/password repeat/nickname.
- Валидировать login, password и nickname на frontend.
- После регистрации переводить пользователя на экран входа.
- После login хранить access token в memory.
- REST API вызывать с `Authorization: Bearer <accessToken>`.
- Если есть валидный access token или refresh cookie, автоматически переводить пользователя в приложение.
- При невалидном invite показывать простой `403 Forbidden`.

#### Шаг 2.1.5: WebSocket auth migration

- Перевести WebSocket auth с `auth.join` на `auth.token`.
- При новом login сразу закрывать старое WebSocket-подключение пользователя.
- Реализовать WebSocket `auth.refresh`.
- Закрывать WebSocket, если access token истек и не был обновлен.
- Запретить WebSocket auth для `disabled=true`.
- Добавить различимые close/error reasons: `access token expired`, `user disabled`, `logged in from another device`, `auth failed`.
- Перевести frontend reconnect-flow на новую auth-модель.

#### Шаг 2.1.6: Постоянный список пользователей

- Backend должен отдавать всех пользователей `disabled=false`.
- В публичной модели не передавать `login`, только `id`, `nickname`, `online`, `inVoice`, `avatarUpdatedAt`.
- Frontend должен показывать правый список с секциями `Online - N` и `Offline - N`.
- Текущий пользователь тоже отображается в правом списке.
- `muted` показывать только в voice-контексте, не как общий статус пользователя.

#### Шаг 2.1.7: Backend settings

- Реализовать backend API для пользовательских настроек.
- Перевести UI sounds volume на backend-хранение.
- Перевести noise mode на backend-хранение.
- Перевести индивидуальную громкость участников на backend-хранение.
- Сохранять индивидуальную громкость участников debounce'ом 300-500 мс.
- При открытии приложения загружать настройки до подключения remote audio, насколько это возможно.

#### Шаг 2.1.8: Profile settings

- Реализовать профильные настройки: смена nickname.
- Реализовать upload/delete/get avatar API.
- Добавить ImageMagick в backend Docker image для обработки статичных и animated avatar с timeout и resource limits.
- Реализовать Discord-like crop modal для аватарки на frontend.
- Добавить загрузку, смену и удаление аватарки в настройках профиля.
- Добавить realtime-событие `user.updated` для обновления nickname/avatar у других клиентов.

#### Шаг 2.1.9: Cleanup и совместимость

- Удалить старый временный вход по имени.
- Удалить старый сценарий `auth.join` после миграции frontend.
- Проверить Docker build всех сервисов.
- Проверить локальный сценарий: register, login, refresh, reconnect, logout.
- Проверить сценарий с двумя браузерами: новый login выбивает старое подключение.
- Проверить production-сценарий через proxy/Caddy и secure cookie.

### Этап 3: Realtime состояние

- Подключить Spring WebSocket.
- Показывать список пользователей онлайн.
- Обрабатывать подключение и отключение пользователей.
- Добавить состояние `online`, `offline`, `inVoice`.
- `muted` хранить и показывать только как состояние участника голосовой комнаты.

### Этап 4: Голосовая комната

- Реализовать вход в одну общую voice room.
- Запрашивать доступ к микрофону.
- Передавать WebRTC signaling через backend.
- Поддержать голос между двумя пользователями.
- Расширить до нескольких пользователей через WebRTC mesh.

### Этап 5: Docker и локальный запуск

- Собрать frontend внутри Docker.
- Собрать Java backend внутри Docker.
- Запустить backend и frontend через Docker Compose.
- Добавить reverse proxy.
- Подготовить `.env.example`.
- Описать запуск в `README.md`.

### Этап 6: Стабильная работа через интернет

- Добавить STUN-конфигурацию.
- Добавить coturn в Docker Compose.
- Передавать ICE server config с backend на frontend.
- Проверить работу между разными сетями.

## Ограничения MVP

- Одна общая голосовая комната.
- Invite-ссылки задаются заранее в конфигурации.
- Регистрация и авторизация доступны только по invite-ссылке.
- Нет постоянного хранения истории.
- Нет текстового чата.
- Нет админ-панели.
- Нет записи аудио.

## Возможные улучшения после MVP

- Несколько комнат.
- Админ-панель для создания invite-ссылок.
- Срок действия invite-ссылок.
- Ограничение количества участников по ссылке.
- Роли пользователей.
- Текстовый чат.
- Push-to-talk.
- Deafen.
- Индикатор говорящего пользователя.
- Переход с WebRTC mesh на SFU: LiveKit, mediasoup или Janus.

## Техническая стратегия

Для первой версии стоит использовать WebRTC mesh, потому что это проще и быстрее для прототипа.
Такой подход хорошо подходит для малых комнат.

Если в будущем ожидаются большие комнаты, запись, модерация аудиопотока или более стабильная серверная маршрутизация медиа, нужно будет перейти на SFU.
Архитектуру backend и frontend стоит держать достаточно простой, чтобы позднее заменить mesh-логику на SFU без полной переделки приложения.
