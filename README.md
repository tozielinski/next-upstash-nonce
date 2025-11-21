# next-upstash-nonce
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)


Create, store, verify and delete nonces in Redis by Upstash for Next.js

# Quick Start
### Install the package:
```bash
npm install @tozielinski/next-upstash-nonce
```
### Create database
Create a new redis database on [upstash](https://console.upstash.com/)
### Create a NonceManager Instance
```typescript
import { NonceManager } from '@tozielinski/next-upstash-nonce'
import { Redis } from "@upstash/redis";

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL as string,
    token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
});

export const nonceManager = new NonceManager(redis, {ttlSeconds: 60* 5});
```
### Create a ServerAction, to use it from client side
```typescript
'use server'

import {nonceManager} from "@/[wherever you store your nonceManager instance]";

export async function createNonce(): Promise<string> {
    return await nonceManager.create();
}
```
### Secure your API endpoint
```typescript
'use server'

import {NextResponse} from "next/server";
import {nonceManager} from "@/[wherever you store your nonceManager instance]";

export async function POST(req: Request) {
    const nonce = req.headers.get("x-api-nonce");

    if (!nonce) {
        return NextResponse.json(
            { error: "Missing nonce", valid: false },
            { status: 401 }
        );
    }

    const valid = await nonceManager.verifyAndDelete(nonce);

    return NextResponse.json({nonce: nonce, valid: valid});
}
```
### Use it in your client side
```typescript
'use client'

import {useState} from "react";
import {createNonce} from "@/[wherever you store your server action]";

export default function NonceSecuredComponent() {
    const [running, setRunning] = useState(false);
    const [message, setMessage] = useState("");

    const handleClick = async () => {
        if (running) return;
        setRunning(true);
        setMessage("Starting SSA...");

        const nonce = await createNonce();

        const res = await fetch('/api/[name of your API endpoint]', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Nonce': nonce,
            },
            body: JSON.stringify({success: true}),
        });

        if (res.ok) {
            const data = await res.json();
            setMessage(`Nonce: ${data.nonce} Valid: ${data.valid}` || "No nonce received");
            setRunning(false);
        } else
            setMessage(res.statusText);
    }

    return (
        <div>
            <button
                onClick={handleClick}
                disabled={running}
                className="px-6 py-3 rounded-xl bg-blue-600 text-white disabled:opacity-50"
            >
                {running ? "Running..." : "Start SSA"}
            </button>
            <p>{message}</p>
        </div>
    )
}
```

