"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { AddItemBar } from "@/components/AddItemBar";
import { ItemRow } from "@/components/ItemRow";
import { ShareButton } from "@/components/ShareButton";
import type { CatalogueItem } from "@/lib/catalogue/cache";
import { api } from "@/lib/client/api";
import type { ConnectionState } from "@/lib/client/useListStream";
import { useListStream } from "@/lib/client/useListStream";
import { formatCents, formatQty } from "@/lib/format";
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
  const [error, setError] = useState<string | null>(null);
  /** Transient confirmation, e.g. when an add merged into an existing line. */
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2400);
    return () => clearTimeout(timer);
  }, [notice]);

  const readOnly = list.role !== "editor";

  /**
   * Live updates from everyone else on the list.
   *
   * Incoming rows are merged by id rather than replacing the array, so a
   * change arriving mid-edit cannot clobber an optimistic local update.
   */
  const { state: connection, viewers } = useListStream({
    token: list.token,
    memberId: list.memberId ?? null,
    onItemUpserted: (incoming) =>
      setItems((current) =>
        current.some((i) => i.id === incoming.id)
          ? current.map((i) => (i.id === incoming.id ? incoming : i))
          : [...current, incoming],
      ),
    onItemRemoved: (itemId) => setItems((current) => current.filter((i) => i.id !== itemId)),
    onResync: () => {
      // Too much was missed to patch up; take the server's word for it.
      void api
        .getList(list.token)
        .then((fresh) => setItems(fresh.items))
        .catch(() => setError("Listan päivitys epäonnistui."));
    },
  });

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

  /**
   * Adds a line and reconciles it with what the server returns.
   *
   * The optimistic row carries the id, so when the server replies — possibly
   * having merged this into an existing line instead of inserting — we can
   * replace or drop the placeholder without a refetch.
   */
  function add(optimistic: ItemView, payload: Parameters<typeof api.addItem>[1]) {
    if (readOnly) return;
    setError(null);
    setNotice(null);

    startTransition(async () => {
      applyPatch({ type: "add", item: optimistic });
      try {
        const { item, merged } = await api.addItem(list.token, payload);
        setItems((current) => {
          const withoutPlaceholder = current.filter((i) => i.id !== optimistic.id);
          const existing = withoutPlaceholder.some((i) => i.id === item.id);
          return existing
            ? withoutPlaceholder.map((i) => (i.id === item.id ? item : i))
            : [...withoutPlaceholder, item];
        });
        if (merged) {
          // The row was already on the list, so its quantity went up instead
          // of a new line appearing. Without a word, the tap looks like it did
          // nothing at all.
          const label = item.nameSnapshot ?? item.freeText ?? "Tuote";
          setNotice(`${label} · ${formatQty(item.qty, item.qtyUnit)}`);
        }
      } catch {
        setError(`"${optimistic.nameSnapshot ?? optimistic.freeText}" ei tallentunut.`);
      }
    });
  }

  function blankItem(overrides: Partial<ItemView>): ItemView {
    return {
      id: uuidv7(),
      ean: null,
      freeText: null,
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
      ...overrides,
    };
  }

  function addFreeText(text: string) {
    const optimistic = blankItem({ freeText: text });
    add(optimistic, { id: optimistic.id, freeText: text, qty: 1, qtyUnit: "kpl" });
  }

  function addProduct(product: CatalogueItem) {
    // Loose goods default to a sensible weight rather than "1 kg".
    const qty = product.soldBy === "mass" ? 0.5 : 1;
    const qtyUnit = product.soldBy === "mass" ? "kg" : "kpl";

    const optimistic = blankItem({
      ean: product.ean,
      nameSnapshot: product.name,
      priceCentsSnapshot: product.bestUnitCents,
      qty,
      qtyUnit,
    });

    add(optimistic, {
      id: optimistic.id,
      ean: product.ean,
      nameSnapshot: product.name,
      priceCentsSnapshot: product.bestUnitCents,
      qty,
      qtyUnit,
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
          <div className="flex shrink-0 items-center gap-2">
            <ConnectionBadge state={connection} viewers={viewers} />
            <ShareButton url={shareUrl} listName={list.name} />
          </div>
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
        ) : notice ? (
          <p role="status" className="mb-2 text-xs font-medium text-ink-soft">
            Oli jo listalla — määrä nyt {notice}
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
          <AddItemBar
            storeId={list.storeId}
            onAddProduct={addProduct}
            onAddFreeText={addFreeText}
          />
        )}
      </footer>
    </div>
  );
}

/**
 * Connection and presence.
 *
 * Only shown when it tells you something you would otherwise not know: that
 * changes are not reaching anyone, or that someone else is looking at the list
 * right now. A permanent "connected" badge is noise.
 */
function ConnectionBadge({ state, viewers }: { state: ConnectionState; viewers: number }) {
  if (state === "offline") {
    return (
      <span className="rounded-full bg-sunk px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-soft">
        Ei yhteyttä
      </span>
    );
  }

  if (state === "live" && viewers > 1) {
    return (
      <span
        className="tabular flex items-center gap-1 rounded-full bg-fresh-wash px-2.5 py-1 text-[0.6875rem] font-semibold text-fresh"
        title={`${viewers} katselijaa`}
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-fresh" />
        {viewers}
      </span>
    );
  }

  return null;
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
      // The optimistic row and the confirmed row share an id, so during the
      // transition both can be present. Adding blindly renders duplicate keys.
      return current.some((item) => item.id === patch.item.id) ? current : [...current, patch.item];
  }
}
