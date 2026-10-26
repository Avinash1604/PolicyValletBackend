import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';

const defaultRegion = () =>
  (process.env.DEFAULT_PHONE_REGION ?? 'IN') as CountryCode;

/** Returns the number in E.164 (+919876543210), or null if it isn't a valid number. */
export function toE164(raw: string): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultRegion());
  return parsed?.isValid() ? parsed.number : null;
}

export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes('@');
}
