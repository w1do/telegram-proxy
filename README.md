# Telegram API Proxy

Простой и эффективный прокси-сервер для Telegram Bot API, написанный на Python (FastAPI + httpx). Скрипт позволяет обходить сетевые ограничения, проксируя запросы к `api.telegram.org` через ваш собственный сервер с использованием HTTP/HTTPS прокси.

## 🚀 Возможности

- **Единый эндпоинт**: Обрабатывает любые методы Telegram API через путь `/bot<TOKEN>/<METHOD>`.
- **Поддержка HTTP-прокси**: Использует `httpx` для перенаправления трафика.
- **Прозрачность**: Поддерживает GET, POST, PUT и PATCH запросы.
- **Логирование**: Вывод входящих запросов и ответов от Telegram в консоль для отладки.
- **Docker Ready**: Готовые конфигурации для Docker и Docker Compose.

## 🛠 Настройка

Скрипт настраивается через переменные окружения:

| Переменная | Описание | Значение по умолчанию |
|------------|----------|-----------------------|
| `PORT` | Порт, на котором будет запущен прокси-сервер | `3000` |
| `PROXY_HOST` | IP или хост вашего внешнего прокси | `77.110.123.52` |
| `PROXY_PORT` | Порт внешнего прокси | `8080` |
| `PROXY_USER` | Логин для авторизации в прокси | `w1do` |
| `PROXY_PASS` | Пароль для авторизации в прокси | `w1do` |

## 📦 Быстрый старт

### Локальный запуск

1. Установите зависимости:
   ```bash
   pip install -r requirements.txt
   ```

2. Запустите сервер:
   ```bash
   python tg.py
   ```

По умолчанию сервер поднимется на `http://localhost:3000`.

### Запуск через Docker Compose

Если у вас установлен Docker:

```bash
docker-compose up -d
```

## 📖 Примеры использования

Чтобы отправить запрос в Telegram через прокси, замените базовый URL `https://api.telegram.org` на адрес вашего сервера.

### Пример отправки сообщения (GET)

```bash
curl "http://localhost:3000/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage?chat_id=12345678&text=Hello+from+proxy"
```

### Пример отправки сообщения (POST)

```bash
curl -X POST "http://localhost:3000/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage" \
     -H "Content-Type: application/json" \
     -d '{"chat_id": 12345678, "text": "Hello from proxy via POST"}'
```

## 🔍 Проверка работоспособности

Вы можете проверить статус прокси, обратившись к корневому эндпоинту:

```bash
curl http://localhost:3000/
```

Ответ:
```json
{
  "status": "ok",
  "message": "Telegram proxy is running",
  "proxy": "http://w1do:****@77.110.123.52:8080"
}
```

## Контакты

- **Сайт**: [w1do.ru](https://chistotyumen.ru)
- **Разработчик**: [W1DO DIGITAL](https://w1do.ru)
- **Telegram**: [@W1DO_DIGITAL](https://t.me/W1DO_DIGITAL)
