const express = require('express');
const { Kafka, logLevel } = require('kafkajs');
const pino = require('pino');
const promClient = require('prom-client');

const SERVICE = process.env.SERVICE_NAME || 'notification-service';
const PORT = parseInt(process.env.PORT || '3005', 10);

const log = pino({ name: SERVICE });

const kafka = new Kafka({
  clientId: SERVICE,
  brokers: (process.env.KAFKA_BROKERS || 'kafka:9092').split(','),
  logLevel: logLevel.WARN,
});

const consumer = kafka.consumer({
  groupId: 'notification-service',
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
});

promClient.collectDefaultMetrics({ prefix: 'notification_' });
const eventsProcessed = new promClient.Counter({
  name: 'notification_events_processed_total',
  help: 'Events processed',
  labelNames: ['topic', 'outcome'],
});

let kafkaReady = false;

// A tiny HTTP server so Kubernetes can health-check this consumer.
const app = express();
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
app.get('/readyz', (_req, res) => {
  if (kafkaReady) res.json({ status: 'ready' });
  else res.status(503).json({ status: 'not ready' });
});
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.send(await promClient.register.metrics());
});

async function sendOrderConfirmationEmail(event) {
  // In production, this would call SES / SendGrid / etc.
  // For the starter, we log it. That gives you a clean signal in observability.
  log.info({
    type: 'mock_email_sent',
    to: event.email,
    subject: `Order ${event.orderId} confirmed`,
    body: `Your order for ${event.items.length} item(s) totalling $${(event.totalCents / 100).toFixed(2)} has been received.`,
  }, 'sending order confirmation email');
}

async function sendWelcomeEmail(event) {
  log.info({
    type: 'mock_email_sent',
    to: event.email,
    subject: 'Welcome to NimbusRetail',
    body: `Hi! Your account ${event.userId} is ready.`,
  }, 'sending welcome email');
}

async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: 'orders.created', fromBeginning: false });
  await consumer.subscribe({ topic: 'users.registered', fromBeginning: false });
  kafkaReady = true;
  log.info('consumer subscribed');

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        if (topic === 'orders.created') {
          await sendOrderConfirmationEmail(event);
        } else if (topic === 'users.registered') {
          await sendWelcomeEmail(event);
        }
        eventsProcessed.inc({ topic, outcome: 'success' });
      } catch (err) {
        // KafkaJS commits offsets after each batch automatically. If we want
        // at-least-once with manual control, we would disable autoCommit and
        // commit explicitly after success. For starter purposes, log and
        // continue. Section 5.8 of the project document covers the better
        // pattern.
        log.error({ err, topic, partition, offset: message.offset }, 'failed to process event');
        eventsProcessed.inc({ topic, outcome: 'failure' });
      }
    },
  });
}

async function shutdown() {
  log.info('shutting down');
  try { await consumer.disconnect(); } catch (_) {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(PORT, () => {
  log.info({ port: PORT }, `${SERVICE} HTTP probe listener up`);
  run().catch(err => {
    log.error({ err }, 'consumer crashed');
    process.exit(1);
  });
});
