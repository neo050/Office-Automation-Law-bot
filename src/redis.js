// src/redis.js
import Redis from 'ioredis';

// Shared options for every connection mode.
const common = {
  // Don't open a socket at import time — connect on the first command.
  // Keeps modules that merely import redis (e.g. for types) from holding
  // the event loop open, and lets the process exit cleanly when idle.
  lazyConnect: true,
  // Calmer automatic reconnection back-off.
  retryStrategy: (times) => Math.min(times * 100, 5_000),
  // family:0 = dual-stack DNS lookup. Required for managed Redis reached over
  // a private IPv6-only network (e.g. Railway's *.railway.internal); harmless
  // elsewhere.
  family: 0,
};

// Cloud platforms (Railway, Upstash, Heroku, …) expose a single connection
// URL. Prefer it when present; otherwise fall back to discrete host/port/pass
// (the local + docker-compose flow).
const url = process.env.REDIS_URL || process.env.REDISCLOUD_URL;

export default url
  ? new Redis(url, common)
  : new Redis({
      host:     process.env.REDIS_HOST || '127.0.0.1',
      port:     process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASS || undefined,
      ...common,
    });
