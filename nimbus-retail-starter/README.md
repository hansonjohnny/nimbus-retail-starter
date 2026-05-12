# NimbusRetail Starter Repository

This is the application code for the NimbusRetail capstone project. It contains five backend services and a small web frontend. Everything runs locally with `docker-compose up`. Your job in this project is not to write the application code (that is done). Your job is to take this code to production on AWS EKS with all the operational, observability, and security layers a real platform team would put around it.

The application simulates a small e-commerce platform. A user can register, browse a catalog, add items to a cart, place an order, and receive a notification. The services talk to each other over HTTP for synchronous flows and over Kafka for asynchronous flows.

## What is in the box

```
nimbus-retail-starter/
├── docker-compose.yml          Everything you need to run the system locally
├── .env.example                Environment variables (copy to .env)
├── services/
│   ├── auth-service/           Node.js, Express. Owns users and JWT issuance.
│   ├── catalog-service/        Python, FastAPI. Owns products and inventory.
│   ├── cart-service/           Node.js, Express. Owns user carts.
│   ├── order-service/          Node.js, Express. Owns orders. Kafka producer.
│   └── notification-service/   Node.js. Kafka consumer. Sends mock emails.
├── frontend/                   A single HTML file that exercises the APIs.
├── schemas/                    Shared Kafka event schemas (JSON).
├── scripts/                    Helper scripts for local setup.
└── docs/
    ├── ARCHITECTURE.md         How the services fit together.
    └── WORKING_WITH_DEVS.md    Notes on how to think about this code.
```

## Getting started

You will receive this as a zip file. Set it up as your own Git repository.

```bash
# 1. Extract the zip
unzip nimbus-retail-starter.zip
cd nimbus-retail-starter

# 2. Initialise as a Git repo and push to your own GitHub or GitLab account.
# This is now your "application repository". You will create a separate
# "platform repository" for your Terraform, Helm charts, ArgoCD manifests,
# and documentation. Keep them separate. In real engineering organisations
# the app code and the platform code live in different repos owned by
# different teams.
git init
git add .
git commit -m "Initial commit: NimbusRetail starter"
git remote add origin git@github.com:<your-username>/nimbus-retail.git
git branch -M main
git push -u origin main
```

## Local quickstart

You need Docker Desktop installed. Nothing else.

```bash
cp .env.example .env
docker-compose up --build
```

That will start Postgres, Redis, Kafka, all five services, and the frontend. Give it about 60 seconds the first time. When it is up:

| URL | What it is |
|---|---|
| http://localhost:8080 | Frontend |
| http://localhost:8081 | Kafka UI (browse topics and messages) |
| http://localhost:3001 | auth-service |
| http://localhost:3002 | catalog-service |
| http://localhost:3003 | cart-service |
| http://localhost:3004 | order-service |

Every service exposes three operational endpoints you will need later:

| Endpoint | Returns |
|---|---|
| `GET /healthz` | 200 if the process is alive |
| `GET /readyz` | 200 if the process can serve traffic (checks DB, cache, Kafka) |
| `GET /metrics` | Prometheus-format metrics |

## A walkthrough you can run in five minutes

```bash
# 1. Register a user
curl -X POST http://localhost:3001/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-battery-staple"}'

# 2. Log in and grab the token
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-battery-staple"}' \
  | jq -r .token)

# 3. Browse the catalog
curl http://localhost:3002/products

# 4. Add an item to the cart
curl -X POST http://localhost:3003/cart/items \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"productId":"prod-001","quantity":2}'

# 5. Place an order (this publishes an OrderCreated event to Kafka)
curl -X POST http://localhost:3004/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json'

# 6. Watch the notification-service log lines
docker-compose logs -f notification-service
```

If you see "Sending order confirmation email to alice@example.com" in the notification-service logs, the whole chain is working: HTTP request to order-service, Postgres write, Kafka publish, Kafka consume, mock email dispatched.

## What you are responsible for delivering

Read the project specification document for the full requirements. In short:

1. Take this code and run it on Amazon EKS.
2. Provision all infrastructure with Terraform (VPC, EKS, RDS, ElastiCache, MSK, ECR).
3. Package each service as a Helm chart.
4. Set up Jenkins pipelines that build, scan, push, and deploy on every commit.
5. Manage deployments with ArgoCD using the app-of-apps pattern.
6. Stand up Prometheus, Grafana, Loki, and Tempo so you can answer the question "why did this request fail?"
7. Lock the cluster down with NetworkPolicies, IRSA, image scanning, and admission policies.
8. Document what you built (Solution Design Document, ADRs, runbook, AWS architecture diagram).

## What you are not responsible for

You do not need to add new features to the services. You do not need to rewrite them in a different language. You do not need to write unit tests beyond what is here. If you find a bug, raise it as an issue (just like you would at work). Your evaluation is on the platform you build around the code, not on the code itself.

## Tech stack you will encounter

| Service | Language | Framework | Notable libraries |
|---|---|---|---|
| auth-service | Node.js 20 | Express | bcrypt, jsonwebtoken, pg, kafkajs, prom-client |
| catalog-service | Python 3.12 | FastAPI | asyncpg, redis, prometheus-client |
| cart-service | Node.js 20 | Express | redis, pg, prom-client |
| order-service | Node.js 20 | Express | pg, kafkajs, prom-client |
| notification-service | Node.js 20 | (none, plain) | kafkajs |

Two languages, both common in production. If you have not worked with either, the code is small enough (under 200 lines per service) that you can read all of it in an afternoon.

## Questions

If the application behaves unexpectedly, read `docs/WORKING_WITH_DEVS.md` first. That file describes the assumptions the developers made and what they expect platform engineers to do.

If you find something genuinely broken, open an issue in this repository with steps to reproduce. That is what your real teammates would do.
