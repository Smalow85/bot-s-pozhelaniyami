FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

# Указываем, что контейнер будет слушать на порту 8080.
# Это инструкция только для документации и сетевой конфигурации Docker.
EXPOSE 8080

# Команда для запуска вашего Node.js скрипта.
# Теперь ваш скрипт сам запускает HTTP-сервер.
CMD ["node", "index.js"]