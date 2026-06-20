FROM node:18-alpine

WORKDIR /app

# Копируем package.json и package-lock.json (если есть)
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production && npm cache clean --force

# Копируем ВСЕ файлы проекта
COPY . .

# Убеждаемся, что tg.js существует
RUN ls -la /app/

EXPOSE 3000

CMD ["node", "tg.js"]