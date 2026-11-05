import { randomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALL = UPPER + LOWER + DIGITS;
const DEFAULT_LENGTH = 12;

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)] as string;
}

function shuffle(characters: string[]): string[] {
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [characters[index], characters[swap]] = [characters[swap] as string, characters[index] as string];
  }
  return characters;
}

export function generatePassword(length = DEFAULT_LENGTH): string {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  const rest = Array.from({ length: Math.max(length, required.length) - required.length }, () =>
    pick(ALL),
  );
  return shuffle([...required, ...rest]).join("");
}
