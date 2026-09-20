"use client";

import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { ItemRow } from "@/components/ItemRow";
import { ShareButton } from "@/components/ShareButton";
import { api } from "@/lib/client/api";
import { formatCents } from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import type { ItemView, ListView as ListData } from "@/lib/lists/service";

interface Props {
  list: ListData;
  shareUrl: string;
}

type Patch =
  | { type: "toggle"; id: string }
  | { type: "remove"; id: string }
  | {
      type: "add";
      item: ItemView;
    };

/**
 * The list screen.
 *
 * Layout is driven by the in-shop case: a fixed header for context, a
 * scrolling list, and every control you actually press pinned to the bottom
 * where a thumb reaches. Edits apply optimistically — waiting for a round-trip
 * before a checkbox moves feels broken on a slow connection, and on no
 * connection at all it would be unusable.
 */
export function ListView({ list, shareUrl }: Props) {
  const [items, setItems] = useState<ItemView[]>(list.items);
  const [optimisticItems, applyPatch] = useOptimistic(items, patchItems);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const readOnly = list.role !== "editor";

  const { pending, done, totalCents, remainingCents } = useMemo(() => {
    const pending = optimisticItems.filter((i) => !i.checked);
    const done = optimisticItems.filter((i) => i.checked);
    const sum = (rows: ItemView[]) =>
      rows.reduce((acc, i) => acc + Math.round((i.priceCentsSnapshot ?? 0) * i.qty), 0);
    return {
      pending,
      done,
      totalCents: sum(optimisticItems),
      remainingCents: sum(pending),
    };
  }, [optimisticItems]);

  function toggle(item: ItemView) {
    if (readOnly) return;
    startTransition(async () => {
      applyPatch({ type: "toggle", id: item.id });
      try {
        const updated = await api.updateItem(list.token, item.id, {
          checked: !item.checked,
          updatedAt: new Date().toISOString(),
        });
        setItems((current) => current.map((i) => (i.id === updated.id ? updated : i)));
      } catch {
        setError("Muutos ei tallentunut. Yritä uudelleen.");
      }
    });
  }

  function remove(item: ItemView) {
    if (readOnly) return;
    startTransition(async () => {
      applyPatch({ type: "remove", id: item.id });
      try {
        await api.deleteItem(list.token, item.id);
        setItems((current) => current.filter((i) => i.id !== item.id));
      } catch {
        setError("Poisto ei onnistunut. Yritä uudelleen.");
      }
    });
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || readOnly) return;

    setDraft("");
    setError(null);
    // Keep focus so several items can be typed in a row without re-tapping.
    inputRef.current?.focus();

    const optimistic: ItemView = {
      id: uuidv7(),
      ean: null,
      freeText: text,
      nameSnapshot: null,
      priceCentsSnapshot: null,
      qty: 1,
      qtyUnit: "kpl",
      note: null,
      checked: false,
      checkedBy: null,
      checkedAt: null,
      sortKey: Number.MAX_SAFE_INTEGER,
      addedBy: null,
      updatedAt: new Date(),
      updatedBy: null,
      deletedAt: null,
    };

    startTransition(async () => {
      applyPatch({ type: "add", item: optimistic });
      try {
        const { item } = await api.addItem(list.token, {
          id: optimistic.id,
          freeText: text,
          qty: 1,
          qtyUnit: "kpl",
        });
        setItems((current) =>
          current.some((i) => i.id === item.id)
            ? current.map((i) => (i.id === item.id ? item : i))
            : [...current, item],
        );
      } catch {
        setError(`"${text}" ei tallentunut.`);
      }
    });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-paper">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/95 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight text-ink">{list.name}</h1>
            <p className="tabular mt-0.5 text-xs text-ink-faint">
              {pending.length > 0
                ? `${pending.length} jäljellä · ${done.length} valmiina`
                : optimisticItems.length > 0
                  ? "Kaikki kerätty"
                  : "Tyhjä lista"}
            </p>
          </div>
          <ShareButton url={shareUrl} listName={list.name} />
        </div>
      </header>

      <main className="flex-1 px-4 py-4">
        {optimisticItems.length === 0 ? (
          <EmptyState readOnly={readOnly} />
        ) : (
          <>
            {pending.length > 0 ? (
              <ul className="overflow-hidden rounded-card border border-rule bg-surface">
                {pending.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onToggle={toggle}
                    onRemove={remove}
                    disabled={readOnly}
                  />
                ))}
              </ul>
            ) : null}

            {done.length > 0 ? (
              <section className="mt-6">
                <p className="eyebrow mb-2 px-1">Korissa · {done.length}</p>
                <ul className="overflow-hidden rounded-card border border-rule bg-surface/60">
                  {done.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onToggle={toggle}
                      onRemove={remove}
                      disabled={readOnly}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </main>

      {/* Thumb zone: everything pressable lives here, not in the header. */}
      <footer className="sticky bottom-0 border-t border-rule bg-paper/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        {error ? (
          <p role="alert" className="mb-2 text-xs font-medium text-signal-dark">
            {error}
          </p>
        ) : null}

        {totalCents > 0 ? (
          <div className="mb-3 flex items-baseline justify-between">
            <span className="eyebrow">Arvio</span>
            <span className="tabular text-sm text-ink-soft">
              {remainingCents !== totalCents ? (
                <>
                  <span className="text-ink-faint">{formatCents(remainingCents)} jäljellä</span>
                  <span className="mx-1.5 text-ink-faint">/</span>
                </>
              ) : null}
              <span className="font-semibold text-ink">{formatCents(totalCents)}</span>
            </span>
          </div>
        ) : null}

        {readOnly ? (
          <p className="py-2 text-center text-xs text-ink-faint">
            Tämä linkki on vain katselua varten.
          </p>
        ) : (
          <form onSubmit={add} className="flex gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Lisää tuote…"
              aria-label="Lisää tuote"
              enterKeyHint="done"
              autoComplete="off"
              className="h-touch min-w-0 flex-1 rounded-full border border-rule bg-surface px-4 text-base text-ink placeholder:text-ink-faint focus:border-signal focus:outline-none"
            />
            <button
              type="submit"
              disabled={draft.trim().length === 0}
              className="h-touch shrink-0 rounded-full bg-signal px-5 text-sm font-semibold text-white transition-transform active:scale-95 disabled:bg-ink-faint"
            >
              Lisää
            </button>
          </form>
        )}
      </footer>
    </div>
  );
}

/** An empty screen is an invitation to act, not a shrug. */
function EmptyState({ readOnly }: { readOnly: boolean }) {
  return (
    <div className="rounded-card border border-dashed border-rule px-6 py-12 text-center">
      <p className="text-base font-semibold text-ink">
        {readOnly ? "Lista on tyhjä" : "Aloita listan täyttäminen"}
      </p>
      <p className="mx-auto mt-1.5 max-w-[22ch] text-sm leading-relaxed text-ink-soft">
        {readOnly
          ? "Kun joku lisää tuotteita, ne näkyvät tässä."
          : "Kirjoita ensimmäinen tuote alle. Jaa linkki, niin muutkin voivat lisätä."}
      </p>
    </div>
  );
}

function patchItems(current: ItemView[], patch: Patch): ItemView[] {
  switch (patch.type) {
    case "toggle":
      return current.map((item) =>
        item.id === patch.id ? { ...item, checked: !item.checked } : item,
      );
    case "remove":
      return current.filter((item) => item.id !== patch.id);
    case "add":
      return [...current, patch.item];
  }
}
