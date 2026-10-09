import type { Type } from "@nestjs/common";
import { SharedModule } from "../services/shared.module";
import { AuthModule } from "./auth/auth.module";
import { ReferenceModule } from "./reference/reference.module";
import { ZonesModule } from "./zones/zones.module";

/**
 * Every ported feature module, registered with the application. Add a module
 * here when its controllers are ported (see PORTING.md for the order).
 */
export const FEATURE_MODULES: Type[] = [SharedModule, AuthModule, ReferenceModule, ZonesModule];
