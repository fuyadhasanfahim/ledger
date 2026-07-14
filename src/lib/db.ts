import "server-only";

import mongoose from "mongoose";
import { env } from "@/lib/env";

/**
 * MongoDB connection.
 *
 * Two things this has to get right in a serverless / HMR world:
 *
 * 1. **Never open a second connection.** Next's dev server re-evaluates modules
 *    on every hot reload, and each serverless invocation may reuse a warm
 *    container. Both would leak connections until Atlas starts refusing them.
 *    So the connection *and the in-flight promise* are cached on `globalThis` —
 *    caching only the connection would still let two concurrent cold requests
 *    both start a connect.
 *
 * 2. **Connect lazily.** Reading MONGODB_URI at import time would break
 *    `next build` on a machine with no secrets, which is exactly where CI runs.
 */

interface Cache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalForMongoose = globalThis as unknown as { mongoose?: Cache };

const cache: Cache = globalForMongoose.mongoose ?? {
  conn: null,
  promise: null,
};

globalForMongoose.mongoose = cache;

export async function connectDb(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose.connect(env().MONGODB_URI, {
      // Fail fast rather than hanging a request for 30s on a bad URI.
      serverSelectionTimeoutMS: 8_000,
      // Mongoose buffers commands while disconnected; in a serverless function
      // that turns a connection error into a confusing timeout instead of a
      // clear failure. Surface the real error.
      bufferCommands: false,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    // Clear the failed promise, otherwise every later request awaits the same
    // rejected promise and can never recover.
    cache.promise = null;
    throw error;
  }

  return cache.conn;
}
