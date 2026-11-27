import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import RotaryLoader from "@/components/RotaryLoader";
import type { ClubDuesFormCtx } from "./useClubDuesForm";

export default function ClubsStep({ v }: { v: ClubDuesFormCtx }) {
  const { independent, selectedOnlineVendors, clubsList, clubOnlineBalanced, selectedOfflineVendors, clubOfflineBalanced, clubsLoading, isOffline, cur, routeAccounts, amountType, isOnline, clubOfflineOverrides, offlineRate, setClubOfflineOverrides, clubOfflineSplits, updateClubOfflineSplit, clubOfflineBalance, clubOnlineOverrides, onlineRate, setClubOnlineOverrides, clubOnlineSplits, updateClubOnlineSplit, clubOnlineBalance, selectedVendors, rate, clubBalanced, clubOverrides, setClubOverrides, clubSplits, updateClubSplit, clubBalance } = v;

  // ── Step 3: Club List ───────────────────────────────────────
  const renderClubs = () => (independent ? renderClubsIndependent() : renderClubsLegacy());

  const renderClubsIndependent = () => (
    <Card>
      <CardHeader><CardTitle>Club List: per-club rate &amp; split</CardTitle></CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Every club in the district (synced &amp; non-synced) is included, defaulting to the campaign&apos;s Online/Offline rates and splits. Change any club to override just that one. You can also edit this later on the Clubs page.
        </p>
        {((selectedOnlineVendors.length > 0 && clubsList.some((c) => !clubOnlineBalanced(c))) ||
          (selectedOfflineVendors.length > 0 && clubsList.some((c) => !clubOfflineBalanced(c)))) && (
          <p className="mb-3 text-sm rounded bg-red-50 text-red-700 border border-red-200 p-2">
            Some clubs&apos; splits don&apos;t balance (Balance ≠ 0). Fix the red rows: every Balance must be <b>0</b> before you can continue.
          </p>
        )}
        {clubsLoading ? (
          <div className="flex justify-center py-10"><RotaryLoader size="md" /></div>
        ) : (
          <Card className="[&>div]:max-h-[440px]">
            <Table className="w-full text-sm">
              <TableHeader className="text-left sticky top-0">
                <TableRow>
                  <TableHead className="p-2">Club</TableHead>
                  <TableHead className="p-2 text-center">Members</TableHead>
                  {isOffline && <TableHead className="p-2 w-24">Offline Rate ({cur})</TableHead>}
                  {isOffline && selectedOfflineVendors.map((sv, idx) => {
                    const acc = routeAccounts.find((x) => String(x.id) === sv.routeAccountId);
                    return <TableHead key={`off-${sv.routeAccountId}`} className="p-2 w-24 whitespace-nowrap">Off: {acc?.name || `A/C${idx + 1}`}<span className="text-muted-foreground font-normal"> ({amountType === "2" ? "%" : cur})</span></TableHead>;
                  })}
                  {isOffline && selectedOfflineVendors.length > 0 && <TableHead className="p-2 w-24 text-right">Off. Balance</TableHead>}
                  {isOnline && <TableHead className="p-2 w-24">Online Rate ({cur})</TableHead>}
                  {isOnline && selectedOnlineVendors.map((sv, idx) => {
                    const acc = routeAccounts.find((x) => String(x.id) === sv.routeAccountId);
                    return <TableHead key={`on-${sv.routeAccountId}`} className="p-2 w-24 whitespace-nowrap">On: {acc?.name || `A/C${idx + 1}`}<span className="text-muted-foreground font-normal"> ({amountType === "2" ? "%" : cur})</span></TableHead>;
                  })}
                  {isOnline && selectedOnlineVendors.length > 0 && <TableHead className="p-2 w-24 text-right">On. Balance</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {clubsList.map((c) => (
                  <TableRow key={c.id} className="border-t">
                    <TableCell className="p-2">{c.clubName}{!c.isSyncedFromRotaryOrg && <span className="ml-2 text-xs rounded bg-amber-100 text-amber-700 px-1.5 py-0.5">non-sync</span>}</TableCell>
                    <TableCell className="p-2 text-center">{c.totalMembers}</TableCell>
                    {isOffline && <TableCell className="p-2"><Input type="number" className="row-field-sm" value={clubOfflineOverrides[c.id] ?? offlineRate} onChange={(e) => setClubOfflineOverrides((p) => ({ ...p, [c.id]: e.target.value }))} /></TableCell>}
                    {isOffline && selectedOfflineVendors.map((sv) => (
                      <TableCell key={`off-${sv.routeAccountId}`} className="p-2">
                        <Input type="number" className={`h-8 ${!clubOfflineBalanced(c) ? "border-red-400" : ""}`} value={clubOfflineSplits[c.id]?.[sv.routeAccountId] ?? sv.value}
                          onChange={(e) => updateClubOfflineSplit(c.id, sv.routeAccountId, e.target.value)} />
                      </TableCell>
                    ))}
                    {isOffline && selectedOfflineVendors.length > 0 && (
                      <TableCell className={`p-2 text-right font-semibold ${clubOfflineBalanced(c) ? "text-green-600" : "text-red-600"}`}>
                        {amountType === "2" ? `${clubOfflineBalance(c)}%` : `${cur}${clubOfflineBalance(c)}`}
                      </TableCell>
                    )}
                    {isOnline && <TableCell className="p-2"><Input type="number" className="row-field-sm" value={clubOnlineOverrides[c.id] ?? onlineRate} onChange={(e) => setClubOnlineOverrides((p) => ({ ...p, [c.id]: e.target.value }))} /></TableCell>}
                    {isOnline && selectedOnlineVendors.map((sv) => (
                      <TableCell key={`on-${sv.routeAccountId}`} className="p-2">
                        <Input type="number" className={`h-8 ${!clubOnlineBalanced(c) ? "border-red-400" : ""}`} value={clubOnlineSplits[c.id]?.[sv.routeAccountId] ?? sv.value}
                          onChange={(e) => updateClubOnlineSplit(c.id, sv.routeAccountId, e.target.value)} />
                      </TableCell>
                    ))}
                    {isOnline && selectedOnlineVendors.length > 0 && (
                      <TableCell className={`p-2 text-right font-semibold ${clubOnlineBalanced(c) ? "text-green-600" : "text-red-600"}`}>
                        {amountType === "2" ? `${clubOnlineBalance(c)}%` : `${cur}${clubOnlineBalance(c)}`}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {clubsList.length === 0 && <TableRow><TableCell colSpan={10} className="p-6 text-center text-muted-foreground">No clubs in this district.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        )}
      </CardContent>
    </Card>
  );

  const renderClubsLegacy = () => (
    <Card>
      <CardHeader><CardTitle>Club List: per-club rate{selectedVendors.length > 0 ? " & split" : ""}</CardTitle></CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Every club in the district (synced &amp; non-synced) is included, defaulting to {cur}{rate || 0}/member{selectedVendors.length > 0 ? " and the campaign split" : ""}. Change any club to override just that one: the split columns route that club&apos;s payment across the accounts you picked in Payment &amp; Split ({amountType === "2" ? "must total 100%" : `must total the club rate`}). You can also edit this later on the Clubs page.
        </p>
        {selectedVendors.length > 0 && clubsList.some((c) => !clubBalanced(c)) && (
          <p className="mb-3 text-sm rounded bg-red-50 text-red-700 border border-red-200 p-2">
            Some clubs&apos; splits don&apos;t balance (Balance ≠ 0). Fix the red rows: every Balance must be <b>0</b> before you can continue.
          </p>
        )}
        {clubsLoading ? (
          <div className="flex justify-center py-10"><RotaryLoader size="md" /></div>
        ) : (
          <Card className="[&>div]:max-h-[440px]">
            <Table className="w-full text-sm">
              <TableHeader className="text-left sticky top-0">
                <TableRow>
                  <TableHead className="p-2">Club</TableHead>
                  <TableHead className="p-2 text-center">Members</TableHead>
                  <TableHead className="p-2 w-24">Rate ({cur})</TableHead>
                  {selectedVendors.map((sv, idx) => {
                    const acc = routeAccounts.find((x) => String(x.id) === sv.routeAccountId);
                    return <TableHead key={sv.routeAccountId} className="p-2 w-24 whitespace-nowrap">{acc?.name || `A/C${idx + 1}`}<span className="text-muted-foreground font-normal"> ({amountType === "2" ? "%" : cur})</span></TableHead>;
                  })}
                  {selectedVendors.length > 0 && <TableHead className="p-2 w-24 text-right">Balance</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {clubsList.map((c) => (
                  <TableRow key={c.id} className="border-t">
                    <TableCell className="p-2">{c.clubName}{!c.isSyncedFromRotaryOrg && <span className="ml-2 text-xs rounded bg-amber-100 text-amber-700 px-1.5 py-0.5">non-sync</span>}</TableCell>
                    <TableCell className="p-2 text-center">{c.totalMembers}</TableCell>
                    <TableCell className="p-2"><Input type="number" className="row-field-sm" value={clubOverrides[c.id] ?? rate} onChange={(e) => setClubOverrides((p) => ({ ...p, [c.id]: e.target.value }))} /></TableCell>
                    {selectedVendors.map((sv) => (
                      <TableCell key={sv.routeAccountId} className="p-2">
                        <Input type="number" className={`h-8 ${!clubBalanced(c) ? "border-red-400" : ""}`} value={clubSplits[c.id]?.[sv.routeAccountId] ?? sv.value}
                          onChange={(e) => updateClubSplit(c.id, sv.routeAccountId, e.target.value)} />
                      </TableCell>
                    ))}
                    {selectedVendors.length > 0 && (
                      <TableCell className={`p-2 text-right font-semibold ${clubBalanced(c) ? "text-green-600" : "text-red-600"}`}>
                        {amountType === "2" ? `${clubBalance(c)}%` : `${cur}${clubBalance(c)}`}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {clubsList.length === 0 && <TableRow><TableCell colSpan={3 + selectedVendors.length + (selectedVendors.length > 0 ? 1 : 0)} className="p-6 text-center text-muted-foreground">No clubs in this district.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        )}
      </CardContent>
    </Card>
  );

  return renderClubs();
}
