import { CreateListForm } from "@/components/CreateListForm";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="flex-1">
        <p className="eyebrow">Yhteinen ostoslista</p>

        <h1 className="mt-3 text-[2.5rem] leading-[1.02] font-bold tracking-tight text-ink">
          Yksi lista.
          <br />
          Koko talous.
        </h1>

        <p className="mt-4 max-w-[30ch] text-base leading-relaxed text-ink-soft">
          Tee lista, jaa linkki, merkitse ostetuksi. Kaikki näkevät saman listan samaan aikaan —
          myös kaupassa ilman verkkoa.
        </p>

        {/*
          The three facts that answer the questions people actually have before
          they tap: does my partner need an account, does it work in the shop,
          and where do the prices come from.
        */}
        <ul className="mt-8 space-y-3 border-t border-rule pt-6">
          {[
            ["Ei tilejä", "Linkin saanut voi muokata listaa heti."],
            ["Toimii kaupassa", "Merkitse ostetuksi myös ilman verkkoa."],
            ["Hinnat mukana", "Tuotetiedot ja hinnat K-Ruoan valikoimasta."],
          ].map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-signal" />
              <span>
                <span className="block text-sm font-semibold text-ink">{title}</span>
                <span className="block text-sm leading-snug text-ink-soft">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <CreateListForm />
    </main>
  );
}
