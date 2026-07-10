import express from 'express';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка прокси
const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;

let agent = null;
let proxyUrl = 'none';

if (PROXY_HOST && PROXY_PORT) {
    const auth = (PROXY_USER && PROXY_PASS) 
        ? `${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@` 
        : '';
    
    proxyUrl = `http://${auth}${PROXY_HOST}:${PROXY_PORT}`;
    agent = new HttpsProxyAgent(proxyUrl);
} else {
    console.warn('⚠️ PROXY_HOST or PROXY_PORT is not defined. Running without proxy.');
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Логирование
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    });
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

        const config = {
            method: req.method,
            url: url,
            httpsAgent: agent,
            proxy: false, // Отключаем встроенную поддержку прокси axios
            headers: { 
                'Content-Type': 'application/json',
                // Принудительно передаем Proxy-Authorization если есть данные
                ...(PROXY_USER && PROXY_PASS ? {
                    'Proxy-Authorization': `Basic ${Buffer.from(`${PROXY_USER}:${PROXY_PASS}`).toString('base64')}`
                } : {})
            },
            timeout: 30000,
            params: req.query
        };

        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            config.data = req.body;
        }

        const response = await axios(config);
        res.json(response.data);

    } catch (error) {
        console.error(`❌ Ошибка:`, error.message);

        if (error.response) {
            // Если прокси вернул 407, выводим заголовки для отладки
            if (error.response.status === 407) {
                console.error('📋 Proxy-Authenticate:', error.response.headers['proxy-authenticate']);
                console.error('📋 Sent Proxy-Authorization:', config.headers['Proxy-Authorization'] ? 'Yes' : 'No');
            }
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