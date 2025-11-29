import crypto from "crypto";

const HMAC_KEY = process.env.SSN_HMAC_KEY;
if (!HMAC_KEY) {
  throw new Error(
    "SSN_HMAC_KEY is required. Set the SSN_HMAC_KEY environment variable before starting the app or running migration scripts."
  );
}

export function ssnLookupHash(ssn: string): string {
  const key = Buffer.from(HMAC_KEY!, "utf8");
  return crypto.createHmac("sha256", key).update(ssn).digest("hex");
}

export function ssnLast4(ssn: string): string {
  const digits = ssn.replace(/\D/g, "");
  return digits.slice(-4);
}
