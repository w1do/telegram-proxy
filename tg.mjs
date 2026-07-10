import express from 'express';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// Конфигурация исходящего прокси (только для api.telegram.org)
// ============================================================
const { PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS } = process.env;

const proxyUrl = (PROXY_HOST && PROXY_PORT)
    ? `http://${PROXY_USER && PROXY_PASS ? `${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@` : ''}${PROXY_HOST}:${PROXY_PORT}`
    : 'direct';

const agent = proxyUrl !== 'direct' ? new HttpsProxyAgent(proxyUrl) : null;

// Цель n8n (внутренний адрес). Пример: http://n8n.w1do.ru или https://n8n.w1do.ru
const n8nTarget = (process.env.N8N_TARGET || 'https://n8n.w1do.ru').replace(/\/+$/, '');
const n8nHost = new URL(n8nTarget).host;

// ============================================================
// ВАЖНО: тело вебхука Telegram НЕ парсим (не express.json()),
// чтобы не потерять/не изменить оригинальный update.
// Для не-вебхуков парсим как обычно.
// ============================================================
const isWebhookPath = (p) => p.startsWith('/webhook-test') || p.startsWith('/webhook');

// Для вебхуков забираем СЫРОЙ Buffer (любой content-type),
// чтобы переслать байт-в-байт и при этом иметь возможность логировать тело.
const rawForWebhook = express.raw({ type: () => true, limit: '25mb' });

app.use((req, res, next) => {
    if (isWebhookPath(req.path)) {
        return rawForWebhook(req, res, next);
    }
    express.json()(req, res, (err) => {
        if (err) return next(err);
        express.urlencoded({ extended: true })(req, res, next);
    });
});

// Логирование запросов (краткое)
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Telegram proxy is running',
        proxy: proxyUrl.replace(/:.+@/, ':****@'),
        n8n: n8nTarget
    });
});

// ============================================================
// Проксирование запросов к Telegram Bot API
//   /bot<TOKEN>/<METHOD>  ->  https://api.telegram.org/bot<TOKEN>/<METHOD>
// ============================================================
app.all(/^\/bot\/?([^/]+)\/(.+)$/, async (req, res) => {
    try {
        const [, token, method] = req.path.match(/^\/bot\/?([^/]+)\/(.+)$/);
        const url = `https://api.telegram.org/bot${token}/${method}`;

        const response = await axios({
            method: req.method,
            url,
            httpsAgent: agent,
            proxy: false,
            data: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
            params: req.query,
            headers: {
                'Content-Type': 'application/json',
                'Host': 'api.telegram.org'
            },
            timeout: 30000,
            validateStatus: () => true
        });

        res.status(response.status).json(response.data);
    } catch (error) {
        const status = error.response?.status || 500;
        const data = error.response?.data || { error: error.message };
        if (status >= 500) console.error(`❌ Telegram error: ${error.message}`);
        res.status(status).json(data);
    }
});

// ============================================================
// Проксирование вебхуков в n8n (test + production)
//   POST /webhook-test/<uuid>/webhook -> POST {N8N}/webhook-test/<uuid>/webhook
//   POST /webhook/<uuid>/webhook      -> POST {N8N}/webhook/<uuid>/webhook
//
// Сохраняем БЕЗ ИЗМЕНЕНИЙ: method, path, query, body, ключевые headers.
// Никаких redirect 308, никакого re-парсинга тела.
// ============================================================
const HOP_BY_HOP = new Set([
    'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length'
]);

const forwardToN8n = async (req, res) => {
    const targetUrl = n8nTarget + req.originalUrl;

    // Пробрасываем ВСЕ заголовки, полученные от Telegram, как есть
    // (включая x-telegram-bot-api-secret-token, user-agent, content-type и т.д.).
    // Меняем только host (на хост n8n) и content-length (пересчитает axios).
    const headers = { ...req.headers };
    for (const h of HOP_BY_HOP) delete headers[h];
    headers['host'] = n8nHost;

    // Тело — сырой Buffer (или пусто).
    const body = Buffer.isBuffer(req.body) && req.body.length ? req.body : undefined;

    // -------- ДИАГНОСТИКА: перед отправкой в n8n --------
    console.log('========== -> N8N REQUEST ==========');
    console.log({
        url: targetUrl,
        method: req.method,
        headers,
        body: body ? body.toString('utf8') : ''
    });
    console.log('====================================');

    try {
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers,
            data: body,
            params: undefined, // query уже входит в req.originalUrl
            timeout: 30000,
            maxRedirects: 0,              // НЕ следуем за 308 редиректами
            responseType: 'arraybuffer',
            validateStatus: () => true,
            proxy: false
        });

        // -------- ДИАГНОСТИКА: после ответа n8n --------
        console.log('========== <- N8N RESPONSE ==========');
        console.log({
            status: response.status,
            headers: response.headers
        });
        const preview = Buffer.from(response.data).toString('utf8');
        if (preview) console.log('BODY:', preview.slice(0, 1000));
        console.log('=====================================');

        // Пробрасываем ответ n8n обратно (кроме hop-by-hop).
        for (const [key, value] of Object.entries(response.headers)) {
            if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value);
        }
        res.status(response.status).send(Buffer.from(response.data));
    } catch (error) {
        console.error('[N8N PROXY ERROR]', error.code || error.message);
        res.status(502).json({ error: 'Bad gateway to n8n', detail: error.code || error.message });
    }
};

app.all(/^\/webhook-test\/.*/, forwardToN8n);
app.all(/^\/webhook\/.*/, forwardToN8n);

// 404 для всех остальных путей
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Proxy server started on port ${PORT}`);
    console.log(`🌐 Outbound proxy (Telegram): ${proxyUrl.replace(/:.+@/, ':****@')}`);
    console.log(`🎯 n8n target: ${n8nTarget}`);
});
