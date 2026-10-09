import { Controller, Get, Header } from "@nestjs/common";
import { AllowAnonymous } from "../auth/decorators";
import { Brand } from "./brand";

/**
 * GET api/public/brand (master plan WS1-03): the non-secret part of the
 * instance brand. The admin web app and the mobile app read it first.
 * Nothing from the providers except the enabled payment gateway codes.
 */
@Controller("api/public/brand")
@AllowAnonymous()
export class PublicBrandController {
  @Get()
  @Header("Cache-Control", "public,max-age=3600")
  get() {
    const b = Brand.Current;
    return {
      instanceCode: b.instanceCode,
      productName: b.productName,
      shortName: b.shortName,
      logoUrl: b.look.logoUrl,
      logoDarkUrl: b.look.logoDarkUrl,
      faviconUrl: b.look.faviconUrl,
      openGraphImageUrl: b.look.openGraphImageUrl,
      support: {
        email: b.support.email,
        phones: b.support.phones,
        hours: b.support.hours,
        address: b.support.address,
        legalName: b.support.legalName,
        privacyEmail: b.support.privacyEmail,
      },
      locale: {
        defaultLanguage: b.locale.defaultLanguage,
        languages: b.locale.languages,
        defaultCurrency: b.locale.defaultCurrency,
        currencies: b.locale.currencies,
        defaultTimeZone: b.locale.defaultTimeZone,
        numberLocale: b.locale.numberLocale,
        defaultCountryId: b.locale.defaultCountryId,
      },
      features: Brand.resolvedFeatures(),
      legal: {
        privacyUrl: b.legal.privacyUrl,
        termsUrl: b.legal.termsUrl,
        refundsUrl: b.legal.refundsUrl,
        cookiesUrl: b.legal.cookiesUrl,
        policyVersion: b.legal.policyVersion,
      },
      domains: { adminOrigin: b.domains.adminOrigin, clubSiteParent: b.domains.clubSiteParent },
      paymentGateways: b.providers.payments,
    };
  }
}
