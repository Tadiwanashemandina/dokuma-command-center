import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { MongoClient, type Collection } from "mongodb";

type RateLimitResult = { success: boolean };
type RateLimiter = { limit: (identifier: string) => Promise<RateLimitResult> };

function createMemoryRateLimiter(maxRequests: number, windowMs: number): RateLimiter {
  const requests = new Map<string, number[]>();

  return {
    async limit(identifier) {
      const now = Date.now();
      const recentRequests = (requests.get(identifier) ?? []).filter(
        (timestamp) => now - timestamp < windowMs
      );
      const success = recentRequests.length < maxRequests;

      if (success) recentRequests.push(now);
      requests.set(identifier, recentRequests);

      return { success };
    },
  };
}

type MongoRateLimitRecord = {
  _id: string;
  count: number;
  expiresAt: Date;
};

function createMongoRateLimiter(uri: string, maxRequests: number, windowMs: number): RateLimiter {
  let clientPromise: Promise<MongoClient> | undefined;
  let collectionPromise: Promise<Collection<MongoRateLimitRecord>> | undefined;

  async function getCollection() {
    if (!collectionPromise) {
      clientPromise ??= new MongoClient(uri).connect();
      collectionPromise = clientPromise.then(async (client) => {
        const collection = client.db().collection<MongoRateLimitRecord>("rate_limit_windows");
        await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        return collection;
      });
    }

    return collectionPromise;
  }

  return {
    async limit(identifier) {
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const key = `${identifier}:${windowStart}`;
      const collection = await getCollection();
      const result = await collection.findOneAndUpdate(
        { _id: key },
        {
          $inc: { count: 1 },
          $setOnInsert: { expiresAt: new Date(windowStart + windowMs) },
        },
        { upsert: true, returnDocument: "after" }
      );

      return { success: (result?.count ?? maxRequests + 1) <= maxRequests };
    },
  };
}

const mongoUri = process.env.MONGODB_URI;
const hasUpstashConfig = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

// MongoDB is the temporary local/shared store. Upstash remains available for
// deployments that have the marketplace integration configured.
const mongoLoginRateLimit = mongoUri ? createMongoRateLimiter(mongoUri, 5, 60_000) : null;
const mongoKpiFeedRateLimit = mongoUri ? createMongoRateLimiter(mongoUri, 30, 60_000) : null;

const redis = hasUpstashConfig
  ? new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    })
  : null;

export const loginRateLimit: RateLimiter = mongoLoginRateLimit
  ?? (redis
    ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "60 s"),
      prefix: "ratelimit:login",
      analytics: true,
    })
    : createMemoryRateLimiter(5, 60_000));

export const kpiFeedRateLimit: RateLimiter = mongoKpiFeedRateLimit
  ?? (redis
    ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "60 s"),
      prefix: "ratelimit:kpi-feed",
      analytics: true,
    })
    : createMemoryRateLimiter(30, 60_000));
