FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dépendances d'abord pour profiter du cache Docker
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force

COPY src ./src

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
