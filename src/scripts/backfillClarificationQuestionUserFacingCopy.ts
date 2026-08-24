import mongoose from "mongoose";
import { renderClarificationQuestion } from "../modules/interpretation/clarificationQuestionCopy.js";
import type { InterpretationQuestionCode } from "../shared/contracts.js";
import { runMigrationScript } from "./shared/migrationScriptRunner.js";

// interpretation_results documents don't persist their own language field
// (it lives on the originating processing job's payload instead) — "de" is
// the same fallback readJobLanguage/previewActivityAnalysis use elsewhere
// when no language is otherwise known.
const FALLBACK_LANGUAGE: "de" | "en" = "de";

// Mirrors clarificationQuestionCopy.ts's renderers that need real
// substitution data beyond table/column name. A question drafted before
// that data was populated (Phase 1) never got it, so re-rendering it would
// degrade real historical wording (e.g. "Found values: .") — preserve the
// original prompt/options verbatim instead for exactly those records.
const CODES_REQUIRING_QUESTION_DATA: ReadonlySet<InterpretationQuestionCode> =
  new Set([
    "primary_status_field",
    "positive_status_values",
    "primary_date_field",
    "normalization_merge",
    "filter_value_grounding",
  ]);

interface RawClarificationQuestion {
  questionCode?: InterpretationQuestionCode | null;
  targetTableName?: string | null;
  targetColumnName?: string | null;
  questionData?: Record<string, unknown> | null;
  prompt?: string | null;
  options?: string[] | null;
  userFacingPrompt?: string | null;
  status?: string;
}

interface BackfillTarget {
  resultId: mongoose.mongo.BSON.ObjectId;
  questionIndex: number;
  question: RawClarificationQuestion;
}

function getCollection() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Mongo database connection is not available.");
  }
  return database.collection("interpretation_results");
}

function needsBackfill(question: RawClarificationQuestion): boolean {
  return question.status === "pending" && !question.userFacingPrompt?.trim();
}

async function findBackfillTargets(): Promise<BackfillTarget[]> {
  const targets: BackfillTarget[] = [];
  const cursor = getCollection().find(
    { "questions.status": "pending" },
    { projection: { questions: 1 } },
  );
  for await (const result of cursor) {
    const questions = (result.questions ?? []) as RawClarificationQuestion[];
    questions.forEach((question, questionIndex) => {
      if (needsBackfill(question)) {
        targets.push({ resultId: result._id, questionIndex, question });
      }
    });
  }
  return targets;
}

function renderBackfilledCopy(question: RawClarificationQuestion): {
  userFacingPrompt: string;
  userFacingOptions: { value: string; label: string }[] | null;
} {
  const questionCode = question.questionCode ?? null;
  const questionData = question.questionData ?? null;

  // A stray prompt/options field may still sit on an old document even
  // though ia_backend stopped reading/writing them (Phase 6) — reading it
  // here (never writing it back) is exactly what lets this fallback
  // preserve real historical wording instead of degrading it.
  if (
    questionCode &&
    CODES_REQUIRING_QUESTION_DATA.has(questionCode) &&
    !questionData
  ) {
    const preservedOptions = question.options?.length
      ? question.options.map((option) => ({ value: option, label: option }))
      : null;
    return {
      userFacingPrompt: question.prompt ?? "",
      userFacingOptions: preservedOptions,
    };
  }

  const rendered = renderClarificationQuestion({
    questionCode,
    targetTableName: question.targetTableName ?? null,
    targetColumnName: question.targetColumnName ?? null,
    language: FALLBACK_LANGUAGE,
    questionData,
    rawPrompt: question.prompt ?? "",
    rawOptions: question.options ?? null,
  });
  return {
    userFacingPrompt: rendered.userFacingPrompt,
    userFacingOptions: rendered.userFacingOptions,
  };
}

runMigrationScript({
  scriptLabel:
    "interpretation_results questions userFacingPrompt/userFacingOptions backfill",
  preview: async () => {
    const targets = await findBackfillTargets();
    const countByQuestionCode = new Map<string, number>();
    for (const target of targets) {
      const key = target.question.questionCode ?? "(null)";
      countByQuestionCode.set(key, (countByQuestionCode.get(key) ?? 0) + 1);
    }
    console.log(
      `${targets.length} pending questions entries missing userFacingPrompt.`,
    );
    for (const [questionCode, count] of countByQuestionCode) {
      console.log(`  ${questionCode}: ${count}`);
    }
  },
  apply: async () => {
    const targets = await findBackfillTargets();
    if (targets.length === 0) {
      console.log("Nothing to backfill.");
      return;
    }

    const result = await getCollection().bulkWrite(
      targets.map((target) => {
        const rendered = renderBackfilledCopy(target.question);
        return {
          updateOne: {
            filter: { _id: target.resultId },
            update: {
              $set: {
                [`questions.${target.questionIndex}.userFacingPrompt`]:
                  rendered.userFacingPrompt,
                [`questions.${target.questionIndex}.userFacingOptions`]:
                  rendered.userFacingOptions,
              },
            },
          },
        };
      }),
    );
    console.log(
      `Backfilled userFacingPrompt/userFacingOptions on ${result.modifiedCount} questions entries.`,
    );
  },
});
