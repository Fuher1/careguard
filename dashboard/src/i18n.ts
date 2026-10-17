/**
 * Internationalization (i18n) helper layer for CareGuard dashboard.
 *
 * Provides translation lookup via getTranslations() and locale-aware
 * currency, date, time, and number formatting helpers.
 */
import en from "../messages/en.json";
import es from "../messages/es.json";

export const locales = ["en", "es"] as const;
export type Locale = (typeof locales)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const translations: Record<Locale, typeof en> = { en, es };

export function getTranslations(locale: Locale) {
  return translations[locale] || translations.en;
}

export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

export function formatCurrency(amount: number, locale: Locale, decimals?: number): string {
  const formatter = new Intl.NumberFormat(locale === "es" ? "es-ES" : "en-US", {
    style: "currency",
    currency: "USD",
    ...(decimals !== undefined
      ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
      : {}),
  });
  return formatter.format(amount);
}

export function formatDate(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// #1139 — time-only formatter mirroring formatDate(), for call sites that
// previously used a bare toLocaleTimeString() with no locale argument.
export function formatTime(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString(locale === "es" ? "es-ES" : "en-US");
}

// #1139 — combined date+time formatter mirroring formatDate(), for call
// sites that previously used a bare toLocaleString() with no locale
// argument (which renders both date and time, unlike toLocaleDateString()).
export function formatDateTime(date: Date | string, locale: Locale): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString(locale === "es" ? "es-ES" : "en-US");
}

export function formatNumber(num: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "es" ? "es-ES" : "en-US").format(num);
}
