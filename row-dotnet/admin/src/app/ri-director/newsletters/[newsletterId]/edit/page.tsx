"use client";
import { useParams } from "next/navigation";
import RiNewsletterForm from "@/components/RiNewsletterForm";
export default function Page() {
  const params = useParams();
  return <RiNewsletterForm newsletterId={Number(params.newsletterId)} />;
}
