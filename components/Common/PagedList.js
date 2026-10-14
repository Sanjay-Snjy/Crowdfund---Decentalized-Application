/**
 * Paging + matched card heights for the dashboard grid.
 *
 * The dashboard pairs its working cards two-by-two (Recent Transactions beside My
 * Rewards & Badges, Your Campaigns beside Milestone Progress). They have to line up,
 * so every one of them uses the same fixed height instead of growing with its own
 * content. When a card holds more rows than fit in that height, the rest of the list
 * is not hidden and no scrollbar is needed: the header shows which slice is on
 * screen ("1–4 of 12") with previous/next buttons for the rest.
 *
 * `usePagedList` clamps the page when the data shrinks, so a page can never end up
 * empty after a refresh.
 */
import { useEffect, useMemo, useState } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";

/** Shared shell for a matched, fixed-height dashboard card (fits 4 rows + header). */
export const MATCHED_CARD = "card flex h-[26rem] flex-col rounded-2xl p-5";
/** Shorter shell for the full-width milestone card — it scrolls sideways, so it
 *  only needs room for one row of campaign chips. */
export const MATCHED_WIDE_CARD = "card flex h-[14rem] flex-col rounded-2xl p-5";
/** Scrollable inner area of a matched card (a safety net; paging does the work). */
export const MATCHED_CARD_BODY = "min-h-0 flex-1 overflow-y-auto pr-1";

export function usePagedList(items, perPage = 4) {
  const list = Array.isArray(items) ? items : [];
  const pageCount = Math.max(1, Math.ceil(list.length / perPage));
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(current, 1), pageCount));
  }, [pageCount]);

  const slice = useMemo(
    () => list.slice((page - 1) * perPage, page * perPage),
    [list, page, perPage]
  );

  return {
    page,
    pageCount,
    perPage,
    total: list.length,
    slice,
    hasPrev: page > 1,
    hasNext: page < pageCount,
    first: list.length === 0 ? 0 : (page - 1) * perPage + 1,
    last: Math.min(page * perPage, list.length),
    prev: () => setPage((current) => Math.max(1, current - 1)),
    next: () => setPage((current) => Math.min(pageCount, current + 1)),
  };
}

/** Previous/next controls. Renders nothing while everything fits on one page. */
export function Pager({ pager, label = "rows" }) {
  if (!pager || pager.pageCount <= 1) return null;

  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="mr-0.5 text-[11px] tabular-nums" style={{ color: "var(--color-text-muted)" }}>
        {pager.first}–{pager.last} of {pager.total}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={pager.prev}
        disabled={!pager.hasPrev}
        aria-label={`Previous ${label}`}
        title="Previous"
      >
        <FiChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="text-[11px] tabular-nums" style={{ color: "var(--color-text-muted)" }}>
        {pager.page}/{pager.pageCount}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={pager.next}
        disabled={!pager.hasNext}
        aria-label={`Next ${label}`}
        title="Next"
      >
        <FiChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
