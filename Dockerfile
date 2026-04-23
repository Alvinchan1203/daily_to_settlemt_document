FROM node:18-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci

RUN npx playwright install --with-deps chromium

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
