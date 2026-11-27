import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Plus, Trash2, AlertTriangle, Globe, Settings as SettingsIcon, RotateCw, Server, Loader2, Wrench, ChevronDown } from "@/components/icons";
import { PageHeader } from "@/components/row/AppKit";
import type { ClubWebsitesCtx } from "./useClubWebsites";

export default function ClubWebsitesHeader({ v }: { v: ClubWebsitesCtx }) {
  const { hasPlesk, recyclingPools, doTestPlesk, doListPleskSubdomains, runDiag, doRecycleAllPools, doForceCleanPlesk, openSettings, openAdd } = v;
  return (
        <PageHeader
          back="/settings"
          title="Club Websites"
          description="Subscriptions, templates and renewals."
          actions={
            <>
              {hasPlesk && <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" title="Advanced Plesk and IIS tools">
                    {recyclingPools ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}
                    Tools<ChevronDown className="ml-2 h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={doTestPlesk}>
                    <Server className="mr-2 h-4 w-4" />Test Connection
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={doListPleskSubdomains}>
                    <Globe className="mr-2 h-4 w-4" />List All Subdomains
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => runDiag("list-subdomains")}>
                    <AlertTriangle className="mr-2 h-4 w-4" />Raw XML Diagnostic
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={doRecycleAllPools}
                    disabled={recyclingPools}
                    title="Recycle every IIS app pool whose name contains the parent domain. Use AFTER a code deploy so all pools pick up the new build in one shot. Theme/banner/project changes auto-refresh. Don't need this."
                  >
                    <RotateCw className="mr-2 h-4 w-4" />{recyclingPools ? "Recycling all pools…" : "Recycle All Pools"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={doForceCleanPlesk} className="text-red-600 focus:text-red-700">
                    <Trash2 className="mr-2 h-4 w-4" />Force Clean Subdomain
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>}
              <Button variant="outline" onClick={openSettings}>
                <SettingsIcon className="mr-2 h-4 w-4" />Settings
              </Button>
              <Button onClick={openAdd}>
                <Plus className="mr-2 h-4 w-4" />Add Website
              </Button>
            </>
          }
        />
  );
}
