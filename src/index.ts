'use server'

import { Redis } from "@upstash/redis";
import {v4 as uuid} from "uuid";

export type NonceOptions = {
    length?: number; // bytes
    ttlSeconds?: number; // Time-to-live in Redis
    prefix?: string;
};

export type NonceCheckResult = | {
    valid: true;
    nonce: string
} | {
    valid: false;
    reason: "missing-header" | "invalid-or-expired";
    response: Response
};

export class NonceManager {
    private redis: Redis;
    private length: number;
    private ttlSeconds: number;
    private prefix: string;


    constructor(redis: Redis, opts: NonceOptions = {}) {
        this.redis = redis;
        this.length = opts.length ?? 32; // default 32 bytes -> 64 hex chars
        this.ttlSeconds = opts.ttlSeconds ?? 60 * 5; // default 5 minutes
        this.prefix = opts.prefix ?? "nonce:";
    }


    /**
     * generates a new, secure nonce,
     * inserts it into Redis with a TTL,
     * and returns the nonce string.
     */
    async create(): Promise<string> {
        const nonce = uuid();
        const key = this.prefix + nonce;

        await this.redis.set(key, "1", { ex: this.ttlSeconds });
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
     * verifies a nonce from the Header of a request
     * returns a NonceCheckResult if the nonce exists and has not expired.
     */
    async verifyNonceFromRequest(req: Request): Promise<NonceCheckResult> {
        const nonce = req.headers.get("x-api-nonce");

        if (!nonce) {
            const response = Response.json(
                { error: "Missing x-api-nonce header" },
                { status: 403 }
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
                { error: "Invalid or expired nonce" },
                { status: 403 }
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
     * verifies a nonce from the Header of a request and deletes it from Redis
     * returns a NonceCheckResult if the nonce exists and has not expired.
     */
    async verifyAndDeleteNonceFromRequest(req: Request): Promise<NonceCheckResult> {
        const nonce = req.headers.get("x-api-nonce");

        if (!nonce) {
            const response = Response.json(
                { error: "Missing x-api-nonce header" },
                { status: 403 }
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
                { error: "Invalid or expired nonce" },
                { status: 403 }
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
     * Optional: delete a nonce from Redis manually
     */
    async delete(nonce: string): Promise<void> {
        const key = this.prefix + nonce;
        await this.redis.del(key);
    }
}


export default NonceManager;