"use client";

// Thin route wrapper. The component lives in view.tsx as a named export so it
// can also be embedded inside the E-Governance tab strip. Page default exports
// must stay prop-less to satisfy Next's PageProps type check.
import { DistrictRotaryNetworkView } from "./view";

export default function DistrictRotaryNetworkPage() {
  return <DistrictRotaryNetworkView />;
}
