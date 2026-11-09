import { prisma } from "../lib/prisma.ts";

type QueryEvent = { query: string };
type QueryEmitter = { $on(event: "query", listener: (event: QueryEvent) => void): void };

let recorded: string[] | null = null;
let subscribed = false;

function subscribe() {
  if (subscribed) return;
  subscribed = true;
  (prisma as unknown as QueryEmitter).$on("query", (event) => {
    recorded?.push(event.query.trim());
  });
}

export type QueryReport = { total: number; selects: number; writes: number };

export async function countQueries(action: () => Promise<unknown>): Promise<QueryReport> {
  subscribe();
  recorded = [];
  try {
    await action();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const queries = recorded;
    const selects = queries.filter((query) => /^SELECT/i.test(query)).length;
    const writes = queries.filter((query) => /^(INSERT|UPDATE|DELETE)/i.test(query)).length;
    return { total: queries.length, selects, writes };
  } finally {
    recorded = null;
  }
}
