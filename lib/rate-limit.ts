import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Vercel's Upstash Marketplace integration provisions KV_REST_API_* env
// vars, not the UPSTASH_REDIS_REST_* names Redis.fromEnv() expects — so the
// client is constructed explicitly instead.
const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export const loginRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
  prefix: "ratelimit:login",
  analytics: true,
});

export const kpiFeedRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "60 s"),
  prefix: "ratelimit:kpi-feed",
  analytics: true,
});
