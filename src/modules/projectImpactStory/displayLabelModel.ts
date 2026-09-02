import { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { createModel } from "../../shared/database/createModel.js";

// _id is the content-addressed cache key (see buildDisplayLabelKey in
// displayLabelPersistence.ts) rather than a generated document id — the
// source text (a goal statement, a bar/category label, ...) has no stable
// owning entity to key on in most of its callers (see
// IMPACT_STORY_CHART_IMPROVEMENT_PLAN.md §2: a "goal" is just a parsed
// line of an activity's free-text output field, re-derived every V2 run,
// with a positional goalId that isn't stable across edits). Keying on the
// text itself means an edit is just a fresh cache miss — no invalidation
// logic needed — and identical text repeated across activities/projects
// shares one cache entry for free.
const displayLabelSchema = new Schema(
  {
    _id: { type: String, required: true },
    sourceText: { type: String, required: true },
    language: { type: String, required: true, enum: ["de", "en"] },
    displayLabel: { type: String, required: true },
  },
  {
    collection: "display_labels",
    timestamps: true,
  },
);

export type DisplayLabelMongoDocument = InferSchemaType<
  typeof displayLabelSchema
>;
export type DisplayLabelMongoHydratedDocument =
  HydratedDocument<DisplayLabelMongoDocument>;
export const DisplayLabelMongoModel = createModel(
  "DisplayLabel",
  displayLabelSchema,
);
