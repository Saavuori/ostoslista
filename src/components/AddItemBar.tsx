"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import type { CatalogueItem } from "@/lib/catalogue/cache";
import { formatCents } from "@/lib/format";
import { productImageUrl } from "@/lib/images";

interface Props {
  storeId: string;
  onAddProduct: (item: CatalogueItem) => void;
  onAddFreeText: (text: string) => void;
}

/**
 * The add control: a text field that suggests real products as you type.
 *
 * Two rules shape this.
 *
 * Free text is never second-class. "Jotain jälkiruoaksi" is a legitimate list
 * item, so pressing enter always adds what you typed; suggestions are an
 * accelerator, never a gate.
 *
 * Suggestions open upward. The field is pinned to the bottom of the screen in
 * the thumb zone, so a dropdown would open under the keyboard.
 */
export function AddItemBar({ storeId, onAddProduct, onAddFreeText }: Props) {
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  /** True when the catalogue is unreachable; free text still works. */
  const [degraded, setDegraded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const query = draft.trim();

  useEffect(() => {
    if (query.length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }

    // Debounced, and the previous request is aborted: typing quickly should
    // not leave older responses racing to overwrite newer ones.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: query, storeId, limit: "8" });
        const response = await fetch(`/api/products/search?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as {
          items: CatalogueItem[];
          degraded?: boolean;
        };
        setDegraded(body.degraded === true);
        setItems(body.items);
        setOpen(body.items.length > 0);
      } catch {
        // Aborted or offline. The typed text can still be added as free text.
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, storeId]);

  function reset() {
    setDraft("");
    setItems([]);
    setOpen(false);
    // Keep focus so several items can be added without re-tapping the field.
    inputRef.current?.focus();
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (query.length === 0) return;
    onAddFreeText(query);
    reset();
  }

  function pick(item: CatalogueItem) {
    onAddProduct(item);
    reset();
  }

  return (
    <div className="relative">
      {open ? (
        <ul
          id={listId}
          className="absolute right-0 bottom-full left-0 mb-2 max-h-[min(22rem,50dvh)] overflow-y-auto overscroll-contain rounded-card border border-rule bg-surface shadow-lg shadow-ink/5"
        >
          {items.map((item) => (
            <li key={item.ean} className="border-b border-rule last:border-b-0">
              <button
                type="button"
                onClick={() => pick(item)}
                className="flex min-h-touch w-full items-center gap-3 p-2.5 text-left active:bg-sunk"
              >
                {item.imageUrl ? (
                  // Hotlinked from Kesko's CDN rather than mirrored, and asked
                  // for at the size actually drawn — the originals are ~1440px.
                  <Image
                    src={productImageUrl(item.imageUrl, 48) ?? item.imageUrl}
                    alt=""
                    width={96}
                    height={96}
                    unoptimized
                    className="size-12 shrink-0 rounded-md bg-white object-contain p-0.5"
                  />
                ) : (
                  <span aria-hidden="true" className="size-12 shrink-0 rounded-md bg-sunk" />
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-snug text-ink">{item.name}</span>
                  <span className="tabular mt-0.5 block text-xs text-ink-faint">
                    {item.comparisonCents
                      ? `${formatCents(item.comparisonCents)}/${item.comparisonUnit}`
                      : item.unit}
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span className="tabular block text-sm font-semibold text-ink">
                    {item.isApproximate ? "n. " : ""}
                    {formatCents(item.bestUnitCents)}
                  </span>
                  {/* Green means savings, and only savings. */}
                  {item.discountPercent ? (
                    <span className="mt-0.5 block rounded-full bg-fresh-wash px-1.5 py-0.5 text-[0.625rem] font-bold text-fresh">
                      {item.bestKind === "batch"
                        ? `${item.bestAmount} kpl ${formatCents(item.bestBundleCents)}`
                        : `−${item.discountPercent} %`}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        Search being unavailable must not look like the app is broken: the
        list still works, you just do not get prices and pictures.
      */}
      {degraded && query.length >= 2 ? (
        <p className="mb-2 text-xs text-ink-faint">
          Tuotehaku ei ole juuri nyt käytettävissä. Voit silti lisätä tuotteen nimellä.
        </p>
      ) : null}

      <form onSubmit={submit} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setOpen(items.length > 0)}
            placeholder="Lisää tuote…"
            aria-label="Lisää tuote"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            role="combobox"
            aria-autocomplete="list"
            enterKeyHint="done"
            autoComplete="off"
            className="h-touch w-full rounded-full border border-rule bg-surface px-4 text-base text-ink placeholder:text-ink-faint focus:border-signal focus:outline-none"
          />
          {loading ? (
            <span
              aria-hidden="true"
              className="-translate-y-1/2 absolute top-1/2 right-4 size-3.5 animate-spin rounded-full border-2 border-rule border-t-signal"
            />
          ) : null}
        </div>

        <button
          type="submit"
          disabled={query.length === 0}
          className="h-touch shrink-0 rounded-full bg-signal px-5 text-sm font-semibold text-white transition-transform active:scale-95 disabled:bg-ink-faint"
        >
          Lisää
        </button>
      </form>
    </div>
  );
}
