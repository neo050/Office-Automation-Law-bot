// src/lib/redis.js   
import Redis from 'ioredis';
export default new Redis({
host:     process.env.REDIS_HOST || '127.0.0.1',
  port:     process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASS || undefined,
  // אופציונלי: חיבור אוטומטי מחדש רגוע יותר
  retryStrategy: (times) => Math.min(times * 100, 5_000),
});