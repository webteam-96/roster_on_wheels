"use client";

import { useParams } from "next/navigation";
import RiSubGroupForm from "@/components/RiSubGroupForm";

export default function Page() {
  const params = useParams();
  const subGroupId = Number(params.subGroupId);
  return <RiSubGroupForm subGroupId={subGroupId} />;
}
