import redisClient from '../config/redis.js';

export const tokenBucketLimiter = async (req, res, next) => {
    // Identify the user by their IP address
    const ip = req.ip || req.connection.remoteAddress;
    const key = `rate:token:${ip}`;

    // Configuration
    const capacity = 5;       // Max burst of 5 requests at once
    const refillRate = 1;     // Refill 1 token per second
    const windowSec = 60;     // Clean up Redis memory after 60 seconds of inactivity

    try {
        const data = await redisClient.hGetAll(key);
        const now = Math.floor(Date.now() / 1000);

        let tokens = capacity;
        let lastRefill = now;

        // If the user has made a request recently, calculate their current tokens
        if (Object.keys(data).length > 0) {
            tokens = parseFloat(data.tokens);
            lastRefill = parseInt(data.lastRefill);

            // Add tokens based on how much time has passed
            const timePassed = now - lastRefill;
            tokens = Math.min(capacity, tokens + (timePassed * refillRate));
        }

        // If no tokens are left, reject the request
        if (tokens < 1) {
            return res.status(429).json({ error: 'Too Many Requests. Please wait.' });
        }

        // Consume 1 token and update the timestamp
        await redisClient.hSet(key, [
            'tokens', (tokens - 1).toString(),
            'lastRefill', now.toString()
        ]);
        
        // Ensure the key eventually expires so Redis doesn't run out of memory
        await redisClient.expire(key, windowSec);

        // Allow the request to proceed
        next();

    } catch (error) {
        console.error('Rate Limiter Error:', error);
        // Fail-open strategy: If Redis crashes, don't break the whole app
        next();
    }
};