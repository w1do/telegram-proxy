import express from 'express';
import axios from 'axios';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { HttpsProxyAgent } from 'https-proxy-agent';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3000;

// Конфигурация прокси
const { PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS } = process.env;

const proxyUrl = (PROXY_HOST && PROXY_PORT)
    ? `http://${PROXY_USER && PROXY_PASS ? `${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@` : ''}${PROXY_HOST}:${PROXY_PORT}`
    : 'direct';

const agent = proxyUrl !== 'direct' ? new HttpsProxyAgent(proxyUrl) : null;

// Специальный мидлвар для пропуска body-parser для путей вебхуков n8n
const skipBodyParserForWebhooks = (req, res, next) => {
    if (req.path.startsWith('/webhook') || req.path.startsWith('/webhook-test')) {
        return next();
    }
    express.json()(req, res, (err) => {
        if (err) return next(err);
        express.urlencoded({ extended: true })(req, res, next);
    });
};

app.use(skipBodyParserForWebhooks);

// Логирование запросов
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
        proxy: proxyUrl.replace(/:.+@/, ':****@')
    });
});

// Проксирование запросов к Telegram
app.all(/^\/bot\/?([^\/]+)\/(.+)$/, async (req, res) => {
    try {
        const [, token, method] = req.path.match(/^\/bot\/?([^\/]+)\/(.+)$/);
        const url = `https://api.telegram.org/bot${token}/${method}`;

        const { host, ...forwardHeaders } = req.headers;

        const response = await axios({
            method: req.method,
            url,
            httpsAgent: agent,
            proxy: false,
            data: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req.body : undefined,
            params: req.query,
            headers: {
                ...forwardHeaders,
                'Content-Type': 'application/json',
                'Host': 'api.telegram.org'
            },
            timeout: 30000
        });

        res.json(response.data);
    } catch (error) {
        const status = error.response?.status || 500;
        const data = error.response?.data || { error: error.message };
        
        if (status >= 500) {
            console.error(`❌ Error: ${error.message}`);
        }
        
        res.status(status).json(data);
    }
});

app.use((req, res, next) => {
    console.log("INCOMING REQUEST:", req.method, req.url);
    next();
});

// Прокси для n8n
const n8nTarget = process.env.N8N_TARGET || 'https://n8n.w1do.ru';

app.use(['/webhook', '/webhook-test'], createProxyMiddleware({
    target: n8nTarget,
    changeOrigin: true,
    secure: false,
    xfwd: true,

    on: {
        proxyReq: (proxyReq, req) => {

            console.log('========== WEBHOOK ==========');
            console.log(req.method, req.originalUrl);

            console.log('HEADERS:');
            console.log(req.headers);

            // сохраняем telegram secret если есть
            if (req.headers['x-telegram-bot-api-secret-token']) {
                proxyReq.setHeader(
                    'x-telegram-bot-api-secret-token',
                    req.headers['x-telegram-bot-api-secret-token']
                );
            }

            console.log('============================');
        },

        proxyRes: (proxyRes) => {
            console.log(
                '[N8N RESPONSE]',
                proxyRes.statusCode
            );
        },

        error: (err) => {
            console.error('[PROXY ERROR]', err);
        }
    }
}));

// 404 для всех остальных путей
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Proxy server started on port ${PORT}`);
    console.log(`🌐 Proxy: ${proxyUrl.replace(/:.+@/, ':****@')}`);
});