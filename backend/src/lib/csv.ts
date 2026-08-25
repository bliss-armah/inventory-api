export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyChar = false;

  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = "";
  };

  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      sawAnyChar = true;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      sawAnyChar = true;
      continue;
    }
    if (char === ",") {
      endField();
      sawAnyChar = true;
      continue;
    }
    if (char === "\r") {
      if (source[index + 1] === "\n") index += 1;
      endRow();
      sawAnyChar = true;
      continue;
    }
    if (char === "\n") {
      endRow();
      sawAnyChar = true;
      continue;
    }
    field += char;
    sawAnyChar = true;
  }

  if (field.length > 0 || row.length > 0 || (sawAnyChar && rows.length === 0)) {
    endRow();
  }

  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

export function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly unknown[][]): string {
  const lines = [header.map(toCsvValue).join(",")];
  for (const row of rows) {
    lines.push(row.map(toCsvValue).join(","));
  }
  return lines.join("\r\n");
}
