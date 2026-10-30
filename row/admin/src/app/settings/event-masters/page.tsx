"use client";

import { useState, useCallback, useEffect } from "react";
import {
  getEventTshirtSizes, createEventTshirtSize, updateEventTshirtSize, deleteEventTshirtSize,
  getEventFoodPreferences, createEventFoodPreference, updateEventFoodPreference, deleteEventFoodPreference,
} from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { ArrowLeft, Plus, Pencil, Trash2, MoreHorizontal, AlertTriangle } from "@/components/icons";
import RotaryLoader from "@/components/RotaryLoader";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import SearchBox from "@/components/SearchBox";
import { ListPageSkeleton } from "@/components/row/AppKit";

interface MasterItem {
  id: number;
  sizeName?: string;
  foodType?: string;
  sortOrder: number;
  isActive: boolean;
}

export default function EventMastersPage() {
  const { isSuperAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("tshirt");

  // T-shirt state
  const [tshirtItems, setTshirtItems] = useState<MasterItem[]>([]);
  const [tshirtLoading, setTshirtLoading] = useState(true);
  const [tshirtSearch, setTshirtSearch] = useState("");

  // Food state
  const [foodItems, setFoodItems] = useState<MasterItem[]>([]);
  const [foodLoading, setFoodLoading] = useState(true);
  const [foodSearch, setFoodSearch] = useState("");

  // Common
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MasterItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formSort, setFormSort] = useState(0);
  const [formSaving, setFormSaving] = useState(false);
  const [deleteItem, setDeleteItem] = useState<MasterItem | null>(null);

  const fetchTshirts = useCallback(async () => {
    try {
      setTshirtLoading(true);
      const data = await getEventTshirtSizes();
      setTshirtItems(data);
    } catch { setErrorMessage("Failed to load t-shirt sizes"); }
    finally { setTshirtLoading(false); }
  }, []);

  const fetchFoods = useCallback(async () => {
    try {
      setFoodLoading(true);
      const data = await getEventFoodPreferences();
      setFoodItems(data);
    } catch { setErrorMessage("Failed to load food preferences"); }
    finally { setFoodLoading(false); }
  }, []);

  useEffect(() => { fetchTshirts(); fetchFoods(); }, [fetchTshirts, fetchFoods]);

  const openAdd = () => {
    setEditingItem(null);
    setFormName("");
    setFormSort(0);
    setFormOpen(true);
  };

  const openEdit = (item: MasterItem) => {
    setEditingItem(item);
    setFormName(item.sizeName || item.foodType || "");
    setFormSort(item.sortOrder);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    setFormSaving(true);
    try {
      if (activeTab === "tshirt") {
        if (editingItem) {
          await updateEventTshirtSize(editingItem.id, { sizeName: formName, sortOrder: formSort });
          setSuccessMessage("T-shirt size updated.");
        } else {
          await createEventTshirtSize({ sizeName: formName, sortOrder: formSort });
          setSuccessMessage("T-shirt size created.");
        }
        fetchTshirts();
      } else {
        if (editingItem) {
          await updateEventFoodPreference(editingItem.id, { foodType: formName, sortOrder: formSort });
          setSuccessMessage("Food preference updated.");
        } else {
          await createEventFoodPreference({ foodType: formName, sortOrder: formSort });
          setSuccessMessage("Food preference created.");
        }
        fetchFoods();
      }
      setFormOpen(false);
    } catch { setErrorMessage("Failed to save."); }
    finally { setFormSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    try {
      if (activeTab === "tshirt") {
        await deleteEventTshirtSize(deleteItem.id);
        setSuccessMessage("T-shirt size deleted.");
        fetchTshirts();
      } else {
        await deleteEventFoodPreference(deleteItem.id);
        setSuccessMessage("Food preference deleted.");
        fetchFoods();
      }
    } catch { setErrorMessage("Failed to delete."); }
    setDeleteItem(null);
  };

  const renderTable = (items: MasterItem[], search: string, loading: boolean, nameKey: "sizeName" | "foodType") => {
    const filtered = items.filter(i => {
      const name = (i[nameKey] || "").toLowerCase();
      return name.includes(search.toLowerCase());
    });

    if (loading) return <div className="flex justify-center py-10"><ListPageSkeleton /></div>;

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Sort Order</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[60px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No items found</TableCell></TableRow>
          ) : filtered.map(item => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item[nameKey]}</TableCell>
              <TableCell>{item.sortOrder}</TableCell>
              <TableCell><Badge variant={item.isActive ? "default" : "secondary"}>{item.isActive ? "Active" : "Inactive"}</Badge></TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(item)}><Pencil className="h-4 w-4 mr-2" />Edit</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteItem(item)} className="text-destructive"><Trash2 className="h-4 w-4 mr-2" />Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  if (!isSuperAdmin) {
    return (<ProtectedRoute><div className="flex flex-col items-center justify-center py-20"><h3 className="text-lg font-semibold">Access Denied</h3><p className="text-muted-foreground mt-2">Only SuperAdmin can access this page.</p></div></ProtectedRoute>);
  }

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />

        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" asChild>
            <Link href="/settings/payments-and-dues"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Event Masters</h2>
            <p className="text-muted-foreground text-base">Manage t-shirt sizes and food preferences</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="tshirt">T-shirt Sizes</TabsTrigger>
              <TabsTrigger value="food">Food Preferences</TabsTrigger>
            </TabsList>
            <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add {activeTab === "tshirt" ? "Size" : "Food"}</Button>
          </div>

          <TabsContent value="tshirt" className="space-y-4">
            <SearchBox value={tshirtSearch} onChange={setTshirtSearch} placeholder="Search t-shirt sizes..." />
            {renderTable(tshirtItems, tshirtSearch, tshirtLoading, "sizeName")}
          </TabsContent>

          <TabsContent value="food" className="space-y-4">
            <SearchBox value={foodSearch} onChange={setFoodSearch} placeholder="Search food preferences..." />
            {renderTable(foodItems, foodSearch, foodLoading, "foodType")}
          </TabsContent>
        </Tabs>

        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingItem ? "Edit" : "Add"} {activeTab === "tshirt" ? "T-shirt Size" : "Food Preference"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>{activeTab === "tshirt" ? "Size Name" : "Food Type"}</Label>
                <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder={activeTab === "tshirt" ? "e.g. XL" : "e.g. Vegetarian"} />
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input type="number" value={formSort} onChange={e => setFormSort(Number(e.target.value))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={formSaving || !formName.trim()}>{formSaving ? "Saving..." : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertModal
          open={!!deleteItem}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title="Delete Item"
          description={`Are you sure you want to delete "${deleteItem?.sizeName || deleteItem?.foodType}"?`}
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteItem(null)}
        />
      </div>
    </ProtectedRoute>
  );
}
