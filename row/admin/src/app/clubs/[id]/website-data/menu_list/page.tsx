"use client";

import "react-quill-new/dist/quill.snow.css";
import { ClubMenu, ClubSubMenu } from "@/types/menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SuccessAlert from "@/components/SuccessAlert";
import ErrorAlert from "@/components/ErrorAlert";
import AlertModal from "@/components/AlertModal";
import { Plus, AlertTriangle, List } from "@/components/icons";
import ProtectedRoute from "@/components/ProtectedRoute";
import { PageHeader, ListPageSkeleton } from "@/components/row/AppKit";
import { useMenuList } from "./useMenuList";
import MenuListTable from "./MenuListTable";
import MenuItemDialog from "./MenuItemDialog";

export default function MenuListPage() {
  const h = useMenuList();
  const { clubName, clubId, canManage, openAddMenuDialog, addMenuDisabled, loading, menus, customMenuCount, deleteTarget, setDeleteTarget, handleDelete, successMessage, setSuccessMessage, errorMessage, setErrorMessage } = h;
  const v = h;

  return (
    <ProtectedRoute>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          title={clubName ? `${clubName} - Menu List` : "Menu List"}
          description="Manage website navigation menus"
          back={`/clubs/${clubId}/website-data`}
          actions={canManage && (
            <Button
              onClick={openAddMenuDialog}
              disabled={addMenuDisabled}
              title={addMenuDisabled ? "Only 1 custom menu is allowed (in addition to the 8 default menus). Edit or delete the existing custom menu first." : undefined}
            >
              <Plus className="mr-2 h-4 w-4" />Add Custom Menu
            </Button>
          )}
        />

        {loading && (
          <div className="flex items-center justify-center py-20">
            <ListPageSkeleton />
          </div>
        )}

        {/* Menu count badges — 8 defaults are auto-created; 1 optional custom = 9 max. */}
        {!loading && (
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{menus.filter((m) => m.isActive).length}/9 Active</Badge>
            <Badge variant="outline">{menus.filter((m) => m.isDefault).length} Default</Badge>
            <Badge variant={addMenuDisabled ? "default" : "outline"}>{customMenuCount}/1 Custom</Badge>
          </div>
        )}

        {/* Empty state */}
        {!loading && menus.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <List className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="row-h2">No menus yet</h3>
            <p className="text-muted-foreground mt-2">
              {canManage ? 'Click "Add Menu" to create your first navigation menu.' : "No menus have been added yet."}
            </p>
          </div>
        )}

        {/* Menus list */}
        <MenuListTable v={v} />

        {/* Add/Edit Dialog */}
        <MenuItemDialog v={v} />

        {/* Delete confirmation */}
        <AlertModal
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
          icon={AlertTriangle}
          iconClassName="text-destructive"
          title={deleteTarget?.type === "menu" ? "Delete Menu" : "Delete Sub-Menu"}
          description={
            deleteTarget?.type === "menu" ? (
              <>
                Are you sure you want to delete <span className="font-semibold text-foreground">{(deleteTarget?.item as ClubMenu)?.menuName}</span>?
                {(deleteTarget?.item as ClubMenu)?.subMenuCount > 0 && (
                  <> This will also delete <span className="font-semibold">{(deleteTarget.item as ClubMenu).subMenuCount}</span> sub-menu(s).</>
                )}
                {" "}This action cannot be undone.
              </>
            ) : (
              <>
                Are you sure you want to delete <span className="font-semibold text-foreground">{(deleteTarget?.item as ClubSubMenu)?.subMenuName}</span>? This action cannot be undone.
              </>
            )
          }
          confirmLabel="Delete"
          confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onConfirm={handleDelete}
          cancelLabel="Cancel"
          onCancel={() => setDeleteTarget(null)}
        />

        <SuccessAlert open={!!successMessage} title="Success" description={successMessage || ""} onOk={() => setSuccessMessage(null)} />
        <ErrorAlert open={!!errorMessage} title="Error" description={errorMessage || ""} onOk={() => setErrorMessage(null)} />
      </div>
    </ProtectedRoute>
  );
}
