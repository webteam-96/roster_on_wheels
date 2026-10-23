"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireSuperAdmin?: boolean;
}

export default function ProtectedRoute({ children, requireSuperAdmin }: ProtectedRouteProps) {
  const { isAuthenticated, isSuperAdmin, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Quick check: if no token in localStorage, redirect immediately
    if (!loading && !isAuthenticated) {
      router.replace("/login");
      return;
    }
    if (!loading && requireSuperAdmin && !isSuperAdmin) {
      router.replace("/admin"); // the role home ("/" is the public site, which sends signed-in users to log in)
    }
  }, [isAuthenticated, isSuperAdmin, requireSuperAdmin, loading, router]);

  if (loading) {
    return null;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (requireSuperAdmin && !isSuperAdmin) {
    return null;
  }

  return <>{children}</>;
}
