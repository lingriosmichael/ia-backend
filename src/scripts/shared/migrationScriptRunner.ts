import { loadConfig } from "../../shared/config/env.js";
import {
  connectMongoDatabase,
  disconnectMongoDatabase,
} from "../../shared/database/mongoose.js";

export function hasExecuteFlag(): boolean {
  return process.argv.includes("--execute");
}

/**
 * Shared lifecycle for the one-off Mongo migration/maintenance scripts
 * under src/scripts/: connect, run a caller-supplied dry-run preview and
 * print it, only perform the real write when --execute is passed, then
 * always disconnect and report failure with a non-zero exit code. Mirrors
 * the dry-run/--execute pattern resetWorkspaceToStructureOnly.ts
 * established, applied consistently here instead of ad hoc per script — a
 * script using this helper can never perform a write without an explicit
 * --execute flag, and always shows what it's about to do first.
 */
export function runMigrationScript(options: {
  scriptLabel: string;
  /** Reports what the migration would do, without writing anything. */
  preview: () => Promise<void>;
  /** Performs the real write(s). Only called when --execute is passed. */
  apply: () => Promise<void>;
}): void {
  void (async () => {
    const config = loadConfig();
    await connectMongoDatabase(config);

    try {
      await options.preview();

      if (!hasExecuteFlag()) {
        console.log(
          "Dry run only — no changes were written. Re-run with `-- --execute` to apply this migration.",
        );
        return;
      }

      await options.apply();
      console.log(`${options.scriptLabel} completed.`);
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      await disconnectMongoDatabase();
    }
  })();
}
