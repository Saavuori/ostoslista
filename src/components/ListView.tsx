"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { AddItemBar } from "@/components/AddItemBar";
import { HistoryChips } from "@/components/HistoryChips";
import { ItemRow } from "@/components/ItemRow";
import { ShareButton } from "@/components/ShareButton";
import type { CatalogueItem } from "@/lib/catalogue/cache";
import { api } from "@/lib/client/api";
import { tabMemberId } from "@/lib/client/member";
import type { ConnectionState } from "@/lib/client/useListStream";
import { useListStream } from "@/lib/client/useListStream";
import { formatCents, formatQty } from "@/lib/format";
import { uuidv7 } from "@/lib/ids";
import { groupByAisle, isGroupingUseful } from "@/lib/lists/grouping";
import type { HistoryEntry, ItemView, ListView as ListData } from "@/lib/lists/service";
import { sumCents } from "@/lib/lists/totals";
import { cacheList } from "@/lib/offline/db";
import { queueChange, useOfflineSync } from "@/lib/offline/queue";

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
   * Who this tab is on the list: attributes its writes and lets it ignore the
   * echo of its own changes. Only needed in the browser — the server render
   * never writes — so it is read once there and never changes afterwards.
   */
  const [memberId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : (list.memberId ?? tabMemberId(list.token)),
  );

  /**
   * Shopping order versus the order things were added.
   *
   * Remembered per list in localStorage: a per-viewer convenience, not shared
   * state — two people in different shops may reasonably want different views.
   */
  const [byAisle, setByAisle] = useState(false);
  const storageKey = `ostoslista:aisle:${list.token}`;

  useEffect(() => {
    try {
      setByAisle(window.localStorage.getItem(storageKey) === "1");
    } catch {
      // Private window or blocked storage; the default is fine.
    }
  }, [storageKey]);

  function toggleAisleMode() {
    setByAisle((on) => {
      const next = !on;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        // Not worth failing the interaction over.
      }
      return next;
    });
  }

  /**
   * The outbox.
   *
   * Every mutation below records its intent locally when the network call
   * fails, and this drains the queue when connectivity comes back. A change
   * made in a shop with no signal is the normal case, not an error.
   */
  const {
    pending: pendingWrites,
    abandoned,
    flushNow,
  } = useOfflineSync(list.token, memberId, (fresh) => setItems(fresh));

  // Keep the on-device copy current so the list still opens with no signal.
  useEffect(() => {
    void cacheList(
      list.token,
      {
        id: list.id,
        name: list.name,
        storeId: list.storeId,
        role: list.role,
        memberId: list.memberId ?? null,
      },
      items,
    );
  }, [list.token, list.id, list.name, list.storeId, list.role, list.memberId, items]);

  /**
   * Live updates from everyone else on the list.
   *
   * Incoming rows are merged by id rather than replacing the array, so a
   * change arriving mid-edit cannot clobber an optimistic local update.
   */
  const { state: connection, viewers } = useListStream({
    token: list.token,
    memberId,
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
    return {
      pending,
      done,
      totalCents: sumCents(optimisticItems),
      remainingCents: sumCents(pending),
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
          updatedBy: memberId,
        });
        setItems((current) => current.map((i) => (i.id === updated.id ? updated : i)));
      } catch {
        // Offline, or the server is unreachable. Keep the change and send it
        // later rather than telling someone mid-shop that it failed.
        setItems((current) =>
          current.map((i) => (i.id === item.id ? { ...i, checked: !item.checked } : i)),
        );
        await queueChange(list.token, item.id, "update", { checked: !item.checked });
        flushNow();
      }
    });
  }

  function remove(item: ItemView) {
    if (readOnly) return;
    startTransition(async () => {
      applyPatch({ type: "remove", id: item.id });
      try {
        await api.deleteItem(list.token, item.id, memberId);
        setItems((current) => current.filter((i) => i.id !== item.id));
      } catch {
        setItems((current) => current.filter((i) => i.id !== item.id));
        await queueChange(list.token, item.id, "delete", {});
        flushNow();
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
        const { item, merged } = await api.addItem(list.token, { ...payload, addedBy: memberId });
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
        // The row keeps its client-generated id, so the queued creation and
        // the optimistic row are the same thing.
        setItems((current) =>
          current.some((i) => i.id === optimistic.id) ? current : [...current, optimistic],
        );
        await queueChange(list.token, optimistic.id, "create", {
          ...optimistic,
          token: list.token,
        });
        flushNow();
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
      aisleName: null,
      aisleOrder: null,
      imageUrl: null,
      comparisonCents: null,
      comparisonUnit: null,
      discountPercent: null,
      discountType: null,
      offerAmount: null,
      offerBundleCents: null,
      qty: 1,
      qtyUnit: "kpl",
      note: null,
      checked: false,
      checkedBy: null,
      checkedAt: null,
      // One past the current last row. A sentinel like MAX_SAFE_INTEGER sorts
      // correctly in the UI but overflows the numeric column on sync.
      sortKey: items.reduce((max, i) => Math.max(max, i.sortKey), 0) + 1,
      addedBy: memberId,
      updatedAt: new Date(),
      updatedBy: memberId,
      deletedAt: null,
      ...overrides,
    };
  }

  /** Re-adds something the list has bought before, with its details intact. */
  function addFromHistory(entry: HistoryEntry) {
    const optimistic = blankItem({
      ean: entry.ean,
      freeText: entry.freeText,
      nameSnapshot: entry.ean ? entry.name : null,
      priceCentsSnapshot: entry.priceCentsSnapshot,
      aisleName: entry.aisleName,
      aisleOrder: entry.aisleOrder,
      imageUrl: entry.imageUrl,
      comparisonCents: entry.comparisonCents,
      comparisonUnit: entry.comparisonUnit,
      discountPercent: entry.discountPercent,
      discountType: entry.discountType,
      offerAmount: entry.offerAmount,
      offerBundleCents: entry.offerBundleCents,
      qtyUnit: entry.qtyUnit,
    });

    add(optimistic, {
      id: optimistic.id,
      ean: entry.ean,
      freeText: entry.ean ? null : entry.freeText,
      nameSnapshot: entry.ean ? entry.name : null,
      priceCentsSnapshot: entry.priceCentsSnapshot,
      aisleName: entry.aisleName,
      aisleOrder: entry.aisleOrder,
      imageUrl: entry.imageUrl,
      comparisonCents: entry.comparisonCents,
      comparisonUnit: entry.comparisonUnit,
      discountPercent: entry.discountPercent,
      discountType: entry.discountType,
      offerAmount: entry.offerAmount,
      offerBundleCents: entry.offerBundleCents,
      qty: 1,
      qtyUnit: entry.qtyUnit,
    });
  }

  function addFreeText(text: string) {
    const optimistic = blankItem({ freeText: text });
    add(optimistic, { id: optimistic.id, freeText: text, qty: 1, qtyUnit: "kpl" });
  }

  function addProduct(product: CatalogueItem) {
    // Loose goods default to a sensible weight rather than "1 kg".
    const qty = product.soldBy === "mass" ? 0.5 : 1;
    const qtyUnit = product.soldBy === "mass" ? "kg" : "kpl";

    /**
     * The price of one unit bought on its own. A multi-buy only applies to
     * complete bundles, so its per-unit share is not what one costs — the
     * bundle travels separately in `offerAmount` / `offerBundleCents`.
     */
    const unitCents = product.bestKind === "batch" ? product.normalCents : product.bestUnitCents;

    /**
     * Snapshotted so the row keeps the information the search result showed,
     * with no connection — which is exactly when it is needed. The picture
     * identifies the product on a shelf and the offer says to grab two.
     */
    const snapshot = {
      aisleName: product.categoryName,
      aisleOrder: product.categoryOrder,
      imageUrl: product.imageUrl,
      comparisonCents: product.comparisonCents,
      comparisonUnit: product.comparisonUnit,
      discountPercent: product.discountPercent,
      discountType: product.discountType,
      offerAmount: product.bestAmount,
      offerBundleCents: product.bestBundleCents,
    };

    const optimistic = blankItem({
      ean: product.ean,
      nameSnapshot: product.name,
      priceCentsSnapshot: unitCents,
      ...snapshot,
      qty,
      qtyUnit,
    });

    add(optimistic, {
      id: optimistic.id,
      ean: product.ean,
      nameSnapshot: product.name,
      priceCentsSnapshot: unitCents,
      ...snapshot,
      qty,
      qtyUnit,
    });
  }

  // Reserve the picture column only when the list actually has pictures.
  const showImages = optimisticItems.some((i) => i.imageUrl);
  const canGroup = isGroupingUseful(pending);
  const grouped = byAisle && canGroup;

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
            <ConnectionBadge state={connection} viewers={viewers} pending={pendingWrites} />
            <ShareButton url={shareUrl} listName={list.name} />
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-4">
        {/*
          Offered only when there is more than one aisle to sort into —
          a toggle that visibly does nothing is worse than no toggle.
        */}
        {canGroup ? (
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={toggleAisleMode}
              aria-pressed={grouped}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                grouped ? "border-ink bg-ink text-paper" : "border-rule bg-surface text-ink-soft"
              }`}
            >
              Hyllyjärjestys
            </button>
          </div>
        ) : null}
        {optimisticItems.length === 0 ? (
          <EmptyState readOnly={readOnly} />
        ) : (
          <>
            {pending.length > 0 ? (
              grouped ? (
                <div className="space-y-5">
                  {groupByAisle(pending).map((group) => (
                    <section key={group.name}>
                      <p className="eyebrow mb-2 px-1">{group.name}</p>
                      <ul className="overflow-hidden rounded-card border border-rule bg-surface">
                        {group.items.map((item) => (
                          <ItemRow
                            key={item.id}
                            item={item}
                            onToggle={toggle}
                            onRemove={remove}
                            disabled={readOnly}
                            showImages={showImages}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <ul className="overflow-hidden rounded-card border border-rule bg-surface">
                  {pending.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onToggle={toggle}
                      onRemove={remove}
                      disabled={readOnly}
                      showImages={showImages}
                    />
                  ))}
                </ul>
              )
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
                      showImages={showImages}
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
        {abandoned > 0 ? (
          <p role="alert" className="mb-2 text-xs font-medium text-signal-dark">
            {abandoned} muutosta ei saatu tallennettua.
          </p>
        ) : null}

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
          <>
            <HistoryChips token={list.token} revision={items.length} onPick={addFromHistory} />
            <AddItemBar
              storeId={list.storeId}
              onAddProduct={addProduct}
              onAddFreeText={addFreeText}
            />
          </>
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
function ConnectionBadge({
  state,
  viewers,
  pending,
}: {
  state: ConnectionState;
  viewers: number;
  pending: number;
}) {
  // Unsent changes are the more useful fact when both are true: it tells you
  // the work is safe, not just that the network is down.
  if (pending > 0) {
    return (
      <span className="tabular rounded-full bg-sunk px-2.5 py-1 text-[0.6875rem] font-semibold text-ink-soft">
        {pending} odottaa
      </span>
    );
  }

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
