"use client";

import { useEffect, useState } from "react";
import { formatCents } from "@/lib/format";
import type { HistoryEntry } from "@/lib/lists/service";

interface Props {
  token: string;
  /** Bumped by the parent so the list refreshes after items change. */
  revision: number;
  onPick: (entry: HistoryEntry) => void;
}

/**
 * Things this list has bought before.
 *
 * Households buy the same forty things over and over, so the fastest way to
 * build next week's list is to re-tap last week's. Shown above the input where
 * the suggestions would otherwise be, and only when there is nothing typed.
 */
export function HistoryChips({ token, revision, onPick }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is not
  // read by the effect — it is the signal to refetch. The parent bumps it when
  // the list changes, because what belongs in the history depends on what is
  // currently on the list.
  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/lists/${token}/history`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { entries: [] }))
      .then((body: { entries: HistoryEntry[] }) => setEntries(body.entries))
      .catch(() => {
        // Offline, or the list has no history. Either way there is nothing
        // to show and nothing to report.
      });

    return () => controller.abort();
  }, [token, revision]);

  if (entries.length === 0) return null;

  return (
    <div className="mb-3">
      <p className="eyebrow mb-2">Aiemmin ostettua</p>
      <ul className="flex flex-wrap gap-1.5">
        {entries.map((entry) => (
          <li key={entry.ean ?? entry.freeText}>
            <button
              type="button"
              onClick={() => onPick(entry)}
              className="flex items-center gap-1.5 rounded-full border border-rule bg-surface px-3 py-1.5 text-xs text-ink transition-colors active:bg-sunk"
            >
              <span className="max-w-[12rem] truncate">{entry.name}</span>
              {entry.priceCentsSnapshot ? (
                <span className="tabular text-ink-faint">
                  {formatCents(entry.priceCentsSnapshot)}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
