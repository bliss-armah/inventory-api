import { randomInt } from "node:crypto";

export const IN_STORE_PREFIX = "20";

const EAN13_LENGTH = 13;
const BODY_LENGTH = 12;

export function ean13CheckDigit(twelveDigits: string): string {
  if (!/^\d{12}$/.test(twelveDigits)) {
    throw new Error("An EAN-13 check digit needs exactly 12 digits");
  }

  let sum = 0;
  for (let index = 0; index < BODY_LENGTH; index += 1) {
    const digit = Number(twelveDigits[index]);
    sum += index % 2 === 0 ? digit : digit * 3;
  }

  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  return ean13CheckDigit(value.slice(0, BODY_LENGTH)) === value[BODY_LENGTH];
}

export function generateEan13(): string {
  let body = IN_STORE_PREFIX;
  while (body.length < BODY_LENGTH) {
    body += String(randomInt(0, 10));
  }
  return body + ean13CheckDigit(body);
}

export { EAN13_LENGTH };
