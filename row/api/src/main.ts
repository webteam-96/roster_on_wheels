import "reflect-metadata";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import express from "express";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { AppConfig } from "./config/app-config";
import { Brand } from "./brand/brand";
import { DotnetExpressAdapter, dotnetJsonReplacer } from "./common/http";
import { corsMiddleware } from "./pipeline/cors";
import { mediaMiddleware, pathBaseMiddleware } from "./pipeline/media";

// Project rule: 5 MB photos / 20 MB documents stored, 50 MB on the wire; ~55 MB
// accepted so a 50 MB file plus its multipart envelope is never refused (Program.cs).
export const MAX_REQUEST_BODY_BYTES = 55 * 1024 * 1024;

async function bootstrap() {
  const server = express();
  const app = await NestFactory.create(AppModule, new DotnetExpressAdapter(server), { bodyParser: false });
  const config = app.get(AppConfig);
  const log = new Logger("RowApi");

  // Same JSON conventions as the .NET API for anything sent through res.json.
  server.set("json replacer", dotnetJsonReplacer);
  server.disable("x-powered-by");

  const webRoot = config.get("Media:WebRoot") && existsSync(config.get("Media:WebRoot")!) ? config.get("Media:WebRoot")! : join(process.cwd(), "wwwroot");
  for (const dir of ["uploads/district", "uploads/club", "Documents/directory", "Documents/FaimilyMembersPhoto"]) {
    try {
      mkdirSync(join(webRoot, dir), { recursive: true });
    } catch (e) {
      log.warn(`Could not pre-create ${dir} under web root '${webRoot}': ${(e as Error).message}`);
    }
  }

  // Order follows Program.cs: path base, CORS, then media, then the API.
  app.use(pathBaseMiddleware(config.get("PathBase")));
  app.use(corsMiddleware(Brand.Current, config.isDevelopment));
  app.use(mediaMiddleware(webRoot, config.get("Media:RedirectBaseUrl")));
  app.use(express.json({ limit: MAX_REQUEST_BODY_BYTES, type: ["application/json", "application/*+json", "text/json"] }));
  app.use(express.urlencoded({ limit: MAX_REQUEST_BODY_BYTES, extended: true }));

  const port = Number(process.env.PORT ?? config.get("Port") ?? 5000);
  await app.listen(port);
  log.log(`═══ ROW API (${Brand.Current.instanceCode}) listening on ${port} ═══ environment=${config.environment}`);
}

bootstrap();
