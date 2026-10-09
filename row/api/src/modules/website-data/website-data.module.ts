import { Module } from "@nestjs/common";
import { WebsiteDataController } from "./website-data.controller";
import { WebsiteDataService } from "./website-data.service";
import { ClubMenuController, ClubMenuService } from "./club-menu.controller";

/** Club public-website content: about, contacts, social links, theme, banners, adverts, menus. */
@Module({ controllers: [WebsiteDataController, ClubMenuController], providers: [WebsiteDataService, ClubMenuService], exports: [WebsiteDataService, ClubMenuService] })
export class WebsiteDataModule {}
