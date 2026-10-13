"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { offerLabel } from "@/components/ItemRow";
import { formatCents, formatQty } from "@/lib/format";
import { productImageUrl } from "@/lib/images";
import type { ItemView } from "@/lib/lists/service";
import { lineTotalCents } from "@/lib/lists/totals";

interface Props {
  item: ItemView;
  onClose: () => void;
  onRemove: (item: ItemView) => void;
  readOnly: boolean;
}

/**
 * Everything the list knows about one line, in a bottom sheet.
 *
 * The row has to stay compact, so long product names are clamped there — and
 * "Pirkka luomu kevytmaito 1l" and "Pirkka luomu kevytmaito laktoositon 1l"
 * clamp to the same thing. This is where the full name, a picture large
 * enough to match against a shelf, and the EAN live.
 *
 * Built only from the item's snapshot, so it opens with no connection: the
 * moment it is needed most is standing in a shop unsure which one to pick.
 *
 * A native `<dialog>` because `showModal()` brings focus trapping, Escape and
 * the inert background for free. Anchored to the bottom, where the thumb is.
 */
export function ItemDetails({ item, onClose, onRemove, readOnly }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const label = item.nameSnapshot ?? item.freeText ?? "Nimetön tuote";
  const isProduct = item.ean !== null || item.nameSnapshot !== null;
  const offer = offerLabel(item);
  const image = productImageUrl(item.imageUrl, 160);
  const lineCents = lineTotalCents(item);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape already closes a modal dialog
    <dialog
      ref={ref}
      aria-labelledby="item-details-name"
      onClose={onClose}
      // A tap on the dimmed backdrop lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      className="mx-auto mt-auto mb-0 max-h-[85dvh] w-full max-w-md rounded-t-card bg-surface text-ink backdrop:bg-ink/40"
    >
      <div className="px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div aria-hidden="true" className="mx-auto mb-4 h-1 w-10 rounded-full bg-rule" />

        {image ? (
          <Image
            src={image}
            alt=""
            width={320}
            height={320}
            unoptimized
            className="mx-auto mb-4 size-40 rounded-card bg-white object-contain"
          />
        ) : null}

        {/* Unclamped, and selectable so it can be copied into a search. */}
        <h2
          id="item-details-name"
          className="text-lg leading-snug font-semibold break-words select-text"
        >
          {label}
        </h2>
        {item.checked ? <p className="mt-0.5 text-xs text-ink-faint">Korissa</p> : null}

        <dl className="mt-4 divide-y divide-rule border-y border-rule text-sm">
          <Detail term="Määrä" value={formatQty(item.qty, item.qtyUnit)} />
          {item.priceCentsSnapshot !== null ? (
            <Detail
              term="Hinta"
              value={`${formatCents(item.priceCentsSnapshot)}/${item.qtyUnit}`}
            />
          ) : null}
          {lineCents !== null ? (
            <Detail term="Yhteensä" value={formatCents(lineCents)} strong />
          ) : null}
          {item.comparisonCents && item.comparisonUnit ? (
            <Detail
              term="Vertailuhinta"
              value={`${formatCents(item.comparisonCents)}/${item.comparisonUnit}`}
            />
          ) : null}
          {offer ? (
            <Detail
              term="Tarjous"
              value={item.discountType === "PLUSSA" ? `${offer} · Plussa` : offer}
              fresh
            />
          ) : null}
          {item.aisleName ? <Detail term="Osasto" value={item.aisleName} words /> : null}
          {item.ean ? <Detail term="EAN" value={item.ean} /> : null}
          {item.note ? <Detail term="Lisätieto" value={item.note} words /> : null}
        </dl>

        <p className="mt-2 text-xs text-ink-faint">
          {isProduct
            ? "Hinta on lisäyshetkeltä ja voi kaupassa poiketa."
            : "Itse kirjoitettu, joten tuotetietoja ei ole."}
        </p>

        <div className="mt-5 flex gap-2">
          {readOnly ? null : (
            <button
              type="button"
              onClick={() => {
                onRemove(item);
                ref.current?.close();
              }}
              className="min-h-touch flex-1 rounded-full border border-rule px-4 text-sm font-semibold text-signal-dark active:bg-signal-wash"
            >
              Poista listalta
            </button>
          )}
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="min-h-touch flex-1 rounded-full bg-ink px-4 text-sm font-semibold text-paper active:scale-[0.98]"
          >
            Sulje
          </button>
        </div>
      </div>
    </dialog>
  );
}

function Detail({
  term,
  value,
  strong,
  fresh,
  words,
}: {
  term: string;
  value: string;
  strong?: boolean;
  /** Green is for savings only. */
  fresh?: boolean;
  /** Prose rather than a figure, so not set in mono. */
  words?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-ink-soft">{term}</dt>
      <dd
        className={`min-w-0 text-right break-words ${words ? "" : "tabular "}${
          fresh ? "font-semibold text-fresh" : strong ? "font-semibold text-ink" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
