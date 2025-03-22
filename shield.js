const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const { LRUCache } = require('lru-cache');

class MemoryStore {
  constructor() {
    this.rateLimits = new LRUCache({
      max: 50000,
      ttl: 60 * 1000,
      updateAgeOnGet: true
    });

    this.blacklist = new LRUCache({
      max: 10000,
      ttl: 60 * 60 * 1000,
      updateAgeOnGet: true
    });

    this.suspiciousActivities = new LRUCache({
      max: 25000,
      ttl: 15 * 60 * 1000,
      updateAgeOnGet: true
    });

    this.requestTimings = new LRUCache({
      max: 100000,
      ttl: 5 * 1000,
      updateAgeOnGet: true
    });
  }

  async incr(key, options) {
    const current = this.rateLimits.get(key) || 0;
    this.rateLimits.set(key, current + 1);
    return current + 1;
  }

  async decr(key) {
    const current = this.rateLimits.get(key) || 0;
    if (current > 0) {
      this.rateLimits.set(key, current - 1);
    }
  }

  async resetKey(key) {
    this.rateLimits.delete(key);
  }
}

const store = new MemoryStore();

const keyGenerator = (req) => {
  const userId = req.session?.userinfo?.id;
  const forwardedFor = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const ip = forwardedFor || realIp || req.ip;
  const userAgent = req.headers['user-agent'] || 'no-ua';
  return userId ? `${ip}-${userId}-${userAgent.slice(0, 32)}` : `${ip}-${userAgent.slice(0, 32)}`;
};

const burstConfig = {
  maxBurst: 20,
  burstWindow: 1000,
  blockDuration: 300000
};

const rateLimiter = rateLimit({
  store: store,
  windowMs: 60 * 1000,
  max: (req) => {
    const suspiciousScore = store.suspiciousActivities.get(keyGenerator(req)) || 0;
    if (req.session?.userinfo?.admin) return 300;
    if (suspiciousScore > 5) return 20;
    return 60;
  },
  message: {
    status: 429,
    error: 'Too many requests, please try again later.'
  },
  keyGenerator,
  skip: (req) => {
    const trustedIPs = ['127.0.0.1', '::1'];
    return trustedIPs.includes(req.ip) || req.session?.userinfo?.admin === true;
  }
});

const speedLimiter = slowDown({
  store: store,
  windowMs: 15 * 60 * 1000,
  delayAfter: (req) => {
    const suspiciousScore = store.suspiciousActivities.get(keyGenerator(req)) || 0;
    return Math.max(30, 100 - (suspiciousScore * 10));
  },
  delayMs: (used, req) => {
    return Math.min(2000, Math.pow(1.5, used - 100));
  },
  keyGenerator
});

const ddosProtection = (app) => {
  app.use(rateLimiter);
  app.use(speedLimiter);

  app.use((req, res, next) => {
    const key = keyGenerator(req);
    
    if (store.blacklist.get(key)) {
      return res.status(403).json({
        status: 403,
        error: 'Access temporarily blocked due to suspicious activity'
      });
    }

    const now = Date.now();
    const requestTimings = store.requestTimings.get(key) || [];
    requestTimings.push(now);
    
    const windowStart = now - burstConfig.burstWindow;
    const recentRequests = requestTimings.filter(time => time > windowStart);
    store.requestTimings.set(key, recentRequests);

    if (recentRequests.length > burstConfig.maxBurst) {
      store.blacklist.set(key, true);
      return res.status(429).json({
        status: 429,
        error: 'Rate limit exceeded due to burst traffic'
      });
    }

    const suspicious = checkSuspiciousPatterns(req);
    if (suspicious) {
      const currentScore = store.suspiciousActivities.get(key) || 0;
      const newScore = currentScore + 1;
      store.suspiciousActivities.set(key, newScore);

      if (newScore > 10) {
        store.blacklist.set(key, true);
        return res.status(403).json({
          status: 403,
          error: 'Access denied due to suspicious activity'
        });
      }
    }

    next();
  });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });
};

function checkSuspiciousPatterns(req) {
  if (!req.headers['user-agent'] || 
      !req.headers['accept'] || 
      req.headers['accept'].includes('*/*')) {
    return true;
  }

  if (req.headers['content-length'] && 
      parseInt(req.headers['content-length']) > 1e6) {
    return true;
  }

  if (req.method !== 'GET' && 
      !req.headers['content-type']) {
    return true;
  }

  if (req.query && Object.keys(req.query).length > 20) {
    return true;
  }

  const suspiciousPatterns = [
    /\.\.[\/\\]/,
    /(exec|eval|function|alert)\(/i,
    /<script|javascript:/i,
    /union.*select|insert.*into|delete.*from/i
  ];

  const url = req.originalUrl || req.url;
  return suspiciousPatterns.some(pattern => pattern.test(url));
}

module.exports = ddosProtection;