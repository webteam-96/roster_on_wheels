"use client";
import { useParams } from "next/navigation";
import RiDocumentForm from "@/components/RiDocumentForm";
export default function Page() {
  const params = useParams();
  return <RiDocumentForm documentId={Number(params.documentId)} />;
}
