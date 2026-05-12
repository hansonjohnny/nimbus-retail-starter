const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { Kafka, logLevel } = require('kafkajs');
const pino = require('pino');
const pinoHttp = require('pino-http');
const promClient = require('prom-client');

const SERVICE = process.env.SERVICE_NAME || 'auth-service';
const PORT = parseInt(process.env.PORT || '3001', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

const log = pino({ name: SERVICE, level: process.env.LOG_LEVEL || 'info' });

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

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
    log.info('Kafka producer connected');
  } catch (err) {
    log.error({ err }, 'Kafka producer failed to connect');
    setTimeout(startKafka, 5000);
  }
}

// Prometheus metrics
promClient.collectDefaultMetrics({ prefix: 'auth_' });
const httpRequests = new promClient.Counter({
  name: 'auth_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});
const httpDuration = new promClient.Histogram({
  name: 'auth_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const app = express();
app.use(express.json());
app.use(pinoHttp({ logger: log }));

app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.route.path : req.path;
    const labels = { method: req.method, route, status: res.statusCode };
    httpRequests.inc(labels);
    end(labels);
  });
  next();
});

// Operational endpoints
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

// Business endpoints
app.post('/auth/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'email and password (min 8 chars) required' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO auth.users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [email, hash]
    );
    const user = result.rows[0];

    // Publish event (fire-and-forget; do not block the response on Kafka)
    if (kafkaReady) {
      producer.send({
        topic: 'users.registered',
        messages: [{
          key: user.id,
          value: JSON.stringify({
            schemaVersion: 1,
            userId: user.id,
            email: user.email,
            createdAt: user.created_at,
          }),
        }],
      }).catch(err => log.error({ err }, 'failed to publish users.registered'));
    }

    res.status(201).json({ id: user.id, email: user.email });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'email already registered' });
    }
    log.error({ err }, 'register failed');
    res.status(500).json({ error: 'internal error' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  try {
    const result = await db.query(
      'SELECT id, email, password_hash FROM auth.users WHERE email = $1',
      [email]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    const token = jwt.sign(
      { sub: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    res.json({ token, userId: user.id });
  } catch (err) {
    log.error({ err }, 'login failed');
    res.status(500).json({ error: 'internal error' });
  }
});

app.get('/auth/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing bearer token' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    res.json({ userId: payload.sub, email: payload.email });
  } catch (err) {
    res.status(401).json({ error: 'invalid token' });
  }
});

// Graceful shutdown
async function shutdown(signal) {
  log.info({ signal }, 'shutting down');
  try {
    if (kafkaReady) await producer.disconnect();
    await db.end();
  } catch (err) {
    log.error({ err }, 'error during shutdown');
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen(PORT, () => {
  log.info({ port: PORT }, `${SERVICE} listening`);
  startKafka();
});
