import { describe, expect, it } from "vitest";
import { generatePassword } from "../lib/password-generator";

describe("generatePassword", () => {
  it("is twelve characters by default", () => {
    expect(generatePassword()).toHaveLength(12);
  });

  it("always mixes upper case, lower case and digits", () => {
    for (let index = 0; index < 200; index += 1) {
      const password = generatePassword();
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/\d/);
    }
  });

  it("leaves out characters that are easy to misread when told over the phone", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generatePassword(40)).not.toMatch(/[0O1lI]/);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassword()));
    expect(seen.size).toBe(200);
  });
});
