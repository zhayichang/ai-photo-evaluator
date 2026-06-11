import Redis from "ioredis";

class MemoryStore {
    constructor() {
        this.values = new Map();
    }

    cleanup(key) {
        const item = this.values.get(key);
        if (item && item.expiresAt <= Date.now()) this.values.delete(key);
    }

    async increment(key, ttlSeconds) {
        this.cleanup(key);
        const item = this.values.get(key) || { value: 0, expiresAt: Date.now() + ttlSeconds * 1000 };
        item.value += 1;
        this.values.set(key, item);
        return item.value;
    }

    async get(key) {
        this.cleanup(key);
        return this.values.get(key)?.value ?? null;
    }

    async set(key, value, ttlSeconds, onlyIfMissing = false) {
        this.cleanup(key);
        if (onlyIfMissing && this.values.has(key)) return false;
        this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
        return true;
    }

    async delete(key) {
        this.values.delete(key);
    }
}

class RedisStore {
    constructor(url) {
        this.redis = new Redis(url, { maxRetriesPerRequest: 2, enableReadyCheck: true });
    }

    async increment(key, ttlSeconds) {
        const result = await this.redis.multi().incr(key).expire(key, ttlSeconds, "NX").exec();
        return Number(result[0][1]);
    }

    async get(key) {
        const value = await this.redis.get(key);
        return value === null ? null : JSON.parse(value);
    }

    async set(key, value, ttlSeconds, onlyIfMissing = false) {
        const args = [key, JSON.stringify(value), "EX", ttlSeconds];
        if (onlyIfMissing) args.push("NX");
        return (await this.redis.set(...args)) === "OK";
    }

    async delete(key) {
        await this.redis.del(key);
    }
}

export function createStore(env = process.env) {
    if (env.REDIS_URL) return new RedisStore(env.REDIS_URL);
    if (env.NODE_ENV === "production") {
        throw new Error("生产环境必须配置 REDIS_URL，避免限流和去重失效");
    }
    return new MemoryStore();
}

export async function enforceRateLimits(store, ip, env = process.env) {
    const now = new Date();
    const hourKey = now.toISOString().slice(0, 13);
    const dayKey = now.toISOString().slice(0, 10);
    const limits = [
        [`rate:ip-hour:${ip}:${hourKey}`, Number(env.RATE_LIMIT_IP_HOURLY || 3), 3700],
        [`rate:ip-day:${ip}:${dayKey}`, Number(env.RATE_LIMIT_IP_DAILY || 10), 90000],
        [`rate:global-day:${dayKey}`, Number(env.RATE_LIMIT_GLOBAL_DAILY || 100), 90000]
    ];

    for (const [key, limit, ttl] of limits) {
        const count = await store.increment(key, ttl);
        if (count > limit) {
            throw Object.assign(new Error("当前使用次数已达到限制，请稍后再试"), {
                code: "RATE_LIMITED",
                status: 429
            });
        }
    }
}
