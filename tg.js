const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = 3000;

// Настройка вашего прокси
const proxyUrl = 'http://api6427e610fa202b13_c_US_s_1:aepKxOZdTRMDH3XC@gate.node-proxy.com:10000';
const agent = new HttpsProxyAgent(proxyUrl);

// Middleware для парсинга JSON и URL-encoded данных
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Логирование всех запросов
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Корневой путь - информация о сервисе
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Telegram proxy is running',
        proxy: proxyUrl,
        endpoints: {
            'GET /bot/:token/:method': 'Get bot info',
            'POST /bot/:token/:method': 'Send message',
            'GET /bot/:token/getMe': 'Get bot info'
        }
    });
});

// Универсальный обработчик для всех методов
app.all('/bot/:token/:method', async (req, res) => {
    try {
        const { token, method } = req.params;

        // Проверка наличия токена и метода
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

        // Настройка запроса к Telegram
        const config = {
            method: req.method,
            url: url,
            httpsAgent: agent,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000,
            params: req.query // Для GET запросов
        };

        // Для POST запросов добавляем тело
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            config.data = req.body;
        }

        const response = await axios(config);

        console.log(`✅ Ответ получен, статус: ${response.status}`);
        res.json(response.data);

    } catch (error) {
        console.error(`❌ Ошибка:`, error.message);

        if (error.response) {
            // Ошибка от Telegram API
            console.error(`   Статус: ${error.response.status}`);
            console.error(`   Данные:`, error.response.data);
            res.status(error.response.status).json(error.response.data);
        } else if (error.request) {
            // Нет ответа от Telegram
            console.error(`   Нет ответа от Telegram API`);
            res.status(502).json({
                error: 'No response from Telegram API',
                message: error.message
            });
        } else {
            // Ошибка настройки запроса
            console.error(`   Ошибка настройки запроса:`, error.message);
            res.status(500).json({
                error: 'Internal proxy error',
                message: error.message
            });
        }
    }
});

// Обработка 404
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
    console.log(`🌐 Прокси сервер: ${proxyUrl}`);
    console.log(`\n📝 Тестовые команды:`);
    console.log(`  curl "http://localhost:${PORT}/bot/8878543727:AAEMchGTmSMZ95EpdINcg52G_J08N-uV58Q/getMe"`);
    console.log(`  curl -X POST "http://localhost:${PORT}/bot/8878543727:AAEMchGTmSMZ95EpdINcg52G_J08N-uV58Q/sendMessage" -H "Content-Type: application/json" -d '{"chat_id":"CHAT_ID","text":"Test"}'`);
    console.log(`\n📋 Health check: http://localhost:${PORT}/`);
});