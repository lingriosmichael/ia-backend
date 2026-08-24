import mongoose from "mongoose";
import { renderClarificationQuestion } from "../modules/interpretation/clarificationQuestionCopy.js";
import type { InterpretationQuestionCode } from "../shared/contracts.js";
import { runMigrationScript } from "./shared/migrationScriptRunner.js";

// Same default previewActivityAnalysis/readJobLanguage fall back to when no
// language is otherwise known — activity_analysis_runs_v2 documents don't
// persist their own language field, so there is no per-document signal to
// read here instead.
const FALLBACK_LANGUAGE: "de" | "en" = "de";

// Mirrors activityAnalysisV2Service.ts's (now-removed) runtime fallback set:
// these codes need real substitution data to render correctly. A question
// drafted before clarificationQuestionCopy.ts existed (Phase 1) never got
// that data, so re-rendering it would degrade real historical wording (e.g.
// "Found values: .") — preserve the original prompt/options verbatim
// instead for exactly those records.
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
  runId: mongoose.mongo.BSON.ObjectId;
  questionIndex: number;
  question: RawClarificationQuestion;
}

function getCollection() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Mongo database connection is not available.");
  }
  return database.collection("activity_analysis_runs_v2");
}

function needsBackfill(question: RawClarificationQuestion): boolean {
  return question.status === "pending" && !question.userFacingPrompt?.trim();
}

async function findBackfillTargets(): Promise<BackfillTarget[]> {
  const targets: BackfillTarget[] = [];
  const cursor = getCollection().find(
    { "clarificationQuestions.status": "pending" },
    { projection: { clarificationQuestions: 1 } },
  );
  for await (const run of cursor) {
    const questions = (run.clarificationQuestions ??
      []) as RawClarificationQuestion[];
    questions.forEach((question, questionIndex) => {
      if (needsBackfill(question)) {
        targets.push({ runId: run._id, questionIndex, question });
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
    "activity_analysis_runs_v2 clarificationQuestions userFacingPrompt/userFacingOptions backfill",
  preview: async () => {
    const targets = await findBackfillTargets();
    const countByQuestionCode = new Map<string, number>();
    for (const target of targets) {
      const key = target.question.questionCode ?? "(null)";
      countByQuestionCode.set(key, (countByQuestionCode.get(key) ?? 0) + 1);
    }
    console.log(
      `${targets.length} pending clarificationQuestions entries missing userFacingPrompt.`,
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
            filter: { _id: target.runId },
            update: {
              $set: {
                [`clarificationQuestions.${target.questionIndex}.userFacingPrompt`]:
                  rendered.userFacingPrompt,
                [`clarificationQuestions.${target.questionIndex}.userFacingOptions`]:
                  rendered.userFacingOptions,
              },
            },
          },
        };
      }),
    );
    console.log(
      `Backfilled userFacingPrompt/userFacingOptions on ${result.modifiedCount} clarificationQuestions entries.`,
    );
  },
});
