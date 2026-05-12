const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { Kafka, logLevel } = require('kafkajs');
const pino = require('pino');
const pinoHttp = require('pino-http');
const promClient = require('prom-client');

const SERVICE = process.env.SERVICE_NAME || 'order-service';
const PORT = parseInt(process.env.PORT || '3004', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const CART_URL = process.env.CART_SERVICE_URL || 'http://cart-service:3003';

const log = pino({ name: SERVICE });
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const kafka = new Kafka({
  clientId: SERVICE,
  brokers: (process.env.KAFKA_BROKERS || 'kafka:9092').split(','),
  logLevel: logLevel.WARN,
});
const producer = kafka.producer();
let kafkaReady = false;

async function startKafka() {
  try {
    await producer.connect();
    kafkaReady = true;
    log.info('kafka producer connected');
  } catch (err) {
    log.error({ err }, 'kafka connection failed, retrying');
    setTimeout(startKafka, 5000);
  }
}

promClient.collectDefaultMetrics({ prefix: 'order_' });
const ordersCreated = new promClient.Counter({
  name: 'order_orders_created_total', help: 'Orders created',
});
const httpRequests = new promClient.Counter({
  name: 'order_http_requests_total', help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

const app = express();
app.use(express.json());
app.use(pinoHttp({ logger: log }));
app.use((req, res, next) => {
  res.on('finish', () => httpRequests.inc({
    method: req.method,
    route: req.route ? req.route.path : req.path,
    status: res.statusCode,
  }));
  next();
});

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing bearer token' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    req.token = auth.slice(7);
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid token' });
  }
}

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

app.get('/readyz', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    if (!kafkaReady) throw new Error('kafka not connected');
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', reason: err.message });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.send(await promClient.register.metrics());
});

app.post('/orders', authMiddleware, async (req, res) => {
  try {
    // Read the user's cart from cart-service via east-west call.
    // In production, this URL is the in-cluster Kubernetes Service DNS.
    const cartResp = await fetch(`${CART_URL}/cart`, {
      headers: { Authorization: `Bearer ${req.token}` },
    });
    if (!cartResp.ok) {
      return res.status(502).json({ error: 'failed to fetch cart' });
    }
    const cart = await cartResp.json();
    if (!cart.items || cart.items.length === 0) {
      return res.status(400).json({ error: 'cart is empty' });
    }

    // For the starter, we use a flat price. In production, order-service would
    // verify each item's price against catalog-service at order time.
    const totalCents = cart.items.reduce((sum, i) => sum + 5000 * i.quantity, 0);

    const result = await db.query(`
      INSERT INTO orders.orders (user_id, items, total_cents)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, items, total_cents, status, created_at
    `, [req.user.sub, JSON.stringify(cart.items), totalCents]);
    const order = result.rows[0];

    if (kafkaReady) {
      await producer.send({
        topic: 'orders.created',
        messages: [{
          key: order.user_id,
          value: JSON.stringify({
            schemaVersion: 1,
            orderId: order.id,
            userId: order.user_id,
            email: req.user.email,
            items: order.items,
            totalCents: order.total_cents,
            createdAt: order.created_at,
          }),
        }],
      });
    } else {
      log.warn({ orderId: order.id }, 'kafka not ready; OrderCreated not published');
    }

    ordersCreated.inc();
    res.status(201).json(order);
  } catch (err) {
    log.error({ err }, 'create order failed');
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/orders/:id', authMiddleware, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, user_id, items, total_cents, status, created_at FROM orders.orders WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.sub]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'internal error' });
  }
});

async function shutdown() {
  log.info('shutting down');
  if (kafkaReady) await producer.disconnect();
  await db.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(PORT, () => {
  log.info({ port: PORT }, `${SERVICE} listening`);
  startKafka();
});
