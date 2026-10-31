#!/bin/sh
# 首次启动自动生成自签证书：买家 clone 后一条命令即可跑起来。
# 如需替换为自己的证书，覆盖 /etc/nginx/certs/dept-office.{crt,key} 后重启容器即可。
set -e

CERT_DIR=/etc/nginx/certs
if [ ! -f "$CERT_DIR/dept-office.crt" ] || [ ! -f "$CERT_DIR/dept-office.key" ]; then
  echo "[entrypoint] 未发现证书，生成临时自签证书（生产环境请替换为正式证书，见 HTTPS.md）"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$CERT_DIR/dept-office.key" \
    -out "$CERT_DIR/dept-office.crt" \
    -subj "/CN=dept-office" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null
fi

exec nginx -g 'daemon off;'
