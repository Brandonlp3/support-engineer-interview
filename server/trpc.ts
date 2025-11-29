import { initTRPC, TRPCError } from "@trpc/server";
import { CreateNextContextOptions } from "@trpc/server/adapters/next";
import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import jwt from "jsonwebtoken";
import { db, closeDb } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function createContext(opts: CreateNextContextOptions | FetchCreateContextFnOptions) {
  // Handle different adapter types
  let req: any;
  let res: any;

  if ("req" in opts && "res" in opts) {
    // Next.js adapter
    req = opts.req;
    res = opts.res;
  } else {
    // Fetch adapter
    req = opts.req;
    res = opts.resHeaders;
  }

  // Get the session token
  let token: string | undefined;

  // For App Router, we need to read cookies from the request headers
  let cookieHeader = "";
  if (req.headers.cookie) {
    // Next.js Pages request
    cookieHeader = req.headers.cookie;
  } else if (req.headers.get) {
    // Fetch request (App Router)
    cookieHeader = req.headers.get("cookie") || "";
  }

  const cookiesObj = Object.fromEntries(
    cookieHeader
      .split("; ")
      .filter(Boolean)
      .map((c: string) => {
        const [key, ...val] = c.split("=");
        return [key, val.join("=")];
      })
  );
  token = cookiesObj.session;

  let user = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "temporary-secret-for-interview") as {
        userId: number;
      };

      const session = await db.select().from(sessions).where(eq(sessions.token, token)).get();

      // Safety window: treat sessions within this many ms of expiry as expired.
      const SESSION_EXPIRY_SAFETY_MS = Number(process.env.SESSION_EXPIRY_SAFETY_MS ?? 30000); // default 30s

      if (session) {
        const expiresAtMs = new Date(session.expiresAt).getTime();
        const nowMs = Date.now();
        const expiresInMs = expiresAtMs - nowMs;

        // If session already expired or is within safety window, revoke it and do not accept
        if (expiresInMs <= SESSION_EXPIRY_SAFETY_MS) {
          await db.delete(sessions).where(eq(sessions.token, token));
        } else {
          // session is valid
          user = await db.select().from(users).where(eq(users.id, decoded.userId)).get();
          if (expiresInMs < 60000) {
            console.warn("Session about to expire");
          }
        }
      }
    } catch (error) {
      // Invalid token
    }
  }

  return {
    user,
    req,
    res,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// Graceful shutdown: close DB handle on process exit/signals to avoid leaked file descriptors
async function gracefulShutdown(reason?: string) {
  try {
    // eslint-disable-next-line no-console
    console.log("Server shutting down", reason || "");
    closeDb();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Error during graceful shutdown:", err);
  } finally {
    // allow logs to flush
    setTimeout(() => process.exit(0), 100);
  }
}

process.once("SIGINT", () => gracefulShutdown("SIGINT"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("beforeExit", () => gracefulShutdown("beforeExit"));
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("uncaughtException:", err);
  gracefulShutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("unhandledRejection:", reason);
  gracefulShutdown("unhandledRejection");
});
