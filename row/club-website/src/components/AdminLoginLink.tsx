import { LogIn } from "lucide-react";
import { cn } from "@/lib/cn";

// "Admin Login" link rendered top-right in every theme's header.
// Opens the main rotary-frontend login page in a new tab so the public site
// stays open behind it. Target URL comes from NEXT_PUBLIC_ADMIN_LOGIN_URL, else the
// portal origin (NEXT_PUBLIC_PORTAL_ORIGIN) + "/login".
export function getAdminLoginUrl(): string {
  const portal = (process.env.NEXT_PUBLIC_PORTAL_ORIGIN ?? "").replace(/\/$/, "");
  return process.env.NEXT_PUBLIC_ADMIN_LOGIN_URL || (portal ? `${portal}/login` : "/login");
}

export function AdminLoginLink({ className }: { className?: string }) {
  return (
    <a
      href={getAdminLoginUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium opacity-90 hover:opacity-100 hover:underline underline-offset-2 transition-opacity",
        className
      )}
      title="Open the ROW admin portal in a new tab"
    >
      <LogIn className="h-3.5 w-3.5" aria-hidden />
      <span>Admin Login</span>
    </a>
  );
}
