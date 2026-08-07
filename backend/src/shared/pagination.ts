import { z } from "zod";

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function toSkipTake(query: Pick<PaginationQuery, "page" | "pageSize">) {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  };
}

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

/**
 * Parses raw query params and hands the service's repository call a ready
 * (skip, take, search) tuple, returning the standard paginated envelope.
 */
export async function paginate<T>(
  rawQuery: unknown,
  fetch: (skip: number, take: number, search?: string) => Promise<[T[], number]>,
): Promise<Paginated<T>> {
  const parsed = paginationQuerySchema.parse(rawQuery);
  const { skip, take } = toSkipTake(parsed);
  const [items, total] = await fetch(skip, take, parsed.search);
  return { items, page: parsed.page, pageSize: parsed.pageSize, total };
}
