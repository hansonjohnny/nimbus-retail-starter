# Build stage
FROM alpine AS builder
WORKDIR /build
COPY index.html .
COPY nginx.conf .

# Runtime stage
FROM nginx:alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /build/index.html /usr/share/nginx/html/
COPY --from=builder /build/nginx.conf /etc/nginx/conf.d/default.conf
USER app

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
