const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { createClient } = require('redis');
const pino = require('pino');
const pinoHttp = require('pino-http');
const promClient = require('prom-client');

const SERVICE = process.env.SERVICE_NAME || 'cart-service';
const PORT = parseInt(process.env.PORT || '3003', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const CART_TTL = 60 * 60 * 24 * 7; // one week

const log = pino({ name: SERVICE });
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const cache = createClient({ url: process.env.REDIS_URL });
cache.on('error', err => log.error({ err }, 'redis error'));

promClient.collectDefaultMetrics({ prefix: 'cart_' });
const httpRequests = new promClient.Counter({
  name: 'cart_http_requests_total', help: 'Total HTTP requests',
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
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid token' });
  }
}

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

app.get('/readyz', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    if (!cache.isOpen) throw new Error('redis not connected');
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', reason: err.message });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.send(await promClient.register.metrics());
});

async function readCart(userId) {
  const cached = await cache.get(`cart:${userId}`);
  if (cached) return JSON.parse(cached);
  const result = await db.query('SELECT items FROM cart.carts WHERE user_id = $1', [userId]);
  const items = result.rowCount > 0 ? result.rows[0].items : [];
  await cache.setEx(`cart:${userId}`, CART_TTL, JSON.stringify(items));
  return items;
}

async function writeCart(userId, items) {
  await db.query(`
    INSERT INTO cart.carts (user_id, items, updated_at) VALUES ($1, $2, now())
    ON CONFLICT (user_id) DO UPDATE SET items = $2, updated_at = now()
  `, [userId, JSON.stringify(items)]);
  await cache.setEx(`cart:${userId}`, CART_TTL, JSON.stringify(items));
}

app.get('/cart', authMiddleware, async (req, res) => {
  try {
    const items = await readCart(req.user.sub);
    res.json({ userId: req.user.sub, items });
  } catch (err) {
    log.error({ err }, 'readCart failed');
    res.status(500).json({ error: 'internal error' });
  }
});

app.post('/cart/items', authMiddleware, async (req, res) => {
  const { productId, quantity } = req.body || {};
  if (!productId || !quantity || quantity < 1) {
    return res.status(400).json({ error: 'productId and positive quantity required' });
  }
  try {
    const items = await readCart(req.user.sub);
    const existing = items.find(i => i.productId === productId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      items.push({ productId, quantity });
    }
    await writeCart(req.user.sub, items);
    res.status(201).json({ userId: req.user.sub, items });
  } catch (err) {
    log.error({ err }, 'add to cart failed');
    res.status(500).json({ error: 'internal error' });
  }
});

app.delete('/cart/items/:productId', authMiddleware, async (req, res) => {
  try {
    const items = (await readCart(req.user.sub)).filter(i => i.productId !== req.params.productId);
    await writeCart(req.user.sub, items);
    res.json({ userId: req.user.sub, items });
  } catch (err) {
    res.status(500).json({ error: 'internal error' });
  }
});

async function shutdown() {
  await db.end();
  if (cache.isOpen) await cache.quit();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

(async () => {
  await cache.connect();
  app.listen(PORT, () => log.info({ port: PORT }, `${SERVICE} listening`));
})();
