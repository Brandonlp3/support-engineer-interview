import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { accounts, transactions } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";


function generateAccountNumber(): string {
  const buffer = crypto.randomBytes(5);
  const randomNum = buffer.readUIntBE(0, 5);
  const accountNumber = (randomNum % 9000000000) + 1000000000;
  return accountNumber.toString();
}

export const accountRouter = router({
  createAccount: protectedProcedure
    .input(
      z.object({
        accountType: z.enum(["checking", "savings"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user already has an account of this type
      const existingAccount = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, ctx.user.id), eq(accounts.accountType, input.accountType)))
        .get();

      if (existingAccount) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have a ${input.accountType} account`,
        });
      }

      let accountNumber;
      let isUnique = false;

      // Generate unique account number
      while (!isUnique) {
        accountNumber = generateAccountNumber();
        const existing = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber)).get();
        isUnique = !existing;
      }

      await db.insert(accounts).values({
        userId: ctx.user.id,
        accountNumber: accountNumber!,
        accountType: input.accountType,
        balance: 0,
        status: "active",
      });

      // Fetch the created account
      const account = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber!)).get();

      // If the account wasn't found after insertion, fail loudly instead of returning a misleading default
      if (!account) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create account" });
      }

      return account;
    }),

  getAccounts: protectedProcedure.query(async ({ ctx }) => {
    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, ctx.user.id));

    return userAccounts;
  }),

  fundAccount: protectedProcedure
    .input(
      z
        .object({
          accountId: z.number(),
          amount: z.number().positive(),
          fundingSource: z.object({
            type: z.enum(["card", "bank"]),
            accountNumber: z.string(),
            routingNumber: z.string().optional(),
          }),
        })
        .refine(
          (val) => {
            // If funding type is bank, routingNumber must be a 9-digit string
            if (val.fundingSource.type === "bank") {
              const r = val.fundingSource.routingNumber;
              return typeof r === "string" && /^\d{9}$/.test(r);
            }
            return true;
          },
          {
            message: "Routing number must be 9 digits for bank funding",
            path: ["fundingSource", "routingNumber"],
          }
        )
    )
    .mutation(async ({ input, ctx }) => {
      // Normalize amount to a number with 2 decimal places (cents precision)
      const rawAmount = parseFloat(input.amount.toString());
      if (!isFinite(rawAmount) || isNaN(rawAmount)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid amount" });
      }
      const amount = Number(rawAmount.toFixed(2));

      // Reject zero or near-zero amounts after rounding (must be at least $0.01)
      if (amount < 0.01) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Amount must be at least $0.01" });
      }

      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      if (account.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Account is not active",
        });
      }

      // Create transaction (record the funding)
      await db.insert(transactions).values({
        accountId: input.accountId,
        type: "deposit",
        amount,
        description: `Funding from ${input.fundingSource.type}`,
        status: "completed",
        processedAt: new Date().toISOString(),
      });

      // Compute new balance using fixed 2-decimal arithmetic to avoid floating point drift
      const currentBalance = Number(Number(account.balance).toFixed(2));
      const newBalance = Number((currentBalance + amount).toFixed(2));

      // Persist updated balance
      await db
        .update(accounts)
        .set({
          balance: newBalance,
        })
        .where(eq(accounts.id, input.accountId));

      // Fetch the created transaction for this account (most-recent)
      const transaction = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId))
        .orderBy(desc(transactions.createdAt))
        .limit(1)
        .get();

      return {
        transaction,
        newBalance,
      };
    }),

  getTransactions: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      const accountTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId));

      const enrichedTransactions = [];
      for (const transaction of accountTransactions) {
        const accountDetails = await db.select().from(accounts).where(eq(accounts.id, transaction.accountId)).get();

        enrichedTransactions.push({
          ...transaction,
          accountType: accountDetails?.accountType,
        });
      }

      return enrichedTransactions;
    }),
});
