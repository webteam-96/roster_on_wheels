import { Module } from "@nestjs/common";
import { ClubContentController } from "./club-content.controller";
import { TaxonomyController } from "./taxonomy.controller";
import { AnnouncementService } from "./announcement.service";
import { DocumentService } from "./document.service";
import { TaxonomyService } from "./taxonomy.service";
import { UpcomingEventService } from "./upcoming-event.service";
import { NewsletterService } from "./newsletter.service";

/** Club announcements, documents, upcoming events and newsletters; the project taxonomy. */
@Module({
  controllers: [ClubContentController, TaxonomyController],
  providers: [AnnouncementService, DocumentService, TaxonomyService, UpcomingEventService, NewsletterService],
  exports: [AnnouncementService, DocumentService, TaxonomyService, UpcomingEventService, NewsletterService],
})
export class ContentModule {}
