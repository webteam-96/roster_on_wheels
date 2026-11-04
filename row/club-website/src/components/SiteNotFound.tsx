export function SiteNotFound({ host }: { host: string }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-center p-8">
      <div className="max-w-md">
        <h1 className="text-3xl font-semibold">Site not found</h1>
        <p className="mt-4 text-sm text-brand-muted">
          No Rotary club website is configured for <span className="font-mono">{host || "this domain"}</span>.
        </p>
        <p className="mt-2 text-xs text-brand-muted">
          If you are the club administrator, please contact support.
        </p>
      </div>
    </main>
  );
}
