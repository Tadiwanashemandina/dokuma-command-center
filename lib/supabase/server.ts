import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { MongoClient, type Collection, type Document, type Filter, type UpdateFilter } from "mongodb";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, UserRole } from "@/types/database.types";
import { hardenCookieOptions } from "./cookie-options";
import { MFA_REQUIRED_ROLES, getAssuranceLevel, hasVerifiedTotpFactor } from "./mfa";

const LOCAL_SESSION_COOKIE = "dokuma_local_session";
const mongoUri = process.env.MONGODB_URI;
const mongoClient = mongoUri ? new MongoClient(mongoUri) : null;
const mongoConnection = mongoClient?.connect();

type LocalUser = { _id: string; email: string; passwordHash: string; full_name: string; role: UserRole };
type LocalSession = { _id: string; userId: string; expiresAt: Date };
type QueryOperation = "select" | "insert" | "update" | "upsert" | "delete";

function localDatabase() {
  if (!mongoConnection) throw new Error("MONGODB_URI is required when MONGODB_ONLY=true");
  return mongoConnection.then((client) => client.db(process.env.MONGODB_DATABASE ?? "dokuma"));
}

function collection<T extends Document>(name: string): Promise<Collection<T>> {
  return localDatabase().then((database) => database.collection<T>(name));
}

function passwordHash(password: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password: string, stored: string) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function stripMongoId<T extends Document>(document: T): Omit<T, "_id"> {
  const { _id, ...record } = document;
  return record as Omit<T, "_id">;
}

function filterForMongo(filters: Array<[string, string, unknown]>): Filter<Document> {
  return Object.fromEntries(filters.map(([field, operator, value]) => [field, operator === "eq" ? value : { [`$${operator}`]: value }])) as Filter<Document>;
}

class LocalQueryBuilder {
  private filters: Array<[string, string, unknown]> = [];
  private sort: Record<string, 1 | -1> = {};
  private fields = "*";
  private operation: QueryOperation = "select";
  private payload: unknown;
  private options: { onConflict?: string } = {};
  private bounds?: { from: number; to: number };
  private limitCount?: number;
  private singleMode: "single" | "maybeSingle" | null = null;

  constructor(private readonly table: string) {}

  select(fields = "*") { this.fields = fields; return this; }
  eq(field: string, value: unknown) { this.filters.push([field, "eq", value]); return this; }
  neq(field: string, value: unknown) { this.filters.push([field, "ne", value]); return this; }
  in(field: string, values: unknown[]) { this.filters.push([field, "in", values]); return this; }
  gte(field: string, value: unknown) { this.filters.push([field, "gte", value]); return this; }
  lte(field: string, value: unknown) { this.filters.push([field, "lte", value]); return this; }
  lt(field: string, value: unknown) { this.filters.push([field, "lt", value]); return this; }
  gt(field: string, value: unknown) { this.filters.push([field, "gt", value]); return this; }
  order(field: string, options?: { ascending?: boolean }) { this.sort[field] = options?.ascending === false ? -1 : 1; return this; }
  limit(count: number) { this.limitCount = count; return this; }
  range(from: number, to: number) { this.bounds = { from, to }; return this; }
  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybeSingle"; return this; }
  insert(payload: unknown) { this.operation = "insert"; this.payload = payload; return this; }
  update(payload: unknown) { this.operation = "update"; this.payload = payload; return this; }
  upsert(payload: unknown, options?: { onConflict?: string }) { this.operation = "upsert"; this.payload = payload; this.options = options ?? {}; return this; }
  delete() { this.operation = "delete"; return this; }

  then<TResult1 = unknown, TResult2 = never>(onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    const records = Array.isArray(this.payload) ? this.payload : [this.payload];
    const mongoCollection = await collection<Document>(this.table);
    const filter = filterForMongo(this.filters);
    let documents: Document[] = [];

    if (this.operation === "insert") {
      const inserted = records.map((record) => ({ ...(record as Document), id: (record as Document).id ?? randomUUID() }));
      if (inserted.length) await mongoCollection.insertMany(inserted);
      documents = inserted;
    } else if (this.operation === "upsert") {
      const conflictFields = (this.options.onConflict ?? "id").split(",").map((field) => field.trim());
      for (const record of records as Document[]) {
        const conflict = Object.fromEntries(conflictFields.map((field) => [field, record[field]]));
        await mongoCollection.updateOne(conflict, { $set: { ...record, id: record.id ?? randomUUID() } }, { upsert: true });
      }
      documents = await mongoCollection.find(filter).toArray();
    } else if (this.operation === "update") {
      await mongoCollection.updateMany(filter, { $set: this.payload as Document } as UpdateFilter<Document>);
      documents = await mongoCollection.find(filter).toArray();
    } else if (this.operation === "delete") {
      documents = await mongoCollection.find(filter).toArray();
      await mongoCollection.deleteMany(filter);
    } else {
      let cursor = mongoCollection.find(filter).sort(this.sort);
      if (this.bounds) cursor = cursor.skip(this.bounds.from).limit(this.bounds.to - this.bounds.from + 1);
      else if (this.limitCount !== undefined) cursor = cursor.limit(this.limitCount);
      documents = await cursor.toArray();
    }

    let data = documents.map(stripMongoId);
    if (this.fields !== "*") {
      const selected = this.fields.split(",").map((field) => field.trim()).filter((field) => !field.includes("("));
      data = data.map((record) => Object.fromEntries(selected.map((field) => [field, record[field]])));
    }
    if (this.singleMode) data = data[0] ? [data[0]] : [];
    if (this.singleMode === "single" && data.length !== 1) return { data: null, error: { message: "Expected exactly one row" } };
    return { data: this.singleMode ? data[0] ?? null : data, error: null, count: documents.length };
  }
}

function localClient(cookieStore: Awaited<ReturnType<typeof cookies>>): any {
  const auth = {
    async getUser() {
      const token = cookieStore.get(LOCAL_SESSION_COOKIE)?.value;
      if (!token) return { data: { user: null }, error: null };
      const session = await (await collection<LocalSession>("local_sessions")).findOne({ _id: token, expiresAt: { $gt: new Date() } });
      if (!session) return { data: { user: null }, error: null };
      const user = await (await collection<LocalUser>("users")).findOne({ _id: session.userId });
      return { data: { user: user ? { id: user._id, email: user.email } : null }, error: null };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const users = await collection<LocalUser>("users");
      let user = await users.findOne({ email: email.toLowerCase() });
      const adminEmail = process.env.LOCAL_ADMIN_EMAIL ?? "admin@dokuma.local";
      const adminPassword = process.env.LOCAL_ADMIN_PASSWORD ?? "DokumaTest123!";
      if (!user && (await users.countDocuments()) === 0 && email.toLowerCase() === adminEmail.toLowerCase() && password === adminPassword) {
        user = { _id: randomUUID(), email: adminEmail.toLowerCase(), passwordHash: passwordHash(password), full_name: "Local Admin", role: "admin" };
        await users.insertOne(user);
        await (await collection("profiles")).insertOne({ id: user._id, full_name: user.full_name, role: user.role });
      }
      if (!user || !passwordMatches(password, user.passwordHash)) return { data: { user: null, session: null }, error: { message: "Invalid login credentials" } };
      const token = randomBytes(32).toString("hex");
      await (await collection<LocalSession>("local_sessions")).insertOne({ _id: token, userId: user._id, expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) });
      try { cookieStore.set(LOCAL_SESSION_COOKIE, token, hardenCookieOptions({ httpOnly: true, path: "/", maxAge: 60 * 60 * 24 * 7 })); } catch { /* Server Components cannot mutate cookies. */ }
      return { data: { user: { id: user._id, email: user.email }, session: { access_token: token } }, error: null };
    },
    async signOut() {
      const token = cookieStore.get(LOCAL_SESSION_COOKIE)?.value;
      if (token) await (await collection<LocalSession>("local_sessions")).deleteOne({ _id: token });
      try { cookieStore.delete(LOCAL_SESSION_COOKIE); } catch { /* Server Components cannot mutate cookies. */ }
      return { error: null };
    },
    admin: { async getUserById(id: string) { const user = await (await collection<LocalUser>("users")).findOne({ _id: id }); return { data: { user }, error: null }; } },
    mfa: { async getAuthenticatorAssuranceLevel() { return { data: { currentLevel: "aal1" } }; }, async listFactors() { return { data: { all: [], totp: [] } }; } },
  };
  return {
    from: (table: string) => new LocalQueryBuilder(table),
    rpc: async () => ({ data: [], error: null }),
    auth,
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: { message: "Storage is not available in Mongo-only mode" } }),
        createSignedUrl: async () => ({ data: null, error: { message: "Storage is not available in Mongo-only mode" } }),
      }),
    },
  };
}

// Mongo-backed server client for the local MERN runtime.
export async function createClient(): Promise<SupabaseClient<Database>> {
  return localClient(await cookies()) as SupabaseClient<Database>;
}

// Service-role client — bypasses RLS. Server-only, never imported by client
// components. Used by every write path in the app (LazyBoss import,
// Finance, HR) after an app-level requireRole() check — confirmed via a
// repo-wide grep before this security pass that no "use client" file
// references this function or SUPABASE_SERVICE_ROLE_KEY, directly or
// transitively.
export function createServiceRoleClient(): SupabaseClient<Database> {
  return localClient({ get: () => undefined, set: () => undefined, delete: () => undefined } as unknown as Awaited<ReturnType<typeof cookies>>) as SupabaseClient<Database>;
}

export type Profile = { id: string; full_name: string | null; role: UserRole };

// Cached per-request so pages/layouts can call this repeatedly for free.
export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();

  return profile ? { ...profile, role: profile.role as UserRole } : null;
});

// Redirects home if the signed-in user's role isn't in the allowed list.
// Call at the top of any restricted page, before querying its data.
export async function requireRole(allowed: UserRole[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!allowed.includes(profile.role)) redirect("/");

  // Finance/HR sessions must reach AAL2 (MFA-verified) before proceeding —
  // admin/exec are intentionally excluded from this gate.
  if (MFA_REQUIRED_ROLES.includes(profile.role)) {
    const supabase = await createClient();
    if ((await getAssuranceLevel(supabase)) !== "aal2") {
      const verified = await hasVerifiedTotpFactor(supabase);
      redirect(verified ? "/account/mfa/verify" : "/account/mfa/enroll");
    }
  }

  return profile;
}
