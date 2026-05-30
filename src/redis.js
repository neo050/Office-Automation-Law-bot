// src/redis.js
import Redis from 'ioredis';

export default new Redis({
  host:     process.env.REDIS_HOST || '127.0.0.1',
  port:     process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASS || undefined,
  // Don't open a socket at import time — connect on the first command.
  // Keeps modules that merely import redis (e.g. for types) from holding
  // the event loop open, and lets the process exit cleanly when idle.
  lazyConnect: true,
  // Calmer automatic reconnection back-off.
  retryStrategy: (times) => Math.min(times * 100, 5_000),
});
