import { paginate } from "../../shared/pagination";
import * as activityRepository from "./activity.repository";
import { activityFilterSchema } from "./activity.validators";

export function list(tenantId: string, rawQuery: unknown) {
  const filter = activityFilterSchema.parse(rawQuery);
  return paginate(rawQuery, (skip, take) => activityRepository.list(tenantId, skip, take, filter));
}
