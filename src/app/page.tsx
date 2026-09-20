export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-between px-4 py-10">
      <div>
        <p className="eyebrow">Yhteinen ostoslista</p>
        <h1 className="mt-3 text-4xl font-bold leading-[1.05] tracking-tight text-ink">
          Yksi lista.
          <br />
          Koko talouden kesken.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-soft">
          Tee lista, jaa linkki, merkitse ostetuksi. Toimii myös kaupassa ilman verkkoa.
        </p>
      </div>
      <p className="tabular text-xs text-ink-faint">v0.1.0 · vaihe 0</p>
    </main>
  );
}
