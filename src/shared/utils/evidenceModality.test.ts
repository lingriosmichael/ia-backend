import assert from "node:assert/strict";
import test from "node:test";
import { classifyEvidenceModalityFromPayload } from "./evidenceModality.js";

test("classifies structured quantitative evidence from numeric and categorical columns", () => {
  const modality = classifyEvidenceModalityFromPayload({
    tables: [
      {
        rowCount: 3,
        columns: ["participantId", "status", "score"],
        columnProfiles: [
          {
            name: "participantId",
            dtype: "object",
            uniqueValueCount: 3,
            sampleValues: ["P1", "P2", "P3"],
          },
          {
            name: "status",
            dtype: "object",
            uniqueValueCount: 2,
            sampleValues: ["completed", "pending", "completed"],
          },
          {
            name: "score",
            dtype: "int64",
            uniqueValueCount: 3,
            sampleValues: [12, 15, 18],
          },
        ],
      },
    ],
    paragraphs: [],
  });

  assert.equal(modality, "structured_quantitative");
});

test("classifies structured qualitative evidence from long-text-heavy tables", () => {
  const modality = classifyEvidenceModalityFromPayload({
    tables: [
      {
        rowCount: 2,
        columns: ["participantId", "reflection"],
        columnProfiles: [
          {
            name: "participantId",
            dtype: "object",
            uniqueValueCount: 2,
            sampleValues: ["P1", "P2"],
          },
          {
            name: "reflection",
            dtype: "object",
            uniqueValueCount: 2,
            sampleValues: [
              "I feel much more confident speaking in school after joining the mentoring sessions.",
              "The weekly support helped me trust the group and participate more often.",
            ],
          },
        ],
      },
    ],
    paragraphs: [],
  });

  assert.equal(modality, "structured_qualitative");
});

test("classifies mixed evidence when tables and meaningful paragraphs are both present", () => {
  const modality = classifyEvidenceModalityFromPayload({
    tables: [
      {
        rowCount: 2,
        columns: ["status"],
        columnProfiles: [
          {
            name: "status",
            dtype: "object",
            uniqueValueCount: 2,
            sampleValues: ["completed", "pending"],
          },
        ],
      },
    ],
    paragraphs: [
      {
        text: "Participants repeatedly described higher confidence and a stronger sense of belonging after the programme.",
      },
    ],
  });

  assert.equal(modality, "mixed_dual_track");
});

test("classifies table-only mixed evidence when metric columns and long-text responses are both strong", () => {
  const modality = classifyEvidenceModalityFromPayload({
    tables: [
      {
        rowCount: 3,
        columns: ["participantId", "status", "sessionDate", "reflection"],
        columnProfiles: [
          {
            name: "participantId",
            dtype: "object",
            uniqueValueCount: 3,
            sampleValues: ["P1", "P2", "P3"],
          },
          {
            name: "status",
            dtype: "object",
            uniqueValueCount: 2,
            sampleValues: ["completed", "completed", "pending"],
          },
          {
            name: "sessionDate",
            dtype: "object",
            uniqueValueCount: 3,
            sampleValues: ["2026-07-01", "2026-07-08", "2026-07-15"],
          },
          {
            name: "reflection",
            dtype: "object",
            uniqueValueCount: 3,
            sampleValues: [
              "I now feel comfortable joining the group discussion and asking for help when I need it.",
              "Weekly mentoring gave me a clearer routine and made it easier to stay motivated in school.",
              "I attended less consistently this month, but I still feel more confident speaking to adults.",
            ],
          },
        ],
      },
    ],
    paragraphs: [],
  });

  assert.equal(modality, "mixed_dual_track");
});

test("classifies narrative qualitative evidence when only paragraphs are meaningful", () => {
  const modality = classifyEvidenceModalityFromPayload({
    tables: [],
    paragraphs: [
      {
        text: "Before the programme I stayed at home, but now I join the weekly meetings and feel safe contributing in the group.",
      },
    ],
  });

  assert.equal(modality, "narrative_qualitative");
});
