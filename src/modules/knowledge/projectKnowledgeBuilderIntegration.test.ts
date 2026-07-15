import assert from "node:assert/strict";
import test from "node:test";
import type { ActivityPersistenceRecord } from "../activity/activityPersistence.js";
import type { UploadMetadataPersistenceRecord } from "../upload/uploadMetadataPersistence.js";
import type { InterpretationResultRepository } from "../interpretation/interpretationResultRepository.js";
import type { InterpretationResultPersistenceRecord } from "../interpretation/interpretationResultPersistence.js";
import {
  buildService,
  createFakeRepositories,
  makeActivity,
  makeInterpretationResult,
  makeUpload,
} from "./knowledgeBuilderTestFixtures.js";

/**
 * Phase 4.5 validation sprint — one realistic, multi-activity, mixed
 * file-type mentoring-program evidence package, modeled directly at the
 * InterpretationResult boundary (the actual contract
 * ProjectKnowledgeBuilderService consumes) rather than through real
 * parsed files. See "Phase 4 — Project Knowledge Model.md" and
 * "Code Review Remediation Plan — 2026-07-13.md" item 19's neighboring
 * validation-sprint discussion for why fixture-level was chosen over a
 * live end-to-end run: this exercises the exact merge/prune/rebuild
 * contract deterministically, without requiring MongoDB or the Python
 * service to be running.
 *
 * The scenario: six activities of a mentoring program, evidence spread
 * across CSV, Excel, PDF, and DOCX uploads (reflected in
 * originalFileName/contentType — the builder itself never branches on
 * file type, but real provenance needs a real variety of source
 * formats to be meaningful). It deliberately encodes every risk case
 * from the validation sprint in one connected project rather than as
 * isolated micro-fixtures:
 *
 * - a genuine cross-file, cross-format merge within one activity
 * - the same wording used by two different activities that must NOT merge
 * - the same indicator label with an unrelated description within one
 *   activity that must NOT merge (Tier 2's description-similarity guard)
 * - two qualitative findings that disagree about the same indicator
 *   (reinforces vs. contradicts) — both must survive as separate theme
 *   entities, since resolving the conflict is not this layer's job
 * - a rejected duplicate that must not attach anywhere
 * - an unacknowledged activity's data, which must be fully invisible
 * - a context_only finding, which must still produce a theme entity
 */

const activities: ActivityPersistenceRecord[] = [
  makeActivity({
    id: "act-recruitment",
    name: "Mentor:innengewinnung, Auswahl und Schulung",
    activityType: "mentoring",
  }),
  makeActivity({
    id: "act-training",
    name: "Mentor:innenschulung",
    activityType: "mentoring",
  }),
  makeActivity({
    id: "act-matching",
    name: "Mentee Matching & Onboarding",
    activityType: "matching",
  }),
  makeActivity({
    id: "act-sessions",
    name: "Mentoring Sessions & Attendance",
    activityType: "mentoring_sessions",
  }),
  makeActivity({
    id: "act-outcomes",
    name: "Program Outcomes Assessment",
    activityType: "outcomes",
  }),
  makeActivity({
    id: "act-alumni",
    name: "Alumni Network & Follow-up",
    activityType: "alumni",
    // Not yet reviewed/acknowledged — everything under this activity must
    // be fully invisible to the Knowledge Builder, no matter how closely
    // its data resembles an already-verified activity's.
    interpretationAcknowledgedAt: null,
    interpretationAcknowledgedById: null,
  }),
];

const uploads: UploadMetadataPersistenceRecord[] = [
  makeUpload({
    id: "upload-recruitment-csv",
    activityId: "act-recruitment",
    originalFileName: "mentor_applications.csv",
    contentType: "text/csv",
  }),
  makeUpload({
    id: "upload-recruitment-pdf",
    activityId: "act-recruitment",
    originalFileName: "interview_assessment_report.pdf",
    contentType: "application/pdf",
  }),
  makeUpload({
    id: "upload-training-xlsx",
    activityId: "act-training",
    originalFileName: "refresher_training_sessions.xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }),
  makeUpload({
    id: "upload-matching-csv",
    activityId: "act-matching",
    originalFileName: "mentee_matching_records.csv",
    contentType: "text/csv",
  }),
  makeUpload({
    id: "upload-matching-docx",
    activityId: "act-matching",
    originalFileName: "onboarding_narrative_report.docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
  makeUpload({
    id: "upload-sessions-xlsx",
    activityId: "act-sessions",
    originalFileName: "session_attendance_log.xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }),
  makeUpload({
    id: "upload-sessions-csv",
    activityId: "act-sessions",
    originalFileName: "participant_feedback_survey.csv",
    contentType: "text/csv",
  }),
  makeUpload({
    id: "upload-outcomes-pdf",
    activityId: "act-outcomes",
    originalFileName: "annual_outcomes_report.pdf",
    contentType: "application/pdf",
  }),
  makeUpload({
    id: "upload-outcomes-docx",
    activityId: "act-outcomes",
    originalFileName: "case_study_compilation.docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
  makeUpload({
    id: "upload-alumni-csv",
    activityId: "act-alumni",
    originalFileName: "alumni_followup_survey.csv",
    contentType: "text/csv",
  }),
];

function indicator(
  overrides: Partial<
    InterpretationResultPersistenceRecord["indicators"][number]
  >,
): InterpretationResultPersistenceRecord["indicators"][number] {
  return {
    id: "indicator-placeholder",
    name: "Placeholder indicator",
    description: "placeholder description",
    confidence: 0.9,
    reason: "derived from the source table",
    relatedEntityIds: [],
    supportingParagraphKeys: [],
    relevanceStage: null,
    matchesStatedGoal: false,
    status: "kept",
    suggestedCalculation: null,
    computedValue: null,
    ...overrides,
  };
}

function finding(
  overrides: Partial<
    InterpretationResultPersistenceRecord["qualitativeFindings"][number]
  >,
): InterpretationResultPersistenceRecord["qualitativeFindings"][number] {
  return {
    id: "finding-placeholder",
    summary: "Placeholder finding",
    reason: "derived from narrative evidence",
    confidence: 0.8,
    category: "context_only",
    outcomeReference: null,
    outcomeAnchorType: "unanchored",
    relationToEvidence: "context_only",
    stage: "outcome",
    relatedEntityIds: [],
    relatedIndicatorIds: [],
    supportingQuoteIds: [],
    status: "kept",
    ...overrides,
  };
}

const interpretationResults: InterpretationResultPersistenceRecord[] = [
  // --- Recruitment: cross-file, cross-format merge (CSV + PDF), plus a
  // same-label/different-description indicator that must stay separate.
  makeInterpretationResult({
    id: "result-recruitment-csv",
    activityId: "act-recruitment",
    uploadMetadataId: "upload-recruitment-csv",
    indicators: [
      indicator({
        id: "ind-recruitment-csv-1",
        name: "Completion rate",
        description:
          "share of submitted mentor applications that were fully completed before the deadline",
      }),
    ],
    qualitativeFindings: [
      finding({
        id: "find-recruitment-csv-1",
        summary: "Strong candidate pool",
        reason: "interview panel noted high quality of applicants",
        relationToEvidence: "reinforces",
        relatedIndicatorIds: ["ind-recruitment-csv-1"],
      }),
    ],
  }),
  makeInterpretationResult({
    id: "result-recruitment-pdf",
    activityId: "act-recruitment",
    uploadMetadataId: "upload-recruitment-pdf",
    indicators: [
      // Same activity, different file, same label (case-insensitive) and
      // near-identical description as ind-recruitment-csv-1 — must merge
      // into one KnowledgeEntity with two source instances.
      indicator({
        id: "ind-recruitment-pdf-1",
        name: "completion rate",
        description:
          "share of submitted mentor applications that were fully completed before the deadline",
      }),
      // Same activity, same exact label "Completion rate" as above, but a
      // completely unrelated description — must NOT merge with it, even
      // though it is the same activity and the same literal label.
      indicator({
        id: "ind-recruitment-pdf-2",
        name: "Completion rate",
        description:
          "percentage of scheduled interview slots that the panel actually completed on time",
      }),
    ],
  }),

  // --- Training: a separate activity that happens to track the exact
  // same wording as recruitment's completion rate — must NOT merge with
  // it, despite identical label, description, and activityType.
  makeInterpretationResult({
    id: "result-training",
    activityId: "act-training",
    uploadMetadataId: "upload-training-xlsx",
    indicators: [
      indicator({
        id: "ind-training-1",
        name: "Completion rate",
        description:
          "share of submitted mentor applications that were fully completed before the deadline",
      }),
      indicator({
        id: "ind-training-2",
        name: "Refresher session attendance rate",
        description:
          "share of enrolled mentors who attended each refresher session",
      }),
    ],
    qualitativeFindings: [
      finding({
        id: "find-training-1",
        summary: "Refresher attendance dropped mid-cycle",
        reason: "sign-in sheets showed a decline after session three",
        relationToEvidence: "contradicts",
        relatedIndicatorIds: ["ind-training-2"],
      }),
    ],
  }),

  // --- Matching: quantitative + narrative evidence, no conflicting
  // indicator names to worry about here.
  makeInterpretationResult({
    id: "result-matching-csv",
    activityId: "act-matching",
    uploadMetadataId: "upload-matching-csv",
    indicators: [
      indicator({
        id: "ind-matching-1",
        name: "Match success rate",
        description:
          "share of mentees successfully matched with an available mentor within 30 days",
      }),
    ],
  }),
  makeInterpretationResult({
    id: "result-matching-docx",
    activityId: "act-matching",
    uploadMetadataId: "upload-matching-docx",
    qualitativeFindings: [
      finding({
        id: "find-matching-1",
        summary: "Onboarding delays reported for rural mentees",
        reason:
          "narrative interviews described longer wait times outside the city",
        relationToEvidence: "complicates",
        relatedIndicatorIds: [],
      }),
    ],
  }),

  // --- Sessions: the conflicting-signal case. Two findings in the same
  // file disagree about the same indicator; both must survive as
  // distinct theme entities. Also a rejected duplicate indicator that
  // must never attach anywhere.
  makeInterpretationResult({
    id: "result-sessions-xlsx",
    activityId: "act-sessions",
    uploadMetadataId: "upload-sessions-xlsx",
    indicators: [
      indicator({
        id: "ind-sessions-1",
        name: "Session attendance rate",
        description:
          "share of scheduled 1:1 mentoring sessions that were actually attended by both parties",
      }),
    ],
    qualitativeFindings: [
      finding({
        id: "find-sessions-1",
        summary: "Attendance strong in urban cohort pairs",
        reason: "urban pairs attended nearly every scheduled session",
        relationToEvidence: "reinforces",
        relatedIndicatorIds: ["ind-sessions-1"],
      }),
      finding({
        id: "find-sessions-2",
        summary: "Attendance weak in rural cohort pairs",
        reason: "rural pairs missed roughly a third of scheduled sessions",
        relationToEvidence: "contradicts",
        relatedIndicatorIds: ["ind-sessions-1"],
      }),
    ],
  }),
  makeInterpretationResult({
    id: "result-sessions-csv",
    activityId: "act-sessions",
    uploadMetadataId: "upload-sessions-csv",
    indicators: [
      indicator({
        id: "ind-sessions-2",
        name: "Participant satisfaction score",
        description:
          "average self-reported satisfaction rating from post-session feedback surveys",
      }),
      // Looks like a duplicate of ind-sessions-1, but was rejected during
      // curation — must not contribute a source instance anywhere.
      indicator({
        id: "ind-sessions-3",
        name: "Session attendance rate",
        description:
          "share of scheduled 1:1 mentoring sessions that were actually attended by both parties",
        status: "rejected",
      }),
    ],
  }),

  // --- Outcomes: a context_only finding (no relationship expected) plus
  // an indicator that a later, unacknowledged activity will try to
  // (incorrectly) duplicate.
  makeInterpretationResult({
    id: "result-outcomes-pdf",
    activityId: "act-outcomes",
    uploadMetadataId: "upload-outcomes-pdf",
    indicators: [
      indicator({
        id: "ind-outcomes-1",
        name: "Employment placement rate",
        description:
          "share of program graduates who secured employment within 6 months of completing mentoring",
      }),
    ],
  }),
  makeInterpretationResult({
    id: "result-outcomes-docx",
    activityId: "act-outcomes",
    uploadMetadataId: "upload-outcomes-docx",
    qualitativeFindings: [
      finding({
        id: "find-outcomes-1",
        summary: "Case studies show strong long-term outcomes",
        reason:
          "compiled case studies describe sustained employment and continued mentoring contact",
        relationToEvidence: "context_only",
        relatedIndicatorIds: [],
      }),
    ],
  }),

  // --- Alumni (unacknowledged): repeats outcomes' exact indicator
  // wording. If activity-acknowledgment gating were broken, this would
  // wrongly show up as a second source instance on ind-outcomes-1.
  makeInterpretationResult({
    id: "result-alumni-csv",
    activityId: "act-alumni",
    uploadMetadataId: "upload-alumni-csv",
    indicators: [
      indicator({
        id: "ind-alumni-1",
        name: "Employment placement rate",
        description:
          "share of program graduates who secured employment within 6 months of completing mentoring",
      }),
    ],
  }),
];

function buildFixtureRepos() {
  return createFakeRepositories({ activities, uploads, interpretationResults });
}

test("integration: cross-file, cross-format merge within one activity", async () => {
  const repos = buildFixtureRepos();
  const service = buildService(repos);
  await service.buildForProject("project-1");

  const merged = repos.knowledgeEntities.find(
    (entity) =>
      entity.entityType === "indicator" &&
      entity.canonicalLabel.toLowerCase() === "completion rate" &&
      entity.description.startsWith("share of submitted mentor applications"),
  );
  assert.ok(merged, "expected the CSV+PDF completion-rate entity to exist");
  assert.equal(merged!.sourceInstances.length, 2);
  const uploadIdsUsed = merged!.sourceInstances.map(
    (instance) => instance.uploadMetadataId,
  );
  assert.deepEqual(
    new Set(uploadIdsUsed),
    new Set(["upload-recruitment-csv", "upload-recruitment-pdf"]),
    "the merge must span the CSV and PDF uploads, proving cross-file-type merging works",
  );
});

test("integration: identical label with an unrelated description in the same activity stays separate", async () => {
  const repos = buildFixtureRepos();
  const service = buildService(repos);
  await service.buildForProject("project-1");

  const completionRateEntities = repos.knowledgeEntities.filter(
    (entity) =>
      entity.entityType === "indicator" &&
      entity.canonicalLabel.toLowerCase() === "completion rate" &&
      entity.sourceInstances.some(
        (instance) => instance.activityId === "act-recruitment",
      ),
  );

  // Two distinct "Completion rate" entities within act-recruitment: the
  // merged application-completion one (2 instances) and the standalone
  // interview-slot one (1 instance) — never merged together despite the
  // identical label, because their descriptions don't clear the Tier 2
  // similarity threshold.
  assert.equal(completionRateEntities.length, 2);
  assert.deepEqual(
    completionRateEntities
      .map((entity) => entity.sourceInstances.length)
      .sort(),
    [1, 2],
  );
});

test("integration: identical wording across two different activities never merges", async () => {
  const repos = buildFixtureRepos();
  const service = buildService(repos);
  await service.buildForProject("project-1");

  const recruitmentEntity = repos.knowledgeEntities.find(
    (entity) =>
      entity.entityType === "indicator" &&
      entity.sourceInstances.some(
        (instance) => instance.activityId === "act-recruitment",
      ) &&
      entity.description.startsWith("share of submitted mentor applications"),
  );
  const trainingEntity = repos.knowledgeEntities.find(
    (entity) =>
      entity.entityType === "indicator" &&
      entity.sourceInstances.some(
        (instance) => instance.activityId === "act-training",
      ),
  );

  assert.ok(recruitmentEntity);
  assert.ok(trainingEntity);
  assert.notEqual(recruitmentEntity!.id, trainingEntity!.id);
  assert.equal(
    trainingEntity!.sourceInstances.every(
      (instance) => instance.activityId === "act-training",
    ),
    true,
  );
});

test("integration: conflicting qualitative signals about the same indicator both survive as separate themes", async () => {
  const repos = buildFixtureRepos();
  const service = buildService(repos);
  await service.buildForProject("project-1");

  const sessionAttendanceEntity = repos.knowledgeEntities.find(
    (entity) =>
      entity.entityType === "indicator" &&
      entity.canonicalLabel === "Session attendance rate",
  );
  assert.ok(sessionAttendanceEntity);
  // The rejected duplicate from the feedback CSV must never attach.
  assert.equal(sessionAttendanceEntity!.sourceInstances.length, 1);

  const conflictingThemes = repos.knowledgeEntities.filter(
    (entity) =>
      entity.entityType === "theme" &&
      (entity.canonicalLabel === "Attendance strong in urban cohort pairs" ||
        entity.canonicalLabel === "Attendance weak in rural cohort pairs"),
  );
  assert.deepEqual(
    conflictingThemes.map((entity) => entity.canonicalLabel).sort(),
    [
      "Attendance strong in urban cohort pairs",
      "Attendance weak in rural cohort pairs",
    ],
  );
});

test("integration: a context_only finding still produces a theme entity", async () => {
  const repos = buildFixtureRepos();
  const service = buildService(repos);
  await service.buildForProject("project-1");

  const contextOnlyTheme = repos.knowledgeEntities.find(
    (entity) =>
      entity.entityType === "theme" &&
      entity.canonicalLabel === "Case studies show strong long-term outcomes",
  );
  assert.ok(contextOnlyTheme, "the theme entity should still be created");
});

test("integration: an unacknowledged activity's identical-looking data never attaches", async () => {
  const repos = buildFixtureRepos();
  const service = buildService(repos);
  await service.buildForProject("project-1");

  const employmentEntity = repos.knowledgeEntities.find(
    (entity) =>
      entity.entityType === "indicator" &&
      entity.canonicalLabel === "Employment placement rate",
  );
  assert.ok(employmentEntity);
  assert.equal(employmentEntity!.sourceInstances.length, 1);
  assert.equal(
    employmentEntity!.sourceInstances[0]?.activityId,
    "act-outcomes",
  );
});

test("integration: provenance is complete for every entity", async () => {
  const repos = buildFixtureRepos();
  const service = buildService(repos);
  await service.buildForProject("project-1");

  const acknowledgedActivityIds = new Set(
    activities
      .filter((activity) => activity.interpretationAcknowledgedAt !== null)
      .map((activity) => activity.id),
  );
  const knownUploadIds = new Set(uploads.map((upload) => upload.id));
  const knownResultIds = new Set(
    interpretationResults.map((result) => result.id),
  );

  assert.ok(
    repos.knowledgeEntities.length > 0,
    "sanity check: the build produced entities",
  );

  for (const entity of repos.knowledgeEntities) {
    assert.ok(
      entity.sourceInstances.length > 0,
      `entity ${entity.id} (${entity.canonicalLabel}) has no provenance at all`,
    );
    for (const instance of entity.sourceInstances) {
      assert.ok(acknowledgedActivityIds.has(instance.activityId));
      assert.ok(knownUploadIds.has(instance.uploadMetadataId));
      assert.ok(knownResultIds.has(instance.interpretationResultId));
      assert.ok(instance.sourceReference.length > 0);
    }
  }

  // Confirms the mixed-format claim itself: entities in this build really
  // do trace back to all four file types, not just whichever the builder
  // happened to process first.
  const contentTypesUsed = new Set(
    repos.knowledgeEntities
      .flatMap((entity) => entity.sourceInstances)
      .map((instance) => {
        const upload = uploads.find(
          (candidate) => candidate.id === instance.uploadMetadataId,
        );
        return upload?.contentType ?? "unknown";
      }),
  );
  assert.ok(contentTypesUsed.has("text/csv"));
  assert.ok(contentTypesUsed.has("application/pdf"));
  assert.ok(
    contentTypesUsed.has(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
  );
  assert.ok(
    contentTypesUsed.has(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  );
});

test("integration: re-running an interpretation replaces the old value, it doesn't accumulate alongside it", async () => {
  const repos = buildFixtureRepos();
  const service = buildService(repos);
  await service.buildForProject("project-1");

  const beforeRerun = repos.knowledgeEntities.find(
    (entity) =>
      entity.entityType === "indicator" &&
      entity.canonicalLabel === "Match success rate",
  );
  assert.ok(beforeRerun);
  assert.equal(beforeRerun!.sourceInstances.length, 1);

  // The mentee-matching CSV is re-processed and produces a new
  // InterpretationResult version with a corrected description for what
  // is conceptually the same indicator. findLatestByUploadMetadataIds
  // now returns only the new version — the old result id is gone, so
  // pruneStaleSourceInstances must drop the stale source instance (and
  // delete the now-empty old entity) while normalize()/deduplicateAndMerge
  // picks up the new one as a fresh candidate.
  const rerunResults = interpretationResults
    .filter((result) => result.uploadMetadataId !== "upload-matching-csv")
    .concat(
      makeInterpretationResult({
        id: "result-matching-csv-v2",
        activityId: "act-matching",
        uploadMetadataId: "upload-matching-csv",
        previousInterpretationResultId: "result-matching-csv",
        versionNumber: 2,
        indicators: [
          indicator({
            id: "ind-matching-1-v2",
            name: "Match success rate",
            description:
              "share of mentees matched with an available mentor within 30 days, corrected to exclude withdrawn applications",
          }),
        ],
      }),
    );
  repos.interpretationResultRepository.findLatestByUploadMetadataIds =
    (async () =>
      rerunResults) as InterpretationResultRepository["findLatestByUploadMetadataIds"];

  await service.buildForProject("project-1");

  const matchEntities = repos.knowledgeEntities.filter(
    (entity) =>
      entity.entityType === "indicator" &&
      entity.canonicalLabel === "Match success rate",
  );
  assert.equal(
    matchEntities.length,
    1,
    "the stale pre-rerun entity must be deleted, not left alongside the new one",
  );
  assert.equal(matchEntities[0]?.sourceInstances.length, 1);
  assert.equal(
    matchEntities[0]?.sourceInstances[0]?.interpretationResultId,
    "result-matching-csv-v2",
  );
  assert.match(
    matchEntities[0]!.description,
    /corrected to exclude withdrawn applications/,
  );
});

test("integration: rebuilding twice over unchanged input is idempotent across the whole project", async () => {
  const repos = buildFixtureRepos();
  const service = buildService(repos);

  await service.buildForProject("project-1");
  const entityCountAfterFirstBuild = repos.knowledgeEntities.length;
  const sourceInstanceCountsAfterFirstBuild = repos.knowledgeEntities
    .map((entity) => entity.sourceInstances.length)
    .sort();

  await service.buildForProject("project-1");

  assert.equal(repos.knowledgeEntities.length, entityCountAfterFirstBuild);
  assert.deepEqual(
    repos.knowledgeEntities
      .map((entity) => entity.sourceInstances.length)
      .sort(),
    sourceInstanceCountsAfterFirstBuild,
  );
});
