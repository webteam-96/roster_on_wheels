import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";

/**
 * Port of ASP.NET's IConfiguration, so ported code reads exactly the keys the
 * .NET code reads ("JwtSettings:Secret", "Razorpay:GstPercent", ...).
 *
 * Sources, later ones winning (same order as WebApplication.CreateBuilder):
 *   1. config/appsettings.json
 *   2. config/appsettings.{APP_ENVIRONMENT}.json   (APP_ENVIRONMENT, else ASPNETCORE_ENVIRONMENT, else "Production")
 *   3. the file named by BRAND_FILE, if set        (master plan WS1-11: brand.ROW.json)
 *   4. environment variables, "__" standing for ":" (JwtSettings__Secret)
 *
 * Keys are case-insensitive, as in .NET. Secrets belong in environment
 * variables only, never in the JSON files.
 */
@Injectable()
export class AppConfig {
  private readonly values = new Map<string, string>();
  readonly environment: string;

  constructor(root = process.cwd(), env: NodeJS.ProcessEnv = process.env) {
    this.environment = env.APP_ENVIRONMENT || env.ASPNETCORE_ENVIRONMENT || "Production";
    const dir = join(root, "config");
    this.loadJson(join(dir, "appsettings.json"));
    this.loadJson(join(dir, `appsettings.${this.environment}.json`));
    if (env.BRAND_FILE) this.loadJson(join(dir, env.BRAND_FILE));
    for (const [name, value] of Object.entries(env)) {
      if (value !== undefined) this.values.set(name.replace(/__/g, ":").toLowerCase(), value);
    }
  }

  get isDevelopment(): boolean {
    return this.environment.toLowerCase() === "development";
  }

  private loadJson(path: string): void {
    if (!existsSync(path)) return;
    const text = readFileSync(path, "utf8").replace(/^﻿/, "");
    this.flatten(JSON.parse(text), "");
  }

  // {"A":{"B":1,"C":["x","y"]}} -> a:b=1, a:c:0=x, a:c:1=y (as .NET's JSON provider does)
  private flatten(node: unknown, prefix: string): void {
    if (node === null || node === undefined) return;
    if (typeof node === "object") {
      const entries = Array.isArray(node) ? node.map((v, i) => [String(i), v] as const) : Object.entries(node as Record<string, unknown>);
      for (const [k, v] of entries) this.flatten(v, prefix ? `${prefix}:${k}` : k);
      return;
    }
    if (prefix) this.values.set(prefix.toLowerCase(), String(node));
  }

  /** configuration["Key"]: the value, or undefined. */
  get(key: string): string | undefined {
    return this.values.get(key.toLowerCase());
  }

  /** configuration.GetConnectionString(name) */
  connectionString(name = "DefaultConnection"): string | undefined {
    return this.get(`ConnectionStrings:${name}`);
  }

  /** configuration.GetValue<int>(key, fallback) */
  getInt(key: string, fallback = 0): number {
    const v = this.get(key);
    const n = v === undefined ? NaN : parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  /** configuration.GetValue<decimal>(key, fallback) */
  getNumber(key: string, fallback = 0): number {
    const v = this.get(key);
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /** configuration.GetValue<bool>(key, fallback): "true"/"false", case-insensitive. */
  getBool(key: string, fallback = false): boolean {
    const v = this.get(key)?.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
    return fallback;
  }

  /** The values of an array section (Key:0, Key:1, ...), like GetSection(key).Get<string[]>(). */
  getArray(key: string): string[] {
    const out: string[] = [];
    for (let i = 0; ; i++) {
      const v = this.get(`${key}:${i}`);
      if (v === undefined) break;
      out.push(v);
    }
    return out;
  }

  /** The keys directly under a section, like GetSection(key).GetChildren(). Lower-cased. */
  childKeys(section: string): string[] {
    const prefix = section.toLowerCase() + ":";
    const keys = new Set<string>();
    for (const k of this.values.keys()) {
      if (k.startsWith(prefix)) keys.add(k.slice(prefix.length).split(":")[0]);
    }
    return [...keys];
  }

  /** For tests and the brand overlay (WS1-02): add a value only where none is set. */
  setDefault(key: string, value: string): void {
    if (!this.values.has(key.toLowerCase())) this.values.set(key.toLowerCase(), value);
  }
}
