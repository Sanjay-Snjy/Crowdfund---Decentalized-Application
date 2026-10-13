/**
 * Small helpers shared by the API routes: consistent error shapes, body reading
 * with a size cap, and query-parameter validation.
 *
 * Every helper here is server-only.
 */

export function methodNotAllowed(res, allowed) {
  res.setHeader("Allow", allowed.join(", "));
  return res.status(405).json({ error: "Method not allowed", allowed });
}

export function badRequest(res, error, extra = {}) {
  return res.status(400).json({ error, ...extra });
}

export function serverError(res, error, context = "api") {
  console.error(`[${context}]`, error?.message || error);

  // A database that cannot be reached at all is an operator problem, not a client
  // one: answer 503 with the configuration that is missing instead of a blank 500.
  if (error?.code === "DATABASE_UNAVAILABLE") {
    return res.status(503).json({
      error: "Database unavailable",
      hint:
        error.hint ||
        "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (hosted libSQL), or point CF_DATABASE_PATH at a writable, persistent directory.",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message,
    });
  }

  return res.status(500).json({
    error: "Internal server error",
    detail: process.env.NODE_ENV === "production" ? undefined : error?.message,
  });
}

/** Read a JSON body with a hard size cap (defends against oversized payloads). */
export async function readJson(req, maxBytes = 100 * 1024) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function clampInt(value, { min = 0, max = 100, fallback = 20 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function cleanString(value, maxLength = 200) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function isAddressLike(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function isHexHash(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value.trim());
}

/** No-store for anything personalised. */
export function privateNoStore(res) {
  res.setHeader("Cache-Control", "no-store, private, max-age=0");
}

/** Short public cache for shared, non-personalised data. */
export function publicCache(res, seconds = 15) {
  res.setHeader("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=30`);
}
