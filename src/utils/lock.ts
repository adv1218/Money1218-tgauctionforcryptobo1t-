import { redis } from '../config/redis.js';

export class Lock {
    private key: string;
    private ttl: number;
    private acquired: boolean = false;

    constructor(key: string, ttlSeconds: number = 30) {
        this.key = `lock:${key}`;
        this.ttl = ttlSeconds;
    }

    async acquire(): Promise<boolean> {
        const result = await redis.set(this.key, '1', 'EX', this.ttl, 'NX');
        this.acquired = result === 'OK';
        return this.acquired;
    }

    async release(): Promise<void> {
        if (this.acquired) {
            await redis.del(this.key);
            this.acquired = false;
        }
    }

    async extend(ttlSeconds: number): Promise<boolean> {
        if (!this.acquired) return false;
        const result = await redis.expire(this.key, ttlSeconds);
        return result === 1;
    }
}

export async function withLock<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds: number = 30,
    retries: number = 5,
    retryDelayMs: number = 500
): Promise<T> {
    const lock = new Lock(key, ttlSeconds);

    for (let i = 0; i < retries; i++) {
        if (await lock.acquire()) {
            try {
                return await fn();
            } finally {
                await lock.release();
            }
        }

        if (i < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
    }

    throw new Error(`Failed to acquire lock after ${retries} attempts: ${key}`);
}
