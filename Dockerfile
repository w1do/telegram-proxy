FROM node:18-alpine

WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install --production && npm cache clean --force

# Копируем файл приложения (с расширением .mjs)
COPY tg.mjs ./

EXPOSE 3000

CMD ["node", "tg.mjs"]