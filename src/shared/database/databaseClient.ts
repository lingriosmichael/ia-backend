import type { ClientSession } from "mongoose";

export type DatabaseSession = ClientSession | null;

export const databaseSession: DatabaseSession = null;
