export function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL || process.env.BASE_URL || "http://localhost:3000";
}
