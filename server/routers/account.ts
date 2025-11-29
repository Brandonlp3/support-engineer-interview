import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { db, sqlite } from "@/lib/db";
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
          // Accept string or number for amount, normalize and reject formats with multiple leading zeros
          amount: z.preprocess(
            (val) => {
              if (typeof val === "string") return val.trim();
              if (typeof val === "number") return String(val);
              return val;
            },
            z
              .string()
              .refine((s) => /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(s), {
                message: "Invalid amount format (no leading zeros); use e.g. 1.23",
              })
              .transform((s) => Number(Number(s).toFixed(2)))
          ),
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
      // `amount` is normalized by Zod to a number with 2 decimal places
      const amount = input.amount as number;

      // Reject zero or near-zero amounts after rounding (must be at least $0.01)
      if (typeof amount !== "number" || isNaN(amount) || amount < 0.01) {
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

      // Perform insert + balance update atomically inside a single DB transaction
      const txn = sqlite.transaction(() => {
        // Insert transaction row
        const insertStmt = sqlite.prepare(
          `INSERT INTO transactions (account_id, type, amount, description, status, processed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const nowIso = new Date().toISOString();
        insertStmt.run(
          input.accountId,
          "deposit",
          amount,
          `Funding from ${input.fundingSource.type}`,
          "completed",
          nowIso,
          nowIso
        );

        // Update balance using a single SQL expression to avoid race conditions
        const updateStmt = sqlite.prepare(`UPDATE accounts SET balance = round(balance + ?, 2) WHERE id = ?`);
        updateStmt.run(amount, input.accountId);

        // Read back the most-recent transaction for this account and the new balance
        const transactionRow = sqlite
          .prepare(
            `SELECT * FROM transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT 1`
          )
          .get(input.accountId);

        const balanceRow = sqlite.prepare(`SELECT balance FROM accounts WHERE id = ?`).get(input.accountId);
        const newBalance = Number(Number(balanceRow.balance ?? 0).toFixed(2));

        return { transaction: transactionRow, newBalance };
      });

      const { transaction, newBalance } = txn();

      return { transaction, newBalance };
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
