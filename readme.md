# Shortify: High-Throughput Distributed URL Router

![Express.js](https://img.shields.io/badge/Express.js-green)
![Node.js](https://img.shields.io/badge/Node.js-green)
![Database](https://img.shields.io/badge/database-PostgreSQL%20%7C%20Redis-blue)
![Architecture](https://img.shields.io/badge/architecture-Distributed%20System-success)
![Hosting](https://img.shields.io/badge/hosting-AWS%20EC2%20%7C%20S3-orange)
![Deployment](https://img.shields.io/badge/deployment-production%20ready-blue)

---

Shortify is a high-performance, distributed URL shortening engine. It is engineered to route links with minimal latency by utilizing a multi-layer caching architecture. Rather than querying the database for every click, the system aggressively caches frequently accessed URLs in memory, allowing for high traffic throughput.

It also features a custom Token-Bucket rate-limiting algorithm to prevent abuse and automatically generates Base64 QR codes for every shortened link.

## Live Demo
* **Frontend Infrastructure:** [S3 Static Website Hosting](http://shortify-frontend.s3-website-us-east-1.amazonaws.com/)
* **Backend Ingress Endpoint:** `http://100.53.37.203:3000`

## Table of Contents
* [Key Features](#key-features)
* [System Architecture](#system-architecture)
* [Deployment Architecture](#deployment-architecture)
* [Live API Usage](#live-api-usage)
* [Build and Run Locally](#build-and-run-locally)

## Key Features

* **Multi-Layer Caching**: Uses a two-tier cache system. An L1 in-memory LRU cache handles the absolute hottest links, while an L2 Redis cache handles general frequent requests. 
* **Token-Bucket Rate Limiting**: Implements algorithmic traffic control to throttle high-concurrency requests and protect the system from DDoS attacks.
* **Database Persistence**: PostgreSQL is used as the ultimate source of truth, storing all URL mappings safely on disk.
* **Instant QR Generation**: Converts generated short links directly into Base64 image strings on the fly, eliminating the need to store image files on a server.
* **Serverless Frontend**: The UI is built using HTML/CSS, optimized for instantaneous page loads.

## System Architecture

The workload is split across separate, independent services working together over a network to ensure the main Node.js server never blocks.

**Data Flow for a Redirect (GET):**
1. The user clicks a short link.
2. The server first checks the **L1 (Local) Cache**. If found, it redirects instantly.
3. If not in L1, it checks the **L2 (Redis) Cache**. If found, it updates L1 and redirects.
4. If there is a complete cache miss, it queries **PostgreSQL**, updates both Redis and L1, and then redirects.

```mermaid
graph TD
    Client[User Request] -->|HTTP POST/GET| API[Node.js Router]
    API -->|Check 1| L1[L1 LRU Memory Cache]
    API -->|Check 2| Redis[L2 Redis Cache]
    API -->|Check 3| DB[(PostgreSQL Database)]
    API -->|Format| QR[Base64 QR Generator]

```
## Traffic Control & Rate Limiting

To prevent API abuse and protect our downstream database from high-concurrency spikes, the router implements an aggressive traffic control layer using a custom Token-Bucket algorithm. 

This mechanism acts as an algorithmic gatekeeper at the network ingress, shaping traffic patterns before requests hit any heavy database or cache routing operations.

**Data Flow for Traffic Ingress:**
1. A client initiates a request (e.g., `POST /api/shorten`).
2. The rate limiter intercepts the request and identifies the client identity.
3. The system checks the token bucket capacity for that specific client:
   * **Tokens Available:** The system consumes a token, updates the bucket status, and routes the request forward.
   * **Bucket Empty:** The request is rejected instantly with an `HTTP 429 Too Many Requests` status, bypassing all internal computational workflows.
4. Tokens are refilled automatically at a fixed, deterministic interval to replenish client capacity.

```mermaid
graph TD
    Client[Incoming Client Request] -->|Ingress| Limiter[Token-Bucket Rate Limiter]
    Limiter -->|Tokens Available?| Check{Decision Matrix}
    Check -->|Yes: Consume 1 Token| Pass[Route to Caching/Database Layer]
    Check -->|No: Bucket Exhausted| Drop[Drop Request: HTTP 429 Too Many Requests]
    Refill[Automatic Refill Timer] -->|Replenish Tokens| Limiter
```
## Deployment Architecture

The entire infrastructure is natively deployed across the Amazon Web Services (AWS) ecosystem to optimize cost, reliability, and speed.

### 1. Frontend Web Layer (Amazon S3)
The frontend interface is decoupled from the compute resources and hosted as a static application.
* **Serverless Delivery:** Deployed using **Amazon S3 Static Website Hosting**, eliminating server runtime management and providing instant global file delivery.
* **Security Settings:** Public read configurations are managed via a strict S3 Bucket Policy allowing public access solely to the compiled `index.html` file via standard web endpoints.

### 2. Compute & Database Layer (Amazon EC2)
The application core, caching layers, and relational store run inside an isolated virtual environment.
* **Compute Instance:** Hosted on a Linux **AWS EC2** virtual machine instance running the Express/Node.js routing application.
* **Network Security:** Network traffic is locked down via an EC2 **Security Group**, configured to drop all invalid traffic while leaving port `3000` open for standard public HTTP ingress.
* **CORS Handshake:** Cross-Origin Resource Sharing is enabled natively within the API layers, securely authorizing inbound connection streams coming from the S3 static website origin.


## Live API Usage

The following end-to-end client-server interaction profile details how data is parsed, stored, and sent back across the network from our live AWS infrastructure.

### 1. Create a Short Link
**Request Payload:**
```http
POST http://100.53.37.203:3000/api/shorten
Content-Type: application/json

{
    "original_url": "https://github.com"
}
```

**JSON Structural Response (201 Created):**
```json
{
    "message": "URL shortened successfully",
    "data": {
        "id": "J_LjdiJEB_mKMpR",
        "original_url": "https://github.com",
        "short_code": "oPkRAAG",
        "custom_alias": null,
        "expires_at": null,
        "created_at": "2026-05-22T20:39:35.038Z",
        "short_url": "http://100.53.37.203:3000/oPkRAAG",
        "qr_code": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
    }
}
```

### 2. Target Redirection
When any client navigates to the produced `short_url` endpoint (`http://100.53.37.203:3000/oPkRAAG`), the underlying routing service executes an internal memory scan, pops a `302 Found` server status header, and redirects the network connection to the original target destination under `7ms`.


## Build and Run Locally

### Prerequisites
* Node.js (v18+)
* PostgreSQL instance
* Redis server

### Local Setup
1. Clone the repository:
```bash
git clone https://github.com/stym01/Distributed-url-shortener-with-multi-layer-caching-and-rate-limiting.git
cd Distributed-url-shortener-with-multi-layer-caching-and-rate-limiting
```

2. Install runtime modules:
```bash
npm install
```

3. Configure environment conditions in a root `.env` file:
```env
PORT=3000
DATABASE_URL=postgres://user:password@localhost:5432/shortify
REDIS_URL=redis://localhost:6379
```

4. Boot the server:
```bash
npm start
```

## Performance Benchmarks

Tested locally using `k6` with 50 concurrent virtual users over 20 seconds (Docker environment):

* **Total Requests Processed:** ~7,000
* **Average Latency:** 7.12ms
* **Median Latency:** 4.08ms
* **Success Rate:** 100% (No dropped connections under load)

## Database Schema Design

The relational database layer is designed for speed and consistency, utilizing strict indexing on lookup columns to maintain quick query times during cache misses.

```sql
CREATE TABLE urls (
    id VARCHAR(15) PRIMARY KEY,
    original_url TEXT NOT NULL,
    short_code VARCHAR(10) UNIQUE NOT NULL,
    custom_alias VARCHAR(50) UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for fast transactional lookups on cache misses
CREATE INDEX idx_urls_short_code ON urls(short_code);
```

---

## Edge Case Handling & System Resilience

To maintain high availability and accurate data handling, the system natively implements defensive programming structures for complex edge states:

*   **Cache Stampede Protection:** If a highly popular link expires from the cache simultaneously under high traffic, the system prevents a "thundering herd" problem by gating database lookups, ensuring the database isn't overwhelmed by duplicate queries.
*   **Database Fallback (Graceful Degradation):** If the L2 Redis cache goes offline unexpectedly, the application layer catches the network exception, logs the telemetry error, and gracefully degrades to query the PostgreSQL database directly so the user's redirect never breaks.

---
