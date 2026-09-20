"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";

/**
 * Creates a list and goes straight to it.
 *
 * Deliberately one field. Asking for a store, a nickname and a name before
 * anyone has added a single item is how a two-minute task turns into a form —
 * the rest is editable later, from inside the list.
 */
export function CreateListForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      // An unnamed list still needs a name; the date is more useful than
      // "Uusi lista" when several accumulate.
      const fallback = `Ostokset ${new Date().toLocaleDateString("fi-FI", {
        day: "numeric",
        month: "numeric",
      })}`;
      const created = await api.createList(name.trim() || fallback);
      router.push(`/l/${created.token}`);
    } catch {
      setError("Listan luonti ei onnistunut. Tarkista verkkoyhteys.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8">
      {error ? (
        <p role="alert" className="mb-2 text-xs font-medium text-signal-dark">
          {error}
        </p>
      ) : null}

      <label htmlFor="list-name" className="eyebrow mb-2 block">
        Listan nimi
      </label>
      <div className="flex gap-2">
        <input
          id="list-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Viikon ostokset"
          autoComplete="off"
          enterKeyHint="go"
          maxLength={120}
          className="h-touch min-w-0 flex-1 rounded-full border border-rule bg-surface px-4 text-base text-ink placeholder:text-ink-faint focus:border-signal focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="h-touch shrink-0 rounded-full bg-signal px-6 text-sm font-semibold text-white transition-transform active:scale-95 disabled:bg-ink-faint"
        >
          {busy ? "Luodaan…" : "Tee lista"}
        </button>
      </div>
    </form>
  );
}
