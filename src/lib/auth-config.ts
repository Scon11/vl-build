/**
 * Authentication configuration for VL Suite
 */

// Only allow signups from this domain
export const ALLOWED_DOMAIN = "vantagelgs.com";

// Admin emails - can access VL Build and admin features
export const ADMIN_EMAILS = [
  "sconley@vantagelgs.com",
];

/**
 * Check if an email belongs to the allowed domain
 */
export function isAllowedDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain === ALLOWED_DOMAIN;
}

/**
 * Check if a user is an admin
 */
export function isAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}
