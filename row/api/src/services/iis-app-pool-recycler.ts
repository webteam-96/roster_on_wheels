import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { AppConfig } from "../config/app-config";

export interface RecycleAllResult {
  totalPools: number;
  recycled: number;
  failed: number;
  recycledPools: string[];
  failedPools: string[];
  durationMs: number;
  error: string | null;
  /** appcmd itself was refused: the API's app-pool identity lacks rights. */
  permissionDenied: boolean;
}

const APPCMD = ["C:\\Windows\\System32\\inetsrv\\appcmd.exe", "C:\\Windows\\Sysnative\\inetsrv\\appcmd.exe"];

/**
 * Port of IisAppPoolRecycler.cs: recycles every IIS app pool whose name
 * contains the club-website parent domain (after a club-website deploy),
 * via the built-in appcmd.exe. The API's pool identity needs rights to run it.
 */
@Injectable()
export class IisAppPoolRecycler {
  private readonly log = new Logger("IisAppPoolRecycler");

  constructor(private readonly config: AppConfig) {}

  private run(file: string, args: string[]): Promise<string> {
    return new Promise((resolve) => {
      execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve(`${stdout ?? ""}\n${stderr ?? ""}${err && !stdout && !stderr ? err.message : ""}`.trim());
      });
    });
  }

  async recycleAllClubWebsitePools(): Promise<RecycleAllResult> {
    const started = Date.now();
    const result: RecycleAllResult = { totalPools: 0, recycled: 0, failed: 0, recycledPools: [], failedPools: [], durationMs: 0, error: null, permissionDenied: false };
    const parent = (this.config.get("PleskSettings:ParentDomain") ?? "").toLowerCase();
    const appcmd = APPCMD.find((p) => existsSync(p));
    if (!appcmd) {
      result.error = "appcmd.exe not found. IIS may not be installed on this server.";
      result.durationMs = Date.now() - started;
      return result;
    }
    if (!parent) {
      result.error = "PleskSettings:ParentDomain is not configured.";
      result.durationMs = Date.now() - started;
      return result;
    }
    try {
      const listing = await this.run(appcmd, ["list", "apppool"]);
      const pools = [...listing.matchAll(/^APPPOOL "([^"]+)"/gm)].map((m) => m[1]).filter((p) => p.toLowerCase().includes(parent));
      result.totalPools = pools.length;
      this.log.log(`Recycle-all: found ${pools.length} club website pools matching '${parent}'`);
      for (const pool of pools) {
        if (/["\r\n]/.test(pool) || pool.length > 250) {
          result.failed++;
          result.failedPools.push(`${pool}: Invalid pool name (suspicious characters).`);
          continue;
        }
        const out = await this.run(appcmd, ["recycle", "apppool", `/apppool.name:${pool}`]);
        if (/recycled/i.test(out)) {
          result.recycled++;
          result.recycledPools.push(pool);
        } else {
          result.failed++;
          result.failedPools.push(`${pool}: ${out.length > 200 ? out.slice(0, 200) + "..." : out}`);
          if (/access is denied|not authorized/i.test(out)) result.permissionDenied = true;
        }
      }
    } catch (e) {
      this.log.error(`Recycle-all failed: ${(e as Error).message}`);
      result.error = (e as Error).message;
      if (/access is denied/i.test(result.error)) result.permissionDenied = true;
    }
    result.durationMs = Date.now() - started;
    return result;
  }
}
