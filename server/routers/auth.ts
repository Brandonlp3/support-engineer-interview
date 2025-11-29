import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { users, sessions } from "@/lib/db/schema";
import { ssnLookupHash, ssnLast4 } from "@/lib/crypto/ssn";
import { eq } from "drizzle-orm";
import { date } from "drizzle-orm/mysql-core";

export const authRouter = router({
  signup: publicProcedure
    .input(
      z.object({
        email: z.string().email().toLowerCase(),
        password: z
                  .string()
                  .min(8, "Password must be at least 8 characters")
                  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
                  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
                  .regex(/[0-9]/, "Password must contain at least one number")
                  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        phoneNumber: z.string().regex(/^\+?\d{10,15}$/),
        dateOfBirth: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
          // valid calendar date (catches 2021-02-30 etc.)
          .refine((date) => {
            const parts = date.split("-").map((p) => parseInt(p, 10));
            if (parts.length !== 3) return false;
            const [y, m, d] = parts;
            if (!y || !m || !d) return false;
            // month/day quick sanity
            if (m < 1 || m > 12) return false;
            if (d < 1 || d > 31) return false;
            const utc = Date.UTC(y, m - 1, d);
            const dob = new Date(utc);
            return dob.getUTCFullYear() === y && dob.getUTCMonth() === (m - 1) && dob.getUTCDate() === d;
          }, { message: "Invalid calendar date" })
          // not in the future
          .refine((date) => {
            const [y, m, d] = date.split("-").map((p) => parseInt(p, 10));
            const utc = Date.UTC(y, m - 1, d);
            const todayUtc = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
            return utc <= todayUtc;
          }, { message: "Date of birth cannot be in the future" })
          // year not before 1900
          .refine((date) => {
            const y = parseInt(date.split("-")[0], 10);
            return y >= 1900;
          }, { message: "Date of birth must be 1900 or later" })
          // age >= 18
          .refine((date) => {
            const [y, m, d] = date.split("-").map((p) => parseInt(p, 10));
            const today = new Date();
            let age = today.getFullYear() - y;
            const monthDiff = today.getMonth() - (m - 1);
            const dayDiff = today.getDate() - d;
            if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
            return age >= 18;
          }, { message: "You must be at least 18 years old" })
          // age <= 120
          .refine((date) => {
            const [y, m, d] = date.split("-").map((p) => parseInt(p, 10));
            const today = new Date();
            let age = today.getFullYear() - y;
            const monthDiff = today.getMonth() - (m - 1);
            const dayDiff = today.getDate() - d;
            if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
            return age <= 120;
          }, { message: "Invalid date of birth" }),
        ssn: z.string().regex(/^\d{9}$/),
        address: z.string().min(1),
        city: z.string().min(1),
        state: z.string().length(2).toUpperCase(),
        zipCode: z.string().regex(/^\d{5}$/),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Compute deterministic lookup hash and last4 for SSN early so we can detect conflicts
      const { ssn, ...rest } = input;
      const ssn_hash = ssnLookupHash(ssn);
      const ssn_last4 = ssnLast4(ssn);

      // Check for existing user by email or by SSN lookup hash
      const existingByEmail = await db.select().from(users).where(eq(users.email, input.email)).get();
      if (existingByEmail) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "User already exists with that email",
        });
      }

      const existingBySSN = await db.select().from(users).where(eq(users.ssnHash, ssn_hash)).get();
      if (existingBySSN) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with that Social Security Number already exists",
        });
      }

      const hashedPassword = await bcrypt.hash(input.password, 10);

      await db.insert(users).values({
        ...rest,
        password: hashedPassword,
        ssnHash: ssn_hash,
        ssnLast4: ssn_last4,
      });

      // Fetch the created user
      const user = await db.select().from(users).where(eq(users.email, input.email)).get();

      if (!user) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create user",
        });
      }

      // Create session
      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "temporary-secret-for-interview", {
        expiresIn: "7d",
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: expiresAt.toISOString(),
      });

      // Set cookie
      if ("setHeader" in ctx.res) {
        ctx.res.setHeader("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      } else {
        (ctx.res as Headers).set("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      }

      return { user: { ...user, password: undefined }, token };
    }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await db.select().from(users).where(eq(users.email, input.email)).get();

      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }

      const validPassword = await bcrypt.compare(input.password, user.password);

      if (!validPassword) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid credentials",
        });
      }

      const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "temporary-secret-for-interview", {
        expiresIn: "7d",
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await db.insert(sessions).values({
        userId: user.id,
        token,
        expiresAt: expiresAt.toISOString(),
      });

      if ("setHeader" in ctx.res) {
        ctx.res.setHeader("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      } else {
        (ctx.res as Headers).set("Set-Cookie", `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
      }

      return { user: { ...user, password: undefined }, token };
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    if (ctx.user) {
      // Delete session from database
      let token: string | undefined;
      if ("cookies" in ctx.req) {
        token = (ctx.req as any).cookies.session;
      } else {
        const cookieHeader = ctx.req.headers.get?.("cookie") || (ctx.req.headers as any).cookie;
        token = cookieHeader
          ?.split("; ")
          .find((c: string) => c.startsWith("session="))
          ?.split("=")[1];
      }
      if (token) {
        await db.delete(sessions).where(eq(sessions.token, token));
      }
    }

    if ("setHeader" in ctx.res) {
      ctx.res.setHeader("Set-Cookie", `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    } else {
      (ctx.res as Headers).set("Set-Cookie", `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    }

    return { success: true, message: ctx.user ? "Logged out successfully" : "No active session" };
  }),
});
