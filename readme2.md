# Shortify Workflow Architecture

This document outlines the detailed workflow of the Shortify URL shortener, including both URL creation and the multi-tiered cache redirection mechanism.

## System Workflow Diagram

```mermaid
graph TD
    %% Define User
    User((User))

    %% Define Endpoints
    subgraph Express Application
        R1[POST /api/shorten]
        R2[GET /:shortCode]
        
        %% Rate Limiter
        RL1{Rate Limiter Passed?}
        RL2{Rate Limiter Passed?}
    end

    %% URL Creation Flow
    subgraph URL Creation Controller
        C1[Extract body: original_url, custom_alias, expires_at]
        C2{Is custom_alias provided?}
        C3[Check DB for alias uniqueness]
        C4{Alias taken?}
        C5[Generate short_code via nanoid]
        C6[Generate ID via nanoid]
        C7[(Insert into PostgreSQL)]
        C8[Generate QR Code]
        C9[Return 201: short_url, qr_code]
        C10[Return 400: Error]
        C11[Return 500: Server Error]
    end

    %% Redirect Flow
    subgraph Redirect Controller
        D1[Extract shortCode from params]
        D2{Check L1 Cache - LRU}
        D3[Return Redirect]
        D4{Check L2 Cache - Redis}
        D5[Populate L1 Cache]
        
        %% Stampede Prevention
        D6{Try Acquire Redis Lock NX}
        D7[Sleep 50ms & Retry Redirect]
        
        %% Database
        D8[(Query DB for short_code)]
        D9{Record Found?}
        D10{Has Expired?}
        
        %% Repopulate & Return
        D11[Populate L2 Cache - Redis EX:3600]
        D12[Populate L1 Cache - LRU]
        D13[Release Redis Lock]
        D14[Return Redirect]
        
        %% Errors
        E1[Release Lock]
        E2[Return 404: Not Found]
        E3[Return 410: Expired]
        E4[Return 500: Server Error]
    end

    %% Error Handlers for Rate Limit
    RL_Err1[Return 429: Too Many Requests]
    RL_Err2[Return 429: Too Many Requests]

    %% Connect User to Endpoints
    User -->|Creates URL| R1
    User -->|Accesses Short URL| R2

    %% Connect Endpoints to Rate Limiter
    R1 --> RL1
    R2 --> RL2

    RL1 -- No --> RL_Err1
    RL2 -- No --> RL_Err2

    RL1 -- Yes --> C1
    RL2 -- Yes --> D1

    %% URL Creation Logic
    C1 --> C2
    C2 -- Yes --> C3
    C3 --> C4
    C4 -- Yes --> C10
    C4 -- No --> C6
    C2 -- No --> C5
    C5 --> C6
    C6 --> C7
    C7 --> C8
    C8 --> C9
    
    C7 -. Error .-> C11
    C3 -. Error .-> C11

    %% Redirect Logic
    D1 --> D2
    D2 -- Hit --> D3
    D2 -- Miss --> D4
    
    D4 -- Hit --> D5
    D5 --> D3
    
    D4 -- Miss --> D6
    
    D6 -- Lock Failed --> D7
    D7 --> D1
    
    D6 -- Lock Acquired --> D8
    D8 --> D9
    
    D9 -- No --> E1
    E1 --> E2
    
    D9 -- Yes --> D10
    D10 -- Yes --> E1
    E1 --> E3
    
    D10 -- No --> D11
    D11 --> D12
    D12 --> D13
    D13 --> D14
    
    D8 -. Error .-> E4
```

### Detailed Steps Explained

#### 1. Rate Limiting (Token Bucket)
Every request hitting `/api/shorten` or `/:shortCode` goes through the `tokenBucketLimiter`. It checks a Redis hash for the user's IP. It allows a burst of 5 requests and refills at a rate of 1 token per second. If tokens are `< 1`, it immediately returns a `429 Too Many Requests`.

#### 2. Short URL Creation (`POST /api/shorten`)
- Extracts the requested data from the payload.
- If a custom alias is provided, it validates its uniqueness against PostgreSQL. If taken, returns `400`.
- If no alias is provided, generates a random 7-character string using `nanoid`.
- Creates a 15-character UUID for the primary key.
- Persists the URL mapping into PostgreSQL.
- Generates a Base64-encoded QR Code for the short URL.
- Returns a `201` status with the shortened URL and QR code.

#### 3. URL Redirection (`GET /:shortCode`)
This workflow features a robust multi-tiered caching system with stampede prevention:
- **L1 Cache (In-Memory LRU)**: Checks the Node.js LRU cache first. If a hit occurs, redirects immediately.
- **L2 Cache (Redis)**: If L1 misses, it checks Redis. If a hit occurs, it populates the L1 cache for subsequent requests and redirects.
- **Cache Stampede Prevention**: If both caches miss, it attempts to acquire a short-lived distributed lock in Redis (`lock:shortCode` with `NX`). 
  - If it fails to acquire the lock (meaning another process is already fetching the data from the DB), it sleeps for 50ms and retries the entire redirect function recursively.
- **Database Fetch**: The process that acquired the lock fetches the original URL and expiry data from PostgreSQL.
- **Validation**: Checks if the record exists (returns `404` if not) and checks if the URL has expired (returns `410` if so). It releases the lock in both failure cases.
- **Cache Warming**: Populates Redis (L2) with a 3600-second TTL, then populates the LRU (L1).
- **Completion**: Releases the Redis lock and issues the HTTP redirect to the original URL.
