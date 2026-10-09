"use client";

// Thin route wrapper. The component lives in view.tsx as a named export so it
// can also be embedded inside the E-Governance tab strip. Page default exports
// must stay prop-less to satisfy Next's PageProps type check.
import { DashboardRotaryNetworkView } from "./view";

export default function DashboardRotaryNetworkPage() {
  return <DashboardRotaryNetworkView />;
}
