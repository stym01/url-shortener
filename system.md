# System Design: Shortify (Advanced Architecture)

This document outlines the architectural decisions, caching strategies, and scalability considerations implemented in the advanced version of the Shortify URL shortener.

## 1. System Architecture

The application is built to handle highly concurrent, viral read-heavy traffic using a multi-tier architecture.

* **Compute:** Node.js / Express (Dockerized)
* **L1 Cache (In-Memory):** LRU Cache (Microsecond lookup)
* **L2 Cache (Distributed):** Redis (Millisecond lookup)
* **Primary Database:** PostgreSQL (Indexed for $O(\log n)$ lookup)
* **Security:** Strategy-based Rate Limiter (Token Bucket)

## 2. Multi-Layer Caching Strategy

A standard database cannot survive a "viral link" scenario where a single short URL receives thousands of clicks per second. To solve this, traffic is intercepted across two caching layers:

1. **L1 (In-Memory Node.js Cache):** The fastest layer. Stores the most frequently accessed URLs directly in the Node.js process RAM. Capacity is strictly limited to 5,000 items to prevent memory leaks.
2. **L2 (Redis):** If L1 misses, the request queries Redis. This serves as a distributed cache shared across all horizontal Node.js instances.
3. **Database Fallback:** Only if L1 and L2 miss is the PostgreSQL database queried.

### Cache Stampede Prevention
If a viral URL's cache expires, thousands of simultaneous requests would normally flood the database. This system prevents cache stampedes using a **Distributed Lock** in Redis (`SETNX`). 
* The *first* request acquires the lock and queries the database.
* Subsequent requests wait 50ms and recursively check the cache again, effectively shielding the database from redundant queries.

## 3. Rate Limiting (Token Bucket)

To prevent abuse and DDoS attacks, a custom **Token Bucket Rate Limiter** is implemented using Redis as the state store. 
* **Why Token Bucket?** It allows for sudden, legitimate bursts of traffic (up to the bucket capacity) while maintaining a strict long-term limit via a steady refill rate.
* By storing the state in Redis rather than local memory, the rate limiter works perfectly even when the application is horizontally scaled across multiple load-balanced servers.

## 4. Scaling to 1,000,000 Users

If traffic scales to 1M+ active users, the current architecture would be expanded via the following steps:

1. **Horizontal Compute Scaling:** Spin up multiple Node.js Docker containers behind an AWS Application Load Balancer (ALB). The stateless nature of the app (thanks to Redis) makes this trivial.
2. **Database Connection Pooling:** Under extreme load, PostgreSQL connection limits will break first. I would introduce **PgBouncer** to pool database connections.
3. **ID Generation (V2 Prep):** The current `nanoid` generation will eventually slow down due to collision checks. The database schema is already prepared (`VARCHAR(25)`) to swap `nanoid` for a **64-bit Twitter Snowflake ID** generation strategy, allowing decentralized, collision-free ID generation at scale.

## 5. Performance Benchmarks

Tested locally using `k6` with 50 concurrent virtual users over 20 seconds (Docker environment):

* **Total Requests Processed:** ~7,000
* **Average Latency:** 7.12ms
* **Median Latency:** 4.08ms
* **Success Rate:** 100% (No dropped connections under load)