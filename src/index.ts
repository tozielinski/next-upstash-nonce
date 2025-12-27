'use server'

import {Redis} from "@upstash/redis";
import {v4 as uuid} from "uuid";

export type NonceOptions = {
    // length?: number; // bytes
    ttlNonce?: number; // TTL for nonce in Redis
    prefix?: string;
    ttlRateLimit?: number; // TTL for rate limiting counter in Redis
    countRateLimit?: number;
};

export type NonceCheckResult = | {
    valid: true;
    nonce: string
} | {
    valid: false;
    reason: 'missing-header' | 'invalid-or-expired';
    response: Response
};

export type RateLimitResult = | {
    valid: true;
    ip: string;
    requests: number;
} | {
    valid: false;
    ip: string;
    requests: number;
    reason: `too-many-requests: ${number}`;
    response?: Response;
};

export class NonceManager {
    private redis: Redis;
    private readonly ttlNonce: number;
    private readonly prefix: string;
    private readonly ttlRateLimit: number;
    private readonly countRateLimit: number;


    constructor(redis: Redis, opts: NonceOptions = {}) {
        this.redis = redis;
        this.ttlNonce = opts.ttlNonce ?? 60; // default 1 minute
        this.prefix = opts.prefix ?? "nonce:";
        this.ttlRateLimit = opts.ttlRateLimit ?? 60; // default 1 minute
        this.countRateLimit = opts.countRateLimit ?? 5; // default 5 times
    }

    /**
     * makes option parameters available in the server in environment files
     */
    private getEnvValue(name: string, fallback: number): number {
        const val = process.env[name];
        const num = Number(val);

        if (val === undefined || isNaN(num)) {
            return fallback;
        }
        return num;
    }


    /**
     * extracts client IP from request headers
     */
    private getClientIp(req: Request): string {
        const forwardedFor = req.headers.get("x-forwarded-for");
        if (forwardedFor) {
            return forwardedFor.split(",")[0].trim();
        }
        const realIp = req.headers.get("x-real-ip");
        if (realIp) {
            return realIp;
        }
        return "unknown";
    }

    /**
     * extracts client IP from headers for server actions
     */
    async getClientIpFromHeaders(headers: Headers): Promise<string> {
        const forwardedFor = headers.get("x-forwarded-for");
        if (forwardedFor) {
            return forwardedFor.split(",")[0].trim();
        }

        const realIp = headers.get("x-real-ip");
        if (realIp) {
            return realIp;
        }

        return "unknown";
    }

    /**
     * generates a new, secure nonce,
     * inserts it into Redis with a TTL,
     * and returns the nonce string.
     */
    async create(): Promise<string> {
        const nonce = uuid();
        const key = this.prefix + nonce;
        const ttl = this.getEnvValue("NONCE_TTL_SECONDS", this.ttlNonce);

        await this.redis.set(key, "1", {ex: ttl});
        return nonce;
    }


    /**
     * verifies a nonce and deletes it from Redis,
     * returning true if the nonce exists and has not expired.
     */
    async verify(nonce: string): Promise<boolean> {
        if (!nonce) return false;

        try {
            const res = await (this.redis as any).get(`nonce:${nonce}`);
            return res !== null;
        } catch (err) {
            console.error("verify error:", err);
            return false;
        }
    }


    /**
     * verifies a nonce and deletes it from Redis,
     * returning true if the nonce exists and has not expired.
     */
    async verifyAndDelete(nonce: string): Promise<boolean> {
        if (!nonce) return false;

        try {
            const res = await (this.redis as any).get(`nonce:${nonce}`);
            // const res = await (this.redis as any).eval(script, { keys: [key] });
            if (res) await this.redis.del(`nonce:${nonce}`);
            return res !== null;
        } catch (err) {
            console.error("verifyAndDelete error:", err);
            return false;
        }
    }


    /**
     * verifies nonce from the Header of a request
     * returns a NonceCheckResult if the nonce exists and has not expired.
     */
    async verifyNonceFromRequest(req: Request): Promise<NonceCheckResult> {
        const nonce = req.headers.get("x-api-nonce");

        if (!nonce) {
            const response = Response.json(
                {error: "Missing x-api-nonce header"},
                {status: 403}
            );
            return {
                valid: false,
                reason: "missing-header",
                response,
            };
        }

        const valid = await this.verify(nonce);

        if (!valid) {
            const response = Response.json(
                {error: "Invalid or expired nonce"},
                {status: 403}
            );
            return {
                valid: false,
                reason: "invalid-or-expired",
                response,
            };
        }

        return {
            valid: true,
            nonce,
        };
    }


    /**
     * verifies nonce from the Header of a request and deletes it from Redis
     * returns a NonceCheckResult if the nonce exists and has not expired.
     */
    async verifyAndDeleteNonceFromRequest(req: Request): Promise<NonceCheckResult> {
        const nonce = req.headers.get("x-api-nonce");

        if (!nonce) {
            const response = Response.json(
                {error: "Missing x-api-nonce header"},
                {status: 403}
            );
            return {
                valid: false,
                reason: "missing-header",
                response,
            };
        }

        const valid = await this.verifyAndDelete(nonce);

        if (!valid) {
            const response = Response.json(
                {error: "Invalid or expired nonce"},
                {status: 403}
            );
            return {
                valid: false,
                reason: "invalid-or-expired",
                response,
            };
        }

        return {
            valid: true,
            nonce,
        };
    }


    /**
     * Optional: delete nonce from Redis manually
     */
    async delete(nonce: string): Promise<void> {
        const key = this.prefix + nonce;
        await this.redis.del(key);
    }


    /**
     * rate limits requests from the same IP address
     */
    async rateLimiter(req: Request): Promise<RateLimitResult> {
        const ip = this.getClientIp(req);
        const key = `rate:${ip}`;
        const requests = (await this.redis.incr(key)) ?? 0;

        if (requests === 1) {
            await this.redis.expire(
                key,
                this.getEnvValue("RATE_LIMIT_TTL_SECONDS", this.ttlRateLimit)
            ); // counter runs 60s
        }

        if (requests > this.getEnvValue("RATE_LIMIT_COUNT", this.countRateLimit)) {
            const response = Response.json({error: "Too many requests"}, {status: 429});
            return {
                valid: false,
                ip,
                requests,
                reason: `too-many-requests: ${requests}`,
                response: response
            };
        }

        return {valid: true, ip, requests};
    }

    async rateLimiterByIp(ip: string): Promise<RateLimitResult> {
        const key = `rate:${ip}`;
        const requests = (await this.redis.incr(key)) ?? 0;

        if (requests === 1) {
            await this.redis.expire(
                key,
                this.getEnvValue("RATE_LIMIT_TTL_SECONDS", this.ttlRateLimit)
            );
        }

        if (requests > this.getEnvValue("RATE_LIMIT_COUNT", this.countRateLimit)) {
            return {
                valid: false,
                ip,
                requests,
                reason: `too-many-requests: ${requests}`,
            };
        }

        return {valid: true, ip, requests};
    }
}

export default NonceManager;