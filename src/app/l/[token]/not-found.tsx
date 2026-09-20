import Link from "next/link";

export default function ListNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">Listaa ei löytynyt</h1>
      <p className="mt-2 max-w-[28ch] text-sm leading-relaxed text-ink-soft">
        Linkki voi olla vanhentunut, peruttu tai kirjoitettu väärin. Pyydä jakajalta uusi linkki.
      </p>
      <Link
        href="/"
        className="mt-6 flex h-touch items-center rounded-full bg-ink px-6 text-sm font-semibold text-paper"
      >
        Tee oma lista
      </Link>
    </main>
  );
}
