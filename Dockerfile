FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3001
CMD ["npm", "start"]
