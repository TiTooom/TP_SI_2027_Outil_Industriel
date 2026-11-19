FROM node:22.21.1-alpine3.22

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Port 5020 > 1024 : pas besoin de privilèges root
USER node
EXPOSE 5020
CMD ["node", "src/index.js"]
