"use client";

import { useState } from "react";

interface Props {
  url: string;
  listName: string;
}

/**
 * Sharing, which is the whole point of the app.
 *
 * Uses the native share sheet where it exists — on a phone that is one tap into
 * WhatsApp or Messages, which is where these links actually get sent — and
 * falls back to copying the link. Sharing never requires the recipient to have
 * an account: whoever holds the link can edit.
 */
export function ShareButton({ url, listName }: Props) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: listName, text: "Yhteinen ostoslista", url });
        return;
      } catch {
        // The user dismissed the sheet, or the browser refused. Fall through to
        // copying rather than leaving the tap with no result.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Kopioi linkki:", url);
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-3.5 text-xs font-semibold text-paper transition-transform active:scale-95"
    >
      {copied ? (
        "Kopioitu"
      ) : (
        <>
          <svg viewBox="0 0 20 20" className="size-3.5" fill="none" aria-hidden="true">
            <path
              d="M10 3v10M10 3L6.5 6.5M10 3l3.5 3.5M4 13v2.5A1.5 1.5 0 005.5 17h9a1.5 1.5 0 001.5-1.5V13"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Jaa
        </>
      )}
    </button>
  );
}
