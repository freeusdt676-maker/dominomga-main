export const STAKE_LEVELS = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
export const ADMIN_CODE = "Ktwt4aad";
export const ADMIN_CODE_ALT = "2583";
export const DOMAIN_PSEUDO = "@dominomga.local";
export const TURN_TIMEOUT_SEC = 15;

export function phoneToEmail(phone: string) {
  const clean = phone.replace(/\D/g, "");
  return `${clean}${DOMAIN_PSEUDO}`;
}

export function fmtAr(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString("fr-FR") + " Ar";
}
