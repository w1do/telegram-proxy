import express from 'express';
import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка прокси из переменных окружения
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
        proxy: proxyUrl.replace(/:.+@/, ':****@'),
        endpoints: {
            'GET /bot/:token/:method': 'Get bot info',
            'POST /bot/:token/:method': 'Send message'
        }
    });
});

// Основной обработчик
app.all('/bot/:token/:method', async (req, res) => {
    try {
        const { token, method } = req.params;

        if (!token || !method) {
            return res.status(400).json({
                error: 'Missing token or method',
                message: 'Expected /bot/<TOKEN>/<METHOD>'
            });
        }

        const url = `https://api.telegram.org/bot${token}/${method}`;

        console.log(`🔗 Проксируем запрос к: ${url}`);
        console.log(`📦 Метод: ${req.method}`);
        console.log(`📦 Параметры:`, req.query);
        console.log(`📦 Тело:`, req.body);

        const config = {
            method: req.method,
            url: url,
            httpsAgent: agent,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000,
            params: req.query
        };

        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            config.data = req.body;
        }

        const response = await axios(config);

        console.log(`✅ Ответ получен, статус: ${response.status}`);
        res.json(response.data);

    } catch (error) {
        console.error(`❌ Ошибка:`, error.message);

        if (error.response) {
            console.error(`   Статус: ${error.response.status}`);
            console.error(`   Данные:`, error.response.data);
            res.status(error.response.status).json(error.response.data);
        } else if (error.request) {
            console.error(`   Нет ответа от Telegram API`);
            res.status(502).json({
                error: 'No response from Telegram API',
                message: error.message
            });
        } else {
            console.error(`   Ошибка настройки запроса:`, error.message);
            res.status(500).json({
                error: 'Internal proxy error',
                message: error.message
            });
        }
    }
});

// 404
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: `Endpoint ${req.url} not found`
    });
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('❌ Необработанная ошибка:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Telegram proxy запущен на порту ${PORT}`);
    console.log(`🌐 Прокси сервер: ${proxyUrl.replace(/:.+@/, ':****@')}`);
    console.log(`\n📝 Тестовые команды:`);
    console.log(`  curl "http://localhost:${PORT}/bot/YOUR_TOKEN/getMe"`);
    console.log(`\n📋 Health check: http://localhost:${PORT}/`);
});