FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache openssl
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY entrypoint-certs.sh /entrypoint-certs.sh
RUN sed -i 's/\r$//' /entrypoint-certs.sh && chmod +x /entrypoint-certs.sh
EXPOSE 80
EXPOSE 443
CMD ["sh", "/entrypoint-certs.sh"]
