import { randomUUID } from "node:crypto";

export function createDocumentId(): string {
  return randomUUID();
}
