"use client";

import Image from "next/image";
import { formatCents, formatQty } from "@/lib/format";
import { productImageUrl } from "@/lib/images";
import type { ItemView } from "@/lib/lists/service";

interface Props {
  item: ItemView;
  onToggle: (item: ItemView) => void;
  onRemove: (item: ItemView) => void;
  disabled?: boolean;
  /**
   * Whether to reserve the picture column.
   *
   * Decided per list rather than per row: a list of hand-typed items would
   * otherwise carry 40px of empty gutter for nothing, and a mixed list would
   * have its text jumping in and out of alignment.
   */
  showImages?: boolean;
}

/**
 * One line of the list.
 *
 * Carries the same information the search result showed, because that is the
 * information you need in the shop: the picture is how you recognise the
 * product on a shelf, the comparison price is how you sanity-check the size,
 * and the offer is what tells you to pick up two instead of one.
 *
 * The whole row is the toggle target rather than just the checkbox: this gets
 * tapped one-handed while holding a basket. The remove control is a separate,
 * deliberately smaller target so it is hard to hit by accident but still
 * reachable without a gesture nobody would discover.
 */
export function ItemRow({ item, onToggle, onRemove, disabled, showImages }: Props) {
  const label = item.nameSnapshot ?? item.freeText ?? "Nimetön tuote";
  const lineCents = item.priceCentsSnapshot ? Math.round(item.priceCentsSnapshot * item.qty) : null;

  // "2 kpl 4,50 €" is more actionable than a percentage: it says what to do.
  const offer =
    item.offerAmount && item.offerAmount > 1 && item.offerBundleCents
      ? `${item.offerAmount} kpl ${formatCents(item.offerBundleCents)}`
      : item.discountPercent
        ? `−${item.discountPercent} %`
        : null;

  return (
    <li className="@container flex items-stretch border-b border-rule last:border-b-0">
      <button
        type="button"
        onClick={() => onToggle(item)}
        disabled={disabled}
        aria-pressed={item.checked}
        // min-w-0 is load-bearing: without it the flex child refuses to shrink
        // and a long product name pushes the price out of the row.
        className="flex min-h-touch min-w-0 flex-1 items-center gap-2.5 py-2.5 pr-1.5 pl-3 text-left transition-opacity active:bg-sunk disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
            item.checked ? "border-signal bg-signal text-white" : "border-ink-faint bg-surface"
          }`}
        >
          {item.checked ? (
            <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
              <path
                d="M5 10.5l3.5 3.5L15 7"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </span>

        {showImages ? (
          item.imageUrl ? (
            // Hotlinked from Kesko's CDN, asked for at the size drawn.
            <Image
              src={productImageUrl(item.imageUrl, 36) ?? item.imageUrl}
              alt=""
              width={80}
              height={80}
              unoptimized
              className={`size-9 shrink-0 rounded-md bg-white object-contain p-px transition-opacity ${
                item.checked ? "opacity-40" : ""
              }`}
            />
          ) : (
            // Keeps hand-typed items aligned with the products around them.
            <span aria-hidden="true" className="size-9 shrink-0 rounded-md bg-sunk/60" />
          )
        ) : null}

        <span className="min-w-0 flex-1">
          <span
            className={`strike text-[0.9375rem] leading-snug ${
              // Two lines, because a grocery name truncated to one is
              // frequently indistinguishable from the product beside it.
              item.checked ? "line-clamp-1 text-ink-faint" : "line-clamp-2 text-ink"
            }`}
            data-checked={item.checked}
          >
            {label}
          </span>

          <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <span className="tabular shrink-0 text-xs text-ink-faint">
              {formatQty(item.qty, item.qtyUnit)}
            </span>

            {/*
              Dropped rather than truncated when space is tight: "1,6…" tells
              nobody anything, and the badge beside it is worth more.
            */}
            {item.comparisonCents && item.comparisonUnit ? (
              <span className="tabular hidden shrink-0 text-xs text-ink-faint @[19rem]:inline">
                · {formatCents(item.comparisonCents)}/{item.comparisonUnit}
              </span>
            ) : null}

            {/* Green means savings, and only savings. */}
            {offer && !item.checked ? (
              <span className="tabular shrink-0 rounded-full bg-fresh-wash px-1.5 py-px text-[0.625rem] font-bold text-fresh">
                {offer}
              </span>
            ) : null}
          </span>
        </span>

        {/*
          Fixed width and right-aligned so figures stack into a scannable
          column down the list — the reason prices are set in mono at all.
          Reserved even when empty, so rows without a price do not shift.
        */}
        <span
          className={`tabular w-16 shrink-0 self-center text-right text-sm font-semibold ${
            item.checked ? "text-ink-faint" : "text-ink"
          }`}
        >
          {lineCents !== null ? formatCents(lineCents) : null}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onRemove(item)}
        disabled={disabled}
        aria-label={`Poista ${label}`}
        className="flex w-11 shrink-0 items-center justify-center text-ink-faint transition-colors active:text-signal disabled:opacity-50"
      >
        <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
          <path
            d="M5 5l10 10M15 5L5 15"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </li>
  );
}
