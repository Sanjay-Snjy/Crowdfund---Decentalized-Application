/**
 * Small fetch wrapper for the CrowdFund API routes.
 *
 * Every call carries the session cookie (same-origin, credentials: "same-origin"),
 * throws a typed error so components can show real empty/error states, and never
 * sends a secret — the browser only ever talks to our own API routes.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, hint = null, payload = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.hint = hint;
    this.payload = payload;
    this.isUnauthorized = status === 401 || status === 403;
  }
}

/**
 * next.config.js sets `trailingSlash: true`, so API routes answer on `/api/x/` and
 * redirect `/api/x` with a 308. Normalising here keeps the extra round trip (and
 * the redirect) out of every request.
 */
export function normalizeApiPath(path) {
  const [beforeQuery, ...rest] = String(path).split("?");
  const query = rest.length ? `?${rest.join("?")}` : "";
  const withSlash = beforeQuery.endsWith("/") ? beforeQuery : `${beforeQuery}/`;
  return `${withSlash}${query}`;
}

async function request(path, { method = "GET", body, signal } = {}) {
  let response;
  try {
    response = await fetch(normalizeApiPath(path), {
      method,
      credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError("Network error — could not reach the CrowdFund API", { status: 0 });
  }

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text.slice(0, 200) };
    }
  }

  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed (${response.status})`, {
      status: response.status,
      hint: payload?.hint || null,
      payload,
    });
  }

  return payload;
}

export function apiGet(path, { signal } = {}) {
  return request(path, { signal });
}

export function apiPost(path, body, { signal } = {}) {
  return request(path, { method: "POST", body: body || {}, signal });
}

export function apiPatch(path, body) {
  return request(path, { method: "PATCH", body: body || {} });
}

export function apiDelete(path) {
  return request(path, { method: "DELETE" });
}

/** Build a query string from a params object, skipping empty values. */
export function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}
