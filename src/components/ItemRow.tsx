"use client";

import { formatCents, formatQty } from "@/lib/format";
import type { ItemView } from "@/lib/lists/service";

interface Props {
  item: ItemView;
  onToggle: (item: ItemView) => void;
  onRemove: (item: ItemView) => void;
  disabled?: boolean;
}

/**
 * One line of the list.
 *
 * The whole row is the toggle target rather than just the checkbox: this gets
 * tapped one-handed, in a shop, while holding a basket. The remove control is a
 * separate, deliberately smaller target so it is hard to hit by accident but
 * still reachable without a gesture nobody would discover.
 */
export function ItemRow({ item, onToggle, onRemove, disabled }: Props) {
  const label = item.nameSnapshot ?? item.freeText ?? "Nimetön tuote";
  const lineCents = item.priceCentsSnapshot ? Math.round(item.priceCentsSnapshot * item.qty) : null;

  return (
    <li className="flex items-stretch border-b border-rule last:border-b-0">
      <button
        type="button"
        onClick={() => onToggle(item)}
        disabled={disabled}
        aria-pressed={item.checked}
        // min-w-0 is load-bearing: without it the flex child refuses to shrink
        // and a long product name pushes the price out of the row.
        className="flex min-h-touch min-w-0 flex-1 items-center gap-3 py-3 pr-2 pl-4 text-left transition-opacity active:bg-sunk disabled:opacity-50"
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

        <span className="min-w-0 flex-1">
          <span
            className={`strike block truncate text-[0.9375rem] leading-snug ${
              item.checked ? "text-ink-faint" : "text-ink"
            }`}
            data-checked={item.checked}
          >
            {label}
          </span>
          <span className="tabular mt-0.5 block text-xs text-ink-faint">
            {formatQty(item.qty, item.qtyUnit)}
          </span>
        </span>

        {/*
          Fixed width and right-aligned so figures stack into a scannable
          column down the list — the reason prices are set in mono at all.
          Reserved even when empty, so rows without a price do not shift.
        */}
        <span
          className={`tabular w-[4.5rem] shrink-0 text-right text-sm font-semibold ${
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
