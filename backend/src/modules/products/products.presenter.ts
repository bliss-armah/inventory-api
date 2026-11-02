import { productImageUrl } from "../../lib/image-store.ts";
import type { Paginated } from "../../shared/pagination.ts";

type WithImageKey = { imageKey: string | null };

export async function presentProduct<T extends WithImageKey>(product: T) {
  const { imageKey, ...rest } = product;
  return { ...rest, imageUrl: await productImageUrl(imageKey) };
}

export function presentProducts<T extends WithImageKey>(products: T[]) {
  return Promise.all(products.map((product) => presentProduct(product)));
}

export async function presentProductPage<T extends WithImageKey>(page: Paginated<T>) {
  return { ...page, items: await presentProducts(page.items) };
}
