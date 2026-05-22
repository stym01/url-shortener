import express from 'express';
import { createShortUrl, redirectUrl } from '../controllers/url.controller.js';
import { tokenBucketLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Limit URL creation
router.post('/shorten', tokenBucketLimiter, createShortUrl);

// Limit URL redirects
router.get('/:shortCode', tokenBucketLimiter, redirectUrl); //temp remove ratelimiter to tesst k6

export default router;