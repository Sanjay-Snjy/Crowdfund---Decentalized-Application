/**
 * Clerk webhook endpoint: POST /api/webhooks/clerk
 *
 * Registers a CrowdFund profile (and its CrowdFund User ID) the moment a Clerk
 * account is created, so the admin "recently registered users" list is populated
 * even before the user opens the app.
 *
 * The signature is ALWAYS verified before any data is written. Clerk signs with
 * the Svix scheme: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`
 * using the base64 payload of CLERK_WEBHOOK_SIGNING_SECRET (`whsec_…`).
 *
 * Handlers are idempotent, which matters because Svix retries failed deliveries:
 * a duplicate `user.created` finds the existing profile and returns 200.
 *
 * Setup: add the endpoint URL in the Clerk dashboard and set
 * CLERK_WEBHOOK_SIGNING_SECRET (and CLERK_SECRET_KEY) in the environment.
 * Subscribe to: user.created, user.updated, user.deleted.
 */
import crypto from "node:crypto";
import { db } from "../../../lib/db/index.js";
import { methodNotAllowed, serverError } from "../../../lib/api/http.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function readRawBody(req, maxBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Webhook body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function verifySignature({ rawBody, headers, secret }) {
  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signatureHeader = headers["svix-signature"];

  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: "Missing svix headers" };
  }

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return { ok: false, reason: "Invalid timestamp" };

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestampNumber);
  if (age > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "Timestamp too old" };

  const secretBytes = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  // The header can carry several space-separated signatures: "v1,<base64> v1,<base64>".
  const candidates = String(signatureHeader)
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^v\d+,/, ""));

  for (const candidate of candidates) {
    let provided;
    try {
      provided = Buffer.from(candidate, "base64");
    } catch {
      continue;
    }
    if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "Signature mismatch" };
}

function primaryEmail(data) {
  return (
    data?.primary_email_address_id &&
    data?.email_addresses?.find((entry) => entry.id === data.primary_email_address_id)
      ?.email_address
  ) || data?.email_addresses?.[0]?.email_address || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    console.error("[webhook] CLERK_WEBHOOK_SIGNING_SECRET is not set — refusing the delivery");
    return res.status(503).json({
      error: "Webhook signing secret not configured",
      hint: "Set CLERK_WEBHOOK_SIGNING_SECRET from the Clerk dashboard. Never expose it to the browser.",
    });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    return serverError(res, error, "webhook");
  }

  const verified = verifySignature({ rawBody, headers: req.headers, secret });
  if (!verified.ok) {
    console.warn("[webhook] Rejected Clerk delivery:", verified.reason);
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  try {
    db.init();
    const type = event?.type;

    if (type === "user.created" || type === "user.updated") {
      const data = event.data || {};
      const user = db.users.ensureUserFromClerk({
        clerkUserId: data.id,
        firstName: data.first_name,
        lastName: data.last_name,
        username: data.username,
        email: primaryEmail(data),
        registeredAt: data.created_at,
      });

      db.users.attachUserToWalletHistory(user.id, user.wallet_address);
      db.driver.run(
        `INSERT INTO admin_audit (actor, action, subject, detail, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          "clerk-webhook",
          type,
          user.cf_user_id,
          null,
          Math.floor(Date.now() / 1000),
        ]
      );

      return res.status(200).json({
        received: true,
        type,
        cfUserId: user.cf_user_id,
        created: type === "user.created",
      });
    }

    if (type === "user.deleted") {
      const clerkUserId = event.data?.id;
      const existing = db.users.getUserByClerkId(clerkUserId);
      if (existing) {
        // Retain the record (donation history and rewards must not disappear) but
        // detach the private Clerk association so the id can never be reused.
        db.driver.run(
          `UPDATE users SET clerk_user_id = NULL, updated_at = ? WHERE id = ?`,
          [Math.floor(Date.now() / 1000), existing.id]
        );
      }
      return res.status(200).json({ received: true, type });
    }

    // Acknowledge every other event type so Svix stops retrying.
    return res.status(200).json({ received: true, type, ignored: true });
  } catch (error) {
    // 500 makes Svix retry, which is what we want for transient database errors.
    return serverError(res, error, "webhook");
  }
}
