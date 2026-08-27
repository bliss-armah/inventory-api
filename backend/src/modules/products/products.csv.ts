import { z } from "zod";
import { ProductStatus } from "../../generated/prisma";
import { parseCsv, toCsv } from "../../lib/csv.ts";

export const CSV_COLUMNS = [
  "sku",
  "barcode",
  "name",
  "description",
  "category",
  "brand",
  "unit",
  "costPrice",
  "sellingPrice",
  "minimumStock",
  "status",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

export type ProductCsvRow = {
  line: number;
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  category?: string;
  brand?: string;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  minimumStock: number;
  status?: ProductStatus;
};

export type RowError = { line: number; message: string };

const money = z.coerce.number().nonnegative();

const rowSchema = z.object({
  sku: z.string().trim().min(1, "sku is required").max(60),
  barcode: z.string().trim().max(60).optional(),
  name: z.string().trim().min(1, "name is required").max(160),
  description: z.string().trim().max(1000).optional(),
  category: z.string().trim().max(120).optional(),
  brand: z.string().trim().max(120).optional(),
  unit: z.string().trim().min(1, "unit is required").max(30),
  costPrice: money,
  sellingPrice: money,
  minimumStock: z.coerce.number().int().nonnegative().default(0),
  status: z.enum(ProductStatus).optional(),
});

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function buildExportCsv(
  products: Array<{
    sku: string;
    barcode: string | null;
    name: string;
    description: string | null;
    category: { name: string } | null;
    brand: { name: string } | null;
    unit: string;
    costPrice: unknown;
    sellingPrice: unknown;
    minimumStock: number;
    status: ProductStatus;
  }>,
): string {
  return toCsv(
    CSV_COLUMNS,
    products.map((product) => [
      product.sku,
      product.barcode,
      product.name,
      product.description,
      product.category?.name,
      product.brand?.name,
      product.unit,
      String(product.costPrice),
      String(product.sellingPrice),
      product.minimumStock,
      product.status,
    ]),
  );
}

export type ParsedCsv = { rows: ProductCsvRow[]; errors: RowError[] };

export function parseProductCsv(text: string): ParsedCsv {
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], errors: [{ line: 0, message: "The file is empty" }] };
  }

  const header = table[0]!.map((value) => value.trim().toLowerCase());
  const missing = (["sku", "name", "unit", "costprice", "sellingprice"] as const).filter(
    (column) => !header.includes(column),
  );
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message: `Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
        },
      ],
    };
  }

  const indexOf = (column: string) => header.indexOf(column.toLowerCase());
  const rows: ProductCsvRow[] = [];
  const errors: RowError[] = [];
  const seenSkus = new Map<string, number>();

  for (let index = 1; index < table.length; index += 1) {
    const line = index + 1;
    const cells = table[index]!;
    const cell = (column: CsvColumn) => {
      const position = indexOf(column);
      return position === -1 ? "" : (cells[position] ?? "");
    };

    const candidate = {
      sku: cell("sku").trim(),
      barcode: blankToUndefined(cell("barcode")),
      name: cell("name").trim(),
      description: blankToUndefined(cell("description")),
      category: blankToUndefined(cell("category")),
      brand: blankToUndefined(cell("brand")),
      unit: cell("unit").trim(),
      costPrice: cell("costPrice").trim(),
      sellingPrice: cell("sellingPrice").trim(),
      minimumStock: blankToUndefined(cell("minimumStock")) ?? 0,
      status: blankToUndefined(cell("status"))?.toUpperCase(),
    };

    const parsed = rowSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({
        line,
        message: parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`)
          .join("; "),
      });
      continue;
    }

    const duplicateOf = seenSkus.get(parsed.data.sku);
    if (duplicateOf !== undefined) {
      errors.push({
        line,
        message: `sku "${parsed.data.sku}" already appears on line ${duplicateOf}`,
      });
      continue;
    }
    seenSkus.set(parsed.data.sku, line);
    rows.push({ line, ...parsed.data });
  }

  return { rows, errors };
}
