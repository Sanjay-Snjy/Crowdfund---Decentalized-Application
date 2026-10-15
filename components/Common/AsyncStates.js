/**
 * Shared presentation blocks so every new section has consistent loading, empty,
 * error and stat states instead of one-off markup.
 */
import Link from "next/link";
import { FiAlertTriangle, FiInbox, FiRefreshCw } from "react-icons/fi";

export function LoadingState({ rows = 3, height = "h-12", label = "Loading…" }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className={`skeleton ${height}`} />
      ))}
    </div>
  );
}

export function EmptyState({ icon = null, title, description = null, action = null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      {icon || <FiInbox className="h-8 w-8" style={{ color: "var(--color-text-muted)" }} />}
      <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
        {title}
      </p>
      {description && (
        <p className="max-w-md text-xs" style={{ color: "var(--color-text-muted)" }}>
          {description}
        </p>
      )}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry = null, title = "Could not load this section" }) {
  const message =
    typeof error === "string" ? error : error?.message || "Unexpected error while loading data.";

  return (
    <div
      className="flex flex-col items-start gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
      style={{ borderColor: "var(--color-error)", background: "var(--color-error-light)" }}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <FiAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--color-error)" }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            {title}
          </p>
          <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {message}
          </p>
          {error?.hint && (
            <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
              {error.hint}
            </p>
          )}
        </div>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm shrink-0">
          <FiRefreshCw className="h-3 w-3" /> Retry
        </button>
      )}
    </div>
  );
}

/**
 * Stat tile. When `href` is given the whole tile becomes a link, so a metric can
 * open its own breakdown page without a separate "view" button.
 */
export function StatTile({ label, value, hint = null, accent = null, icon = null, href = null, linkLabel = null }) {
  const className = `card rounded-2xl p-4${href ? " card-hover block" : ""}`;

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {label}
        </p>
        {icon && <span style={{ color: accent || "var(--color-accent)" }}>{icon}</span>}
      </div>
      <p className="mt-1 text-lg font-bold" style={{ color: accent || "var(--color-text)" }}>
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-text-muted)" }}>
          {hint}
        </p>
      )}
    </>
  );

  if (!href) return <div className={className}>{content}</div>;

  return (
    <Link href={href} className={className} aria-label={linkLabel || `${label} — open the breakdown`}>
      {content}
    </Link>
  );
}

export function StatusPill({ status }) {
  const normalized = String(status || "").toLowerCase();
  const map = {
    confirmed: { className: "badge-success", label: "Confirmed" },
    pending: { className: "badge-warning", label: "Pending" },
    failed: { className: "badge-error", label: "Failed" },
  };
  const entry = map[normalized] || { className: "badge-neutral", label: status || "Unknown" };

  return <span className={`badge ${entry.className}`}>{entry.label}</span>;
}

export function SectionTitle({ title, description = null, right = null }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          {title}
        </h3>
        {description && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
            {description}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}
