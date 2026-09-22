"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useState } from "react";
import { forgetList, readSavedLists, type SavedList } from "@/lib/offline/db";

/**
 * The lists this device has opened, on the home page.
 *
 * Without accounts, a list lived only in whatever chat its link was sent to;
 * this makes the home page a way back in. Read from IndexedDB, so it works
 * offline and shows nothing at all on a first visit.
 */
export function SavedLists() {
  const lists = useLiveQuery(readSavedLists, [], null);

  if (!lists || lists.length === 0) return null;

  return (
    <section aria-labelledby="saved-lists" className="mt-8">
      <h2 id="saved-lists" className="eyebrow mb-2">
        Omat listat
      </h2>
      <ul className="divide-y divide-rule overflow-hidden rounded-2xl border border-rule bg-surface">
        {lists.map((list) => (
          <SavedListRow key={list.token} list={list} />
        ))}
      </ul>
    </section>
  );
}

function SavedListRow({ list }: { list: SavedList }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <li className="flex min-h-touch items-center gap-2 bg-signal-wash px-4 py-2">
        <p className="min-w-0 flex-1 text-sm leading-snug text-ink">
          Poistetaanko <span className="font-semibold">{list.name}</span> tältä laitteelta?
          <span className="block text-xs text-ink-soft">
            {list.unsynced > 0
              ? `${list.unsynced} lähettämätöntä muutosta menetetään.`
              : "Linkin saaneet näkevät listan edelleen."}
          </span>
        </p>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="h-10 shrink-0 rounded-full px-3 text-sm font-semibold text-ink-soft"
        >
          Peru
        </button>
        <button
          type="button"
          onClick={() => void forgetList(list.token)}
          className="h-10 shrink-0 rounded-full bg-signal px-4 text-sm font-semibold text-white active:scale-95"
        >
          Poista
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center">
      <Link
        href={`/l/${list.token}`}
        className="flex min-h-touch min-w-0 flex-1 flex-col justify-center px-4 py-2 active:bg-sunk"
      >
        <span className="truncate text-base font-semibold text-ink">{list.name}</span>
        <span className="tabular text-xs text-ink-faint">{summary(list)}</span>
      </Link>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Poista ${list.name}`}
        className="flex size-touch shrink-0 items-center justify-center text-ink-faint active:text-signal"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </li>
  );
}

function summary(list: SavedList): string {
  if (list.total === 0) return "Tyhjä lista";
  if (list.remaining === 0) return "Kaikki kerätty";
  return `${list.remaining} jäljellä · ${list.total - list.remaining} valmiina`;
}
