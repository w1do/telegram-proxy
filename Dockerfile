FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production && npm cache clean --force

# Копируем с правильным расширением
COPY tg.mjs ./

EXPOSE 3000

CMD ["node", "tg.mjs"]