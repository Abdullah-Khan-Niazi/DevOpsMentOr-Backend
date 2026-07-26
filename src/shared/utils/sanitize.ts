export function sanitizeString(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
