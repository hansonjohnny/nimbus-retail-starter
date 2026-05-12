# Architecture

## Service responsibilities

| Service | Owns | Calls (sync) | Publishes (async) | Subscribes |
|---|---|---|---|---|
| auth-service | Users, credentials, JWTs | none | `users.registered` | none |
| catalog-service | Products, inventory | none | none | none |
| cart-service | User carts | none | none | none |
| order-service | Orders | cart-service | `orders.created` | none |
| notification-service | (stateless dispatcher) | none | none | `users.registered`, `orders.created` |

## Synchronous flows

```
Frontend -> auth-service        (register, login)
Frontend -> catalog-service     (browse products)
Frontend -> cart-service        (manage cart)
Frontend -> order-service       (place order)
order-service -> cart-service   (fetch user's cart at checkout)
```

All east-west traffic in production uses Kubernetes Service DNS, for example:
```
http://cart-service.nimbus-prod.svc.cluster.local:3003
```

## Asynchronous flows

```
auth-service  -> users.registered  -> notification-service (welcome email)
order-service -> orders.created    -> notification-service (order confirmation)
```

Each consumer service uses its own consumer group, so adding new consumers in the future (analytics, fraud detection, marketing) does not affect existing ones.

## Data layout

Each service has its own Postgres schema:

| Schema | Owner |
|---|---|
| auth.users | auth-service |
| catalog.products | catalog-service |
| cart.carts | cart-service |
| orders.orders | order-service |

No service reads tables outside its own schema. In production each service connects with a database role that has access only to its schema.

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | auth, catalog, cart, order | Postgres connection string |
| `REDIS_URL` | catalog, cart | Redis connection URL |
| `KAFKA_BROKERS` | auth, order, notification | Comma-separated bootstrap servers |
| `JWT_SECRET` | auth, cart, order | Symmetric signing key |
| `CART_SERVICE_URL` | order | East-west URL for cart-service |
| `SERVICE_NAME` | all | Used in logs and metrics |
| `LOG_LEVEL` | all | `info` by default |
| `PORT` | all | Listen port |

In production these come from AWS Secrets Manager via the External Secrets Operator, not from a `.env` file.

## Ports

| Service | Port |
|---|---|
| auth-service | 3001 |
| catalog-service | 3002 |
| cart-service | 3003 |
| order-service | 3004 |
| notification-service | 3005 (probes only; no business endpoints) |
| frontend (nginx) | 8080 |
| kafka-ui | 8081 |
