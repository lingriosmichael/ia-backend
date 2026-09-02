import type { DatabaseSession } from "../../shared/database/databaseClient.js";
import type {
  DisplayLabelCreateInput,
  DisplayLabelPersistenceRecord,
} from "./displayLabelPersistence.js";

export interface DisplayLabelRepository {
  findByKeys(
    keys: string[],
    session: DatabaseSession,
  ): Promise<DisplayLabelPersistenceRecord[]>;
  create(
    input: DisplayLabelCreateInput,
    session: DatabaseSession,
  ): Promise<DisplayLabelPersistenceRecord>;
}
