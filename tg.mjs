import express from 'express';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка прокси
const PROXY_HOST = process.env.PROXY_HOST || 'gate.node-proxy.com';
const PROXY_PORT = process.env.PROXY_PORT || '10000';
const PROXY_USER = process.env.PROXY_USER || 'api6427e610fa202b13_c_US_s_1';
const PROXY_PASS = process.env.PROXY_PASS || 'aepKxOZdTRMDH3XC';

const proxyUrl = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}`;
const agent = new HttpsProxyAgent(proxyUrl);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Логирование
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Telegram proxy is running',
        proxy: proxyUrl.replace(/:.+@/, ':****@')
    });
});

// ============================================================
// ЕДИНЫЙ ОБРАБОТЧИК ДЛЯ ВСЕХ /bot... ЗАПРОСОВ (через регулярку)
// ============================================================
app.all(/^\/bot\/?([^\/]+)\/(.+)$/, async (req, res) => {
    try {
        // Извлекаем токен и метод из URL
        const match = req.path.match(/^\/bot\/?([^\/]+)\/(.+)$/);
        if (!match) {
            return res.status(400).json({
                error: 'Invalid path',
                message: 'Expected /bot/TOKEN/METHOD or /botTOKEN/METHOD'
            });
        }

        const token = match[1];
        const method = match[2];
        const url = `https://api.telegram.org/bot${token}/${method}`;

        console.log(`🔗 Проксируем: ${url}`);
        console.log(`📦 Метод: ${req.method}`);
        console.log(`📦 Параметры:`, req.query);
        console.log(`📦 Тело:`, req.body);

        const config = {
            method: req.method,
            url: url,
            httpsAgent: agent,
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
            params: req.query
        };

        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            config.data = req.body;
        }

        const response = await axios(config);
        console.log(`✅ Статус: ${response.status}`);
        res.json(response.data);

    } catch (error) {
        console.error(`❌ Ошибка:`, error.message);

        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else if (error.request) {
            res.status(502).json({
                error: 'No response from Telegram API',
                message: error.message
            });
        } else {
            res.status(500).json({
                error: 'Internal proxy error',
                message: error.message
            });
        }
    }
});

// 404 для всего остального
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: `Endpoint ${req.url} not found`
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Прокси запущен на порту ${PORT}`);
    console.log(`🌐 Прокси: ${proxyUrl.replace(/:.+@/, ':****@')}`);
    console.log(`\n📋 Health check: http://localhost:${PORT}/`);
});