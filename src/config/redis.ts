import Redis from 'ioredis';
import { config } from './env.js';

let redisUrl = config.redisUrl;

if (redisUrl.startsWith('"') || redisUrl.startsWith("'")) {
    redisUrl = redisUrl.slice(1);
}
if (redisUrl.endsWith('"') || redisUrl.endsWith("'")) {
    redisUrl = redisUrl.slice(0, -1);
}

console.log('Redis URL:', redisUrl.substring(0, 30) + '...');

const options: Record<string, unknown> = {
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
    },
};

if (redisUrl.startsWith('rediss://')) {
    options.tls = {};
}

export const redis = new Redis(redisUrl, options);

redis.on('connect', () => {
    console.log('Connected to Redis');
});

redis.on('error', (err) => {
    console.error('Redis error:', err.message);
});
