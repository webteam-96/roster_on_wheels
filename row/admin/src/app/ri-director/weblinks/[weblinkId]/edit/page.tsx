"use client";
import { useParams } from "next/navigation";
import RiWeblinkForm from "@/components/RiWeblinkForm";
export default function Page() {
  const params = useParams();
  return <RiWeblinkForm weblinkId={Number(params.weblinkId)} />;
}
