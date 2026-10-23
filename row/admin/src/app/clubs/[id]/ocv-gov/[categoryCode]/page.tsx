"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import DateField from "@/components/DateField";
import { useParams, useSearchParams } from "next/navigation";
import {
  getOcvCategories,
  getOcvDocumentTypes,
  getOcvDocuments,
  uploadOcvDocument,
  updateOcvDocument,
  deleteOcvDocument,
  downloadOcvDocumentBlob,
} from "@/services/api";
import { OcvCategory, OcvDocumentType, OcvDocumentListItem } from "@/types/ocvGov";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Upload, Pencil, Trash2, Download, Eye } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import ErrorAlert from "@/components/ErrorAlert";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";

import { appLocale } from "@/lib/appFormat";
import { formatMoney } from "@/lib/currency";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

export default function OcvCategoryPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const clubId = Number(params.id);
  const categoryCode = params.categoryCode as string;
  const yearId = Number(searchParams.get("yearId"));

  const [category, setCategory] = useState<OcvCategory | null>(null);
  const [docTypes, setDocTypes] = useState<OcvDocumentType[]>([]);
  const [documents, setDocuments] = useState<OcvDocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Upload form state
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [customTypeName, setCustomTypeName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<OcvDocumentListItem | null>(null);
  const [editTypeId, setEditTypeId] = useState<string>("");
  const [editCustomTypeName, setEditCustomTypeName] = useState("");
  const [editFile, setEditFile] = useState<File | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editPaidOn, setEditPaidOn] = useState("");
  const [saving, setSaving] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingDoc, setDeletingDoc] = useState<OcvDocumentListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isDuesCategory = categoryCode === "dues";
  const [searchQuery, setSearchQuery] = useState("");

  const fetchDocuments = useCallback(async (catId: number) => {
    try {
      const docs = await getOcvDocuments(clubId, catId, yearId);
      setDocuments(docs);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setErrorMessage(
        respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to load documents.")
      );
    }
  }, [clubId, yearId]);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const categories = await getOcvCategories(clubId);
        const cat = categories.find((c) => c.categoryCode === categoryCode);
        if (!cat) {
          setErrorMessage("Category not found.");
          setLoading(false);
          return;
        }
        setCategory(cat);

        const [types] = await Promise.all([
          getOcvDocumentTypes(clubId, cat.id),
          fetchDocuments(cat.id),
        ]);
        setDocTypes(types);
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const respData = (err as any)?.response?.data;
        setErrorMessage(
          respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to load data.")
        );
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [clubId, categoryCode, yearId, fetchDocuments]);

  const getSelectedDocType = (typeId: string): OcvDocumentType | undefined => {
    return docTypes.find((t) => t.id === Number(typeId));
  };

  const isOthersType = (typeId: string): boolean => {
    const docType = getSelectedDocType(typeId);
    return docType?.typeName.toLowerCase() === "others";
  };

  const hasExistingUpload = (typeId: number): boolean => {
    return documents.some((d) => d.typeId === typeId);
  };

  const handleUpload = async () => {
    if (!selectedTypeId || !selectedFile || !category) {
      setErrorMessage("Please select a document type and choose a file.");
      return;
    }

    const docType = getSelectedDocType(selectedTypeId);
    if (docType && !docType.allowMultiple && hasExistingUpload(docType.id)) {
      setErrorMessage("This document type already has an upload. Please edit or delete the existing one.");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("typeId", selectedTypeId);
      formData.append("categoryId", category.id.toString());
      formData.append("yearId", yearId.toString());
      if (isOthersType(selectedTypeId) && customTypeName.trim()) {
        formData.append("customTypeName", customTypeName.trim());
      }
      if (isDuesCategory && amount) {
        formData.append("amount", amount);
      }
      if (isDuesCategory && paidOn) {
        formData.append("paidOn", paidOn);
      }

      await uploadOcvDocument(clubId, formData);
      await fetchDocuments(category.id);

      // Reset form
      setSelectedTypeId("");
      setCustomTypeName("");
      setSelectedFile(null);
      setAmount("");
      setPaidOn("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setErrorMessage(
        respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to upload document.")
      );
    } finally {
      setUploading(false);
    }
  };

  const handleEditOpen = (doc: OcvDocumentListItem) => {
    setEditingDoc(doc);
    setEditTypeId(doc.typeId.toString());
    setEditCustomTypeName(doc.customTypeName || "");
    setEditFile(null);
    setEditAmount(doc.amount?.toString() || "");
    setEditPaidOn(doc.paidOn ? doc.paidOn.split("T")[0] : "");
    setEditDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!editingDoc || !category) return;

    setSaving(true);
    try {
      const formData = new FormData();
      if (editFile) {
        formData.append("file", editFile);
      }
      formData.append("typeId", editTypeId);
      if (isOthersType(editTypeId) && editCustomTypeName.trim()) {
        formData.append("customTypeName", editCustomTypeName.trim());
      }
      if (isDuesCategory && editAmount) {
        formData.append("amount", editAmount);
      }
      if (isDuesCategory && editPaidOn) {
        formData.append("paidOn", editPaidOn);
      }

      await updateOcvDocument(clubId, editingDoc.id, formData);
      await fetchDocuments(category.id);
      setEditDialogOpen(false);
      setEditingDoc(null);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setErrorMessage(
        respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to update document.")
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingDoc || !category) return;

    setDeleting(true);
    try {
      await deleteOcvDocument(clubId, deletingDoc.id);
      await fetchDocuments(category.id);
      setDeleteDialogOpen(false);
      setDeletingDoc(null);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const respData = (err as any)?.response?.data;
      setErrorMessage(
        respData?.message || respData?.detail || respData?.title || (err instanceof Error ? err.message : "Failed to delete document.")
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleView = (filePath: string) => {
    window.open(`${API_BASE_URL}${filePath}`, "_blank");
  };

  const handleDownload = async (documentId: number, filePath: string, originalFileName: string) => {
    // Calls a controller endpoint that streams the file with Content-Disposition: attachment.
    // The api instance carries the JWT auth header; controller is covered by app.UseCors().
    // Browser saves to Downloads folder via createObjectURL + <a download>.
    try {
      const blob = await downloadOcvDocumentBlob(clubId, documentId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = originalFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in new tab — never replaces the current page.
      window.open(`${API_BASE_URL}${filePath}`, "_blank", "noopener,noreferrer");
    }
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(appLocale(), {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/clubs/${clubId}/ocv-gov`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">
              {category?.categoryName || "Loading..."}
            </h2>
            <p className="text-muted-foreground text-base">
              Upload and manage documents
            </p>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <RotaryLoader size="lg" />
          </div>
        )}

        {/* Upload Section */}
        {!loading && category && (
          <Card>
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">Upload Document</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                {/* Document Type */}
                <div className="space-y-2">
                  <Label htmlFor="docType">Document Type</Label>
                  <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
                    <SelectTrigger id="docType">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {docTypes
                        .filter((t) => t.isActive)
                        .map((t) => (
                          <SelectItem key={t.id} value={t.id.toString()}>
                            {t.typeName}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Custom Type Name (for Others) */}
                {selectedTypeId && isOthersType(selectedTypeId) && (
                  <div className="space-y-2">
                    <Label htmlFor="customTypeName">Document Name</Label>
                    <Input
                      id="customTypeName"
                      type="text"
                      placeholder="Enter document name"
                      value={customTypeName}
                      onChange={(e) => setCustomTypeName(e.target.value)}
                    />
                  </div>
                )}

                {/* File Input */}
                <div className="space-y-2">
                  <Label htmlFor="file">Choose File</Label>
                  <Input
                    id="file"
                    type="file"
                    ref={fileInputRef}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, GIF</p>
                </div>

                {/* Dues: Amount */}
                {isDuesCategory && (
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount</Label>
                    <Input
                      id="amount"
                      type="number"
                      step="0.01"
                      placeholder="Enter amount"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                )}

                {/* Dues: Paid On */}
                {isDuesCategory && (
                  <div className="space-y-2">
                    <Label htmlFor="paidOn">Paid On</Label>
                    <DateField id="paidOn" value={paidOn} onChange={setPaidOn} />
                  </div>
                )}

                {/* Upload Button */}
                <div>
                  <Button
                    onClick={handleUpload}
                    disabled={uploading || !selectedTypeId || !selectedFile}
                    className="w-full"
                  >
                    {uploading ? (
                      <RotaryLoader size="sm" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {uploading ? "Uploading..." : "Upload"}
                  </Button>
                </div>
              </div>

              {/* Warning for non-multiple types */}
              {selectedTypeId && (() => {
                const docType = getSelectedDocType(selectedTypeId);
                if (docType && !docType.allowMultiple && hasExistingUpload(docType.id)) {
                  return (
                    <p className="mt-3 text-sm text-amber-600 font-medium">
                      This document type already has an upload. Please edit or delete the existing one.
                    </p>
                  );
                }
                return null;
              })()}
            </CardContent>
          </Card>
        )}

        {/* Documents Table */}
        {!loading && category && documents.length > 0 && (
          <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Filter documents..." />
        )}

        {!loading && category && (() => {
          const q = searchQuery.toLowerCase();
          const filteredDocs = q
            ? documents.filter((doc) =>
                [doc.typeName, doc.customTypeName, doc.originalFileName, doc.amount != null ? String(doc.amount) : null]
                  .some((val) => val && String(val).toLowerCase().includes(q))
              )
            : documents;
          return (
          <Card>
            <CardContent className="p-0">
              {documents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold">No documents uploaded</h3>
                  <p className="text-muted-foreground mt-2">
                    Upload your first document using the form above.
                  </p>
                </div>
              ) : filteredDocs.length === 0 && searchQuery ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold">No results found</h3>
                  <p className="text-muted-foreground mt-2">No documents match your filter. Try a different term.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-primary hover:bg-primary">
                      <TableHead className="w-12 text-primary-foreground text-base font-semibold">
                        S.No
                      </TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">
                        Doc Type
                      </TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">
                        File Name
                      </TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold">
                        Size
                      </TableHead>
                      {isDuesCategory && (
                        <>
                          <TableHead className="text-primary-foreground text-base font-semibold">
                            Amount
                          </TableHead>
                          <TableHead className="text-primary-foreground text-base font-semibold">
                            Paid On
                          </TableHead>
                        </>
                      )}
                      <TableHead className="text-primary-foreground text-base font-semibold">
                        Date & Time
                      </TableHead>
                      <TableHead className="text-primary-foreground text-base font-semibold text-center">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocs.map((doc, index) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium">{index + 1}</TableCell>
                        <TableCell>
                          {doc.customTypeName ? `${doc.typeName} - ${doc.customTypeName}` : doc.typeName}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={doc.originalFileName}>
                          {doc.originalFileName}
                        </TableCell>
                        <TableCell>{formatFileSize(doc.fileSize)}</TableCell>
                        {isDuesCategory && (
                          <>
                            <TableCell>
                              {doc.amount != null ? formatMoney(doc.amount) : "-"}
                            </TableCell>
                            <TableCell>
                              {doc.paidOn
                                ? new Date(doc.paidOn).toLocaleDateString(appLocale(), {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  })
                                : "-"}
                            </TableCell>
                          </>
                        )}
                        <TableCell>{formatDateTime(doc.createdDate)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleView(doc.filePath)}
                              title="View"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDownload(doc.id, doc.filePath, doc.originalFileName)}
                              title="Download"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditOpen(doc)}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setDeletingDoc(doc);
                                setDeleteDialogOpen(true);
                              }}
                              title="Delete"
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          );
        })()}

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Document</DialogTitle>
              <DialogDescription>
                Update the document details. Optionally re-upload the file.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="editDocType">Document Type</Label>
                <Select value={editTypeId} onValueChange={setEditTypeId}>
                  <SelectTrigger id="editDocType">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {docTypes
                      .filter((t) => t.isActive)
                      .map((t) => (
                        <SelectItem key={t.id} value={t.id.toString()}>
                          {t.typeName}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Custom Type Name (for Others) in Edit */}
              {editTypeId && isOthersType(editTypeId) && (
                <div className="space-y-2">
                  <Label htmlFor="editCustomTypeName">Document Name</Label>
                  <Input
                    id="editCustomTypeName"
                    type="text"
                    placeholder="Enter document name"
                    value={editCustomTypeName}
                    onChange={(e) => setEditCustomTypeName(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="editFile">Replace File (optional)</Label>
                <Input
                  id="editFile"
                  type="file"
                  ref={editFileInputRef}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif"
                  onChange={(e) => setEditFile(e.target.files?.[0] || null)}
                />
                <p className="text-xs text-muted-foreground mt-1.5">Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, PNG, GIF</p>
                {editingDoc && (
                  <p className="text-xs text-muted-foreground">
                    Current file: {editingDoc.originalFileName}
                  </p>
                )}
              </div>

              {isDuesCategory && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="editAmount">Amount</Label>
                    <Input
                      id="editAmount"
                      type="number"
                      step="0.01"
                      placeholder="Enter amount"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editPaidOn">Paid On</Label>
                    <DateField id="editPaidOn" value={editPaidOn} onChange={setEditPaidOn} />
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleEditSave} disabled={saving}>
                {saving ? <RotaryLoader size="sm" /> : null}
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Document</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{deletingDoc?.originalFileName}&quot;? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? <RotaryLoader size="sm" /> : null}
                {deleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <ErrorAlert
          open={!!errorMessage}
          title="Error"
          description={errorMessage || ""}
          onOk={() => setErrorMessage(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
