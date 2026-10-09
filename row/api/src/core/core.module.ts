import { Global, Module } from "@nestjs/common";
import { AppConfig } from "../config/app-config";
import { Db } from "../database/db.service";
import { JwtService } from "../auth/jwt.service";
import { Brand, applyLegacyOverlay, loadBrand, type BrandOptions } from "../brand/brand";

export const BRAND = "BRAND";

/**
 * Services every module uses, registered once (the singletons of Program.cs):
 * configuration, the database, tokens and the instance brand.
 */
@Global()
@Module({
  providers: [
    {
      provide: AppConfig,
      useFactory: () => {
        const config = new AppConfig();
        const brand = loadBrand(config);
        applyLegacyOverlay(config, brand);
        Brand.initialise(brand);
        return config;
      },
    },
    { provide: BRAND, useFactory: (_config: AppConfig): BrandOptions => Brand.Current, inject: [AppConfig] },
    Db,
    JwtService,
  ],
  exports: [AppConfig, Db, JwtService, BRAND],
})
export class CoreModule {}
