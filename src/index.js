'use server';
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NonceManager = void 0;
const uuid_1 = require("uuid");
class NonceManager {
    redis;
    length;
    ttlSeconds;
    prefix;
    constructor(redis, opts = {}) {
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
    async create() {
        // const buffer = crypto.randomBytes(this.length);
        // const nonce = buffer.toString("hex");
        const nonce = (0, uuid_1.v4)();
        const key = this.prefix + nonce;
        // console.log("creating nonce:", nonce);
        // set with ttl (nx not required — collisions extremely unlikely)
        await this.redis.set(key, "1", { ex: this.ttlSeconds });
        return nonce;
    }
    /**
     * verifies a nonce and deletes it from Redis,
     * returning true if the nonce exists and has not expired.
     */
    async verifyAndDelete(nonce) {
        if (!nonce)
            return false;
        //       const key = this.prefix + nonce;
        //
        //       const script = `
        //   local v = redis.call('GET', KEYS[1])
        //   if v then
        //     redis.call('DEL', KEYS[1])
        //     return v
        //   end
        //   return nil
        // `;
        try {
            const res = await this.redis.get(`nonce:${nonce}`);
            // const res = await (this.redis as any).eval(script, { keys: [key] });
            if (res)
                await this.redis.del(`nonce:${nonce}`);
            return res !== null;
        }
        catch (err) {
            console.error("verifyAndDelete error:", err);
            return false;
        }
    }
    /**
     * Optional: delete a nonce from Redis manually
     */
    async delete(nonce) {
        const key = this.prefix + nonce;
        await this.redis.del(key);
    }
}
exports.NonceManager = NonceManager;
exports.default = NonceManager;
