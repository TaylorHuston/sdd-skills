import { SddError } from "./errors.js";

export function isValidChangeId(changeId) {
  return /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(changeId);
}

export function assertValidChangeId(changeId) {
  if (!isValidChangeId(changeId)) {
    throw new SddError("Change ID must use YYYY-MM-DD followed by a lowercase kebab-case slug.", {
      code: "INVALID_CHANGE_ID",
    });
  }
}
