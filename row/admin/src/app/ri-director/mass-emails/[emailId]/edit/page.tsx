"use client";

import { useParams } from "next/navigation";
import RiMassEmailCompose from "@/components/RiMassEmailCompose";

export default function Page() {
  const params = useParams();
  const emailId = Number(params.emailId);
  return <RiMassEmailCompose emailId={emailId} />;
}
