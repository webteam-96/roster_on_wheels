// Gold-topped card with the dark brand header — same treatment as the admin portal's sign-in card.
export default function CenteredCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-t-4 border-slate-200 border-t-gold-500 bg-white shadow-card">
        <div className="flex items-center gap-3 bg-navy-950 px-6 py-5 text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/row-logo-inverse.png" alt="Roster on Wheels" className="h-12 w-auto object-contain" />
          <h1 className="text-lg font-semibold leading-tight">{title}</h1>
        </div>
        <div className="px-6 py-6">{children}</div>
      </div>
    </main>
  );
}
