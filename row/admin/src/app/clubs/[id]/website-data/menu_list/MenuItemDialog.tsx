import { LINK_TYPES } from "@/types/menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { MenuListCtx } from "./useMenuList";

export default function MenuItemDialog({ v }: { v: MenuListCtx }) {
  const { dialogOpen, handleDialogOpenChange, dialogMode, editingMenu, editingSubMenu, formName, setFormName, formLinkType, setFormLinkType, setFormLinkValue, renderLinkValueInput, formSortOrder, setFormSortOrder, formIsActive, setFormIsActive, saving, handleSave } = v;
  return (
        <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {dialogMode === "menu"
                  ? editingMenu ? "Edit Menu" : "Add Menu"
                  : editingSubMenu ? "Edit Sub-Menu" : "Add Sub-Menu"}
              </DialogTitle>
              <DialogDescription>
                {dialogMode === "menu"
                  ? editingMenu ? "Update the menu details." : "Create a new navigation menu."
                  : editingSubMenu ? "Update the sub-menu details." : "Create a new sub-menu."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Name */}
              <div className="space-y-2">
                <Label>{dialogMode === "menu" ? "Menu Name" : "Sub-Menu Name"} *</Label>
                <Input
                  placeholder={dialogMode === "menu" ? "Enter menu name" : "Enter sub-menu name"}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              {/* Link Type */}
              <div className="space-y-2">
                <Label>Link Type *</Label>
                <Select value={formLinkType} onValueChange={(val) => { setFormLinkType(val); setFormLinkValue(""); }}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select link type" />
                  </SelectTrigger>
                  <SelectContent>
                    {LINK_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Link Value - dynamic */}
              {renderLinkValueInput()}

              {/* Sort Order */}
              <div className="space-y-2">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  min={1}
                  value={formSortOrder}
                  onChange={(e) => setFormSortOrder(Number(e.target.value))}
                />
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={formIsActive} onValueChange={setFormIsActive}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Active</SelectItem>
                    <SelectItem value="0">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleDialogOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving || !formName.trim()}>
                {saving ? "Saving..." : (editingMenu || editingSubMenu) ? "Update" : "Add"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
  );
}
