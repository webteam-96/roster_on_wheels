"use client";

import { useParams } from "next/navigation";
import DirectoryConfigForm from "../../_DirectoryConfigForm";

export default function EditDirectoryConfigPage() {
  const params = useParams();
  const id = Number(params?.id);
  if (!id || Number.isNaN(id)) return <div className="p-4">Invalid config id</div>;
  return <DirectoryConfigForm mode="edit" configId={id} />;
}
