import { Controller, Get } from "@nestjs/common";
import { Db } from "../../database/db.service";
import { CountryDto } from "../../dtos/reference.dtos";

/** Port of CountriesController.cs + CountryService.cs: api/Countries (anonymous). */
@Controller("api/countries")
export class CountriesController {
  constructor(private readonly db: Db) {}

  @Get()
  async getAll() {
    return CountryDto.mapAll(await this.db.callProcedure("sp_country_get_all"));
  }
}
