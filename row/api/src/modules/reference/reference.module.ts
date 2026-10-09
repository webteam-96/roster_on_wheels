import { Module } from "@nestjs/common";
import { CountriesController } from "./countries.controller";
import { RotaryYearsController } from "./rotary-years.controller";

/** Reference data: countries, Rotary years. */
@Module({ controllers: [CountriesController, RotaryYearsController] })
export class ReferenceModule {}
