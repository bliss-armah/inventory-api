import { describe, expect, it } from "vitest";
import { parseCsv, toCsv, toCsvValue } from "../lib/csv.ts";

describe("parseCsv", () => {
  it("reads a plain table", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps commas that live inside quotes", () => {
    expect(parseCsv('name,price\n"Rice, 5kg",20')).toEqual([
      ["name", "price"],
      ["Rice, 5kg", "20"],
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('a\n"He said ""hi"""')).toEqual([["a"], ['He said "hi"']]);
  });

  it("keeps a newline that lives inside quotes", () => {
    expect(parseCsv('a,b\n"line one\nline two",2')).toEqual([
      ["a", "b"],
      ["line one\nline two", "2"],
    ]);
  });

  it("handles CRLF line endings from a spreadsheet export", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a UTF-8 BOM, which Excel writes by default", () => {
    expect(parseCsv("﻿sku,name\nA-1,Rice")).toEqual([
      ["sku", "name"],
      ["A-1", "Rice"],
    ]);
  });

  it("drops blank lines rather than reading them as empty products", () => {
    expect(parseCsv("a,b\n\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps empty fields inside a real row", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("toCsv", () => {
  it("quotes only what needs quoting", () => {
    expect(toCsvValue("plain")).toBe("plain");
    expect(toCsvValue("has,comma")).toBe('"has,comma"');
    expect(toCsvValue('has"quote')).toBe('"has""quote"');
    expect(toCsvValue("has\nnewline")).toBe('"has\nnewline"');
  });

  it("writes null and undefined as empty rather than as text", () => {
    expect(toCsvValue(null)).toBe("");
    expect(toCsvValue(undefined)).toBe("");
  });

  it("round-trips through the parser", () => {
    const header = ["sku", "name", "note"];
    const rows = [["A-1", 'Rice, "premium"', "line\nbreak"]];
    expect(parseCsv(toCsv(header, rows))).toEqual([header, rows[0]]);
  });
});
