import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Pencil } from "@/components/icons";
import { currencySymbol } from "@/lib/appFormat";
import type { PaymentLinkFormCtx } from "./usePaymentLinkForm";

export default function RegistrationsStep({ v }: { v: PaymentLinkFormCtx }) {
  const { regName, setRegName, regAmount, setRegAmount, handleAddReg, editingRegTempId, setEditingRegTempId, registrations, amountType, handleEditReg, handleDeleteReg } = v;

  const renderStepRegistrations = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Registration Types</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Label>Registration Name</Label>
            <Input value={regName} onChange={e => setRegName(e.target.value)} placeholder="e.g. Individual" />
          </div>
          <div className="w-40">
            <Label>Amount</Label>
            <Input type="number" value={regAmount} onChange={e => setRegAmount(e.target.value)} placeholder="1000" />
          </div>
          <Button onClick={handleAddReg} disabled={!regName.trim()}>
            <Plus className="h-4 w-4 mr-1" />{editingRegTempId !== null ? "Update" : "Add"}
          </Button>
          {editingRegTempId !== null && (
            <Button variant="outline" onClick={() => { setEditingRegTempId(null); setRegName(""); setRegAmount(""); }}>Cancel</Button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {registrations.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No registration types yet. Add at least one to proceed.</TableCell></TableRow>
            ) : registrations.map(reg => (
              <TableRow key={reg.tempId}>
                <TableCell>{reg.registrationName}</TableCell>
                <TableCell>{amountType === "1" ? `${currencySymbol()}${reg.amount.toFixed(2)}` : `${reg.amount}%`}</TableCell>
                <TableCell className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEditReg(reg)}><Pencil className="h-4 w-4 text-blue-600" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDeleteReg(reg.tempId)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return renderStepRegistrations();
}
