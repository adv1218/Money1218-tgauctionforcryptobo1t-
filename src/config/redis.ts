import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { config } from './env.js';

let redisUrl = config.redisUrl;

// Clean quotes if present
if (redisUrl.startsWith('"') || redisUrl.startsWith("'")) {
    redisUrl = redisUrl.slice(1);
}
if (redisUrl.endsWith('"') || redisUrl.endsWith("'")) {
    redisUrl = redisUrl.slice(0, -1);
}

console.log('Redis URL:', redisUrl.substring(0, 30) + '...');

const options: RedisOptions = {
    maxRetriesPerRequest: null, // Don't limit retries for commands
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
        // Always retry with exponential backoff
        const delay = Math.min(times * 500, 10000);
        console.log(`Redis reconnecting attempt ${times}, delay ${delay}ms`);
        return delay;
    },
    reconnectOnError: (err: Error) => {
        // Reconnect on connection errors
        console.log('Redis reconnecting due to error:', err.message);
        return true;
    },
};

// Enable TLS for Redis Cloud (rediss://)
if (redisUrl.startsWith('rediss://')) {
    options.tls = {};
}

// Create Redis client
const RedisClient = (Redis as any).default || Redis;
export const redis = new RedisClient(redisUrl, options);

redis.on('connect', () => {
    console.log('Redis: connecting...');
});

redis.on('ready', () => {
    console.log('Redis: ready');
});

redis.on('close', () => {
    console.log('Redis: connection closed');
});

redis.on('error', (err: Error) => {
    console.error('Redis error:', err.message);
});

redis.on('reconnecting', () => {
    console.log('Redis: reconnecting...');
});
