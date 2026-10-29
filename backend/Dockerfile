FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV PORT=3000
ENV DATA_DIR=/app/data

# 确保容器内数据目录存在（SQLite 文件 + uploads 附件）
RUN mkdir -p /app/data/uploads

EXPOSE 3000

CMD ["node", "src/index.js"]
