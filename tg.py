from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
import httpx
import os
import re
import logging
from datetime import datetime
from dotenv import load_dotenv
import uvicorn

load_dotenv()

app = FastAPI()

# ============================================================
# Конфигурация
# ============================================================
PORT = int(os.getenv("PORT", 3000))
N8N_TARGET = os.getenv("N8N_TARGET", "https://n8n.w1do.ru").rstrip('/')
N8N_HOST = N8N_TARGET.split('://')[1].split('/')[0]

# Настройки прокси для исходящих запросов к Telegram
PROXY_HOST = os.getenv("PROXY_HOST")
PROXY_PORT = os.getenv("PROXY_PORT")
PROXY_USER = os.getenv("PROXY_USER")
PROXY_PASS = os.getenv("PROXY_PASS")

# Сборка прокси-URL
proxy_url = None
if PROXY_HOST and PROXY_PORT:
    if PROXY_USER and PROXY_PASS:
        proxy_url = f"http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{PROXY_PORT}"
    else:
        proxy_url = f"http://{PROXY_HOST}:{PROXY_PORT}"

# ============================================================
# Настройка логирования
# ============================================================
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================
# Клиент для Telegram (с поддержкой прокси)
# ============================================================
telegram_client = httpx.AsyncClient(
    proxy=proxy_url,
    timeout=30.0,
    follow_redirects=False
)

# Клиент для n8n (без прокси, только внутренний)
n8n_client = httpx.AsyncClient(
    timeout=30.0,
    follow_redirects=False
)

# ============================================================
# Hop-by-hop заголовки (не проксируются)
# ============================================================
HOP_BY_HOP = {
    'host', 'connection', 'keep-alive', 'proxy-authenticate',
    'proxy-authorization', 'te', 'trailer', 'transfer-encoding',
    'upgrade', 'content-length'
}

# ============================================================
# Хелпер для очистки заголовков
# ============================================================
def clean_headers(headers: dict) -> dict:
    """Удаляет hop-by-hop заголовки и возвращает чистый dict"""
    cleaned = {}
    for key, value in headers.items():
        if key.lower() not in HOP_BY_HOP:
            cleaned[key] = value
    return cleaned

# ============================================================
# Мидлвари: логирование запросов
# ============================================================
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = datetime.now()
    response = await call_next(request)
    duration = (datetime.now() - start_time).total_seconds() * 1000
    logger.info(f"[{datetime.now().isoformat()}] {request.method} {request.url.path} - {response.status_code} ({duration:.0f}ms)")
    return response

# ============================================================
# Health check
# ============================================================
@app.get("/")
async def health_check():
    return {
        "status": "ok",
        "message": "Telegram proxy is running",
        "proxy": re.sub(r':[^:@]*@', ':****@', proxy_url) if proxy_url else "direct",
        "n8n": N8N_TARGET
    }

# ============================================================
# Проксирование запросов к Telegram Bot API
#   /bot/<TOKEN>/<METHOD>  ->  https://api.telegram.org/bot<TOKEN>/<METHOD>
# ============================================================
@app.api_route("/bot/{token:path}/{method:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_to_telegram(token: str, method: str, request: Request):
    try:
        url = f"https://api.telegram.org/bot{token}/{method}"

        # Получаем тело запроса
        body = await request.body()

        # Проксируем ВСЕ заголовки от n8n к Telegram
        headers = clean_headers(dict(request.headers))
        headers['host'] = 'api.telegram.org'  # Важно для правильной маршрутизации

        # ---------- ДИАГНОСТИКА ----------
        logger.info("========== -> TELEGRAM REQUEST ==========")
        logger.info(f"URL: {url}")
        logger.info(f"Method: {request.method}")
        logger.info(f"Headers: {headers}")
        if body:
            try:
                logger.info(f"Body: {body.decode('utf-8')[:500]}")
            except Exception:
                logger.info(f"Body: (binary, {len(body)} bytes)")
        logger.info("========================================")

        # Отправляем запрос в Telegram через прокси
        response = await telegram_client.request(
            method=request.method,
            url=url,
            headers=headers,
            content=body,  # Передаем сырое тело
            params=dict(request.query_params)
        )

        # ---------- ДИАГНОСТИКА ----------
        logger.info("========== <- TELEGRAM RESPONSE ==========")
        logger.info(f"Status: {response.status_code}")
        logger.info(f"Headers: {response.headers}")
        if response.content:
            try:
                preview = response.text[:500]
                logger.info(f"Body: {preview}")
            except Exception:
                logger.info(f"Body: (binary, {len(response.content)} bytes)")
        logger.info("==========================================")

        # Проксируем ответ от Telegram обратно в n8n
        resp_headers = clean_headers(dict(response.headers))

        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=resp_headers
        )

    except Exception as e:
        logger.error(f"❌ Telegram error: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

# ============================================================
# Проксирование вебхуков в n8n
#   POST /webhook-test/<uuid>/webhook -> POST {N8N}/webhook-test/<uuid>/webhook
#   POST /webhook/<uuid>/webhook      -> POST {N8N}/webhook/<uuid>/webhook
# ============================================================
@app.api_route("/webhook-test/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
@app.api_route("/webhook/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def forward_to_n8n(request: Request, path: str):
    target_url = f"{N8N_TARGET}{request.url.path}"

    # Получаем сырое тело (сохраняем как есть, без парсинга)
    body = await request.body()

    # Проксируем ВСЕ заголовки от Telegram в n8n
    headers = clean_headers(dict(request.headers))
    headers['host'] = N8N_HOST

    # ---------- ДИАГНОСТИКА ----------
    logger.info("========== -> N8N REQUEST ==========")
    logger.info(f"URL: {target_url}")
    logger.info(f"Method: {request.method}")
    logger.info(f"Headers: {headers}")
    if body:
        try:
            logger.info(f"Body: {body.decode('utf-8')[:500]}")
        except Exception:
            logger.info(f"Body: (binary, {len(body)} bytes)")
    logger.info("====================================")

    try:
        # Отправляем в n8n
        response = await n8n_client.request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=body,
            params=dict(request.query_params)  # query параметры тоже пробрасываем
        )

        # ---------- ДИАГНОСТИКА ----------
        logger.info("========== <- N8N RESPONSE ==========")
        logger.info(f"Status: {response.status_code}")
        logger.info(f"Headers: {response.headers}")
        if response.content:
            try:
                preview = response.text[:500]
                logger.info(f"Body: {preview}")
            except Exception:
                logger.info(f"Body: (binary, {len(response.content)} bytes)")
        logger.info("=====================================")

        # Проксируем ответ от n8n в Telegram
        resp_headers = clean_headers(dict(response.headers))

        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=resp_headers
        )

    except Exception as e:
        logger.error(f"[N8N PROXY ERROR] {str(e)}")
        return JSONResponse(
            status_code=502,
            content={"error": "Bad gateway to n8n", "detail": str(e)}
        )

# ============================================================
# 404 для всех остальных путей
# ============================================================
@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def not_found(request: Request, path: str):
    return JSONResponse(status_code=404, content={"error": "Not found"})

# ============================================================
# Запуск
# ============================================================
if __name__ == "__main__":
    print(f"🚀 Proxy server started on port {PORT}")
    print(f"🌐 Outbound proxy (Telegram): {'****' if proxy_url else 'direct'}")
    print(f"🎯 n8n target: {N8N_TARGET}")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        log_level="info"
    )
