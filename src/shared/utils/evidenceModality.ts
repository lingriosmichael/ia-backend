import type { EvidenceModality } from "../contracts.js";
import {
  asRecord,
  asRecordArray,
  readNumber,
  readString,
} from "./unknownValueReaders.js";

const MIN_MEANINGFUL_TABLE_ROWS = 1;
const MIN_MEANINGFUL_TABLE_COLUMNS = 1;
const MIN_MEANINGFUL_PARAGRAPH_CHARS = 40;
const MIN_MEANINGFUL_TOTAL_TEXT_CHARS = 120;
const LONG_TEXT_AVERAGE_CHARS = 40;
const LONG_TEXT_SINGLE_SAMPLE_CHARS = 80;
const SHORT_CATEGORICAL_MAX_DISTINCT = 20;
const SHORT_CATEGORICAL_MAX_AVERAGE_CHARS = 30;
const MIN_ROUTING_HIGH_UTILITY = 0.45;
const ROUTING_IDENTIFIER_TERMS = [
  "id",
  "identifier",
  "uuid",
  "code",
  "reference",
  "participant",
  "person",
  "client",
  "mentor",
  "mentee",
] as const;
const ROUTING_STATUS_TERMS = [
  "status",
  "result",
  "outcome",
  "decision",
  "completed",
  "completion",
  "attendance",
  "attended",
  "recommended",
  "recommendation",
] as const;
const ROUTING_DATE_TERMS = ["date", "day", "week", "month", "year", "time"] as const;
const ROUTING_MEASURE_TERMS = [
  "count",
  "score",
  "amount",
  "total",
  "rate",
  "hours",
  "duration",
  "number",
] as const;
const ROUTING_LONG_TEXT_TERMS = [
  "note",
  "notes",
  "comment",
  "comments",
  "feedback",
  "reflection",
  "reflections",
  "response",
  "responses",
  "answer",
  "answers",
  "interview",
  "interviews",
  "quote",
  "quotes",
  "story",
  "stories",
] as const;

export function readEvidenceModality(value: unknown): EvidenceModality | null {
  return value === "structured_quantitative" ||
    value === "structured_qualitative" ||
    value === "mixed_dual_track" ||
    value === "narrative_qualitative" ||
    value === "insufficiently_extracted"
    ? value
    : null;
}

function readPrimitiveStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) =>
      typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"
        ? String(entry)
        : null,
    )
    .filter((entry): entry is string => entry !== null);
}

function hasMeaningfulTables(payload: Record<string, unknown>): boolean {
  const tables = asRecordArray(payload.tables);
  return tables.some((table) => {
    const rowCount = readNumber(table.rowCount) ?? 0;
    const columnCount = Array.isArray(table.columns) ? table.columns.length : 0;
    return (
      rowCount >= MIN_MEANINGFUL_TABLE_ROWS &&
      columnCount >= MIN_MEANINGFUL_TABLE_COLUMNS
    );
  });
}

function hasMeaningfulParagraphs(payload: Record<string, unknown>): boolean {
  const paragraphs = asRecordArray(payload.paragraphs);
  const meaningfulParagraphCount = paragraphs.filter((paragraph) => {
    const text = readString(paragraph.text);
    return Boolean(text && text.length >= MIN_MEANINGFUL_PARAGRAPH_CHARS);
  }).length;
  const totalTextChars = paragraphs.reduce((total, paragraph) => {
    const text = readString(paragraph.text);
    return total + (text?.length ?? 0);
  }, 0);

  return (
    meaningfulParagraphCount > 0 ||
    totalTextChars >= MIN_MEANINGFUL_TOTAL_TEXT_CHARS
  );
}

function looksNumeric(value: string): boolean {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) {
    return false;
  }
  return Number.isFinite(Number(normalized));
}

function looksDateLike(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  return (
    /^\d{4}-\d{2}-\d{2}/.test(normalized) ||
    /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(normalized) ||
    !Number.isNaN(Date.parse(normalized))
  );
}

function fieldNameTokens(fieldName: string): Set<string> {
  return new Set(fieldName.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function fieldNameContainsAny(
  fieldName: string,
  terms: readonly string[],
): boolean {
  const normalized = fieldName.toLowerCase();
  const tokens = fieldNameTokens(fieldName);

  return terms.some(
    (term) =>
      tokens.has(term) ||
      normalized.startsWith(term) ||
      normalized.endsWith(term) ||
      normalized.includes(`_${term}_`) ||
      normalized.includes(`-${term}-`),
  );
}

function clampRoutingScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function classifyTableOnlyModality(payload: Record<string, unknown>): EvidenceModality {
  const tables = asRecordArray(payload.tables);
  let quantitativeSignalColumns = 0;
  let longTextColumns = 0;
  let identifierLikeColumns = 0;
  let statusLikeColumns = 0;
  let dateLikeColumns = 0;
  let measureLikeColumns = 0;
  let freeTextNamedColumns = 0;
  let populatedLongTextColumns = 0;
  let totalColumns = 0;
  let totalRows = 0;

  for (const table of tables) {
    totalRows += readNumber(table.rowCount) ?? 0;
    const columnProfiles = asRecordArray(table.columnProfiles);
    for (const profile of columnProfiles) {
      totalColumns += 1;
      const columnName = readString(profile.name) ?? "";
      const dtype = readString(profile.dtype)?.toLowerCase() ?? "";
      const sampleValues = readPrimitiveStringArray(profile.sampleValues);
      const averageLength =
        sampleValues.length === 0
          ? 0
          : sampleValues.reduce((total, value) => total + value.length, 0) /
            sampleValues.length;
      const uniqueValueCount = readNumber(profile.uniqueValueCount) ?? sampleValues.length;

      const numericHint =
        dtype.includes("int") ||
        dtype.includes("float") ||
        (sampleValues.length > 0 && sampleValues.every(looksNumeric));
      const dateHint =
        dtype.includes("date") ||
        dtype.includes("time") ||
        (sampleValues.length > 0 &&
          sampleValues.filter(looksDateLike).length >=
            Math.ceil(sampleValues.length / 2));
      const longTextHint =
        averageLength >= LONG_TEXT_AVERAGE_CHARS ||
        sampleValues.some((value) => value.length >= LONG_TEXT_SINGLE_SAMPLE_CHARS);
      const shortCategoricalHint =
        !numericHint &&
        !dateHint &&
        !longTextHint &&
        uniqueValueCount >= 2 &&
        uniqueValueCount <= SHORT_CATEGORICAL_MAX_DISTINCT &&
        averageLength <= SHORT_CATEGORICAL_MAX_AVERAGE_CHARS;

      if (longTextHint) {
        longTextColumns += 1;
      }
      if (longTextHint && sampleValues.filter((value) => value.trim().length > 0).length >= 2) {
        populatedLongTextColumns += 1;
      }
      if (numericHint || dateHint || shortCategoricalHint) {
        quantitativeSignalColumns += 1;
      }
      if (fieldNameContainsAny(columnName, ROUTING_IDENTIFIER_TERMS)) {
        identifierLikeColumns += 1;
      }
      if (fieldNameContainsAny(columnName, ROUTING_STATUS_TERMS)) {
        statusLikeColumns += 1;
      }
      if (dateHint || fieldNameContainsAny(columnName, ROUTING_DATE_TERMS)) {
        dateLikeColumns += 1;
      }
      if (numericHint || fieldNameContainsAny(columnName, ROUTING_MEASURE_TERMS)) {
        measureLikeColumns += 1;
      }
      if (longTextHint || fieldNameContainsAny(columnName, ROUTING_LONG_TEXT_TERMS)) {
        freeTextNamedColumns += 1;
      }
    }
  }

  const quantitativeColumnRatio =
    totalColumns === 0 ? 0 : quantitativeSignalColumns / totalColumns;
  const longTextColumnRatio = totalColumns === 0 ? 0 : longTextColumns / totalColumns;
  const structuredMetricCueRatio =
    [
      identifierLikeColumns > 0,
      statusLikeColumns > 0,
      dateLikeColumns > 0,
      measureLikeColumns > 0,
    ].filter(Boolean).length / 4;
  const textualCueRatio =
    [
      longTextColumns > 0,
      populatedLongTextColumns > 0,
      freeTextNamedColumns > 0,
    ].filter(Boolean).length / 3;

  const quantitativeUtilityScore = clampRoutingScore(
    Math.min(totalRows / 50, 1) * 0.15 +
      quantitativeColumnRatio * 0.45 +
      structuredMetricCueRatio * 0.4,
  );
  const qualitativeUtilityScore = clampRoutingScore(
    Math.min(totalRows / 30, 1) * 0.15 +
      longTextColumnRatio * 0.45 +
      textualCueRatio * 0.4,
  );

  if (
    qualitativeUtilityScore >= MIN_ROUTING_HIGH_UTILITY &&
    quantitativeUtilityScore >= MIN_ROUTING_HIGH_UTILITY
  ) {
    return "mixed_dual_track";
  }

  if (qualitativeUtilityScore >= MIN_ROUTING_HIGH_UTILITY) {
    return "structured_qualitative";
  }

  return "structured_quantitative";
}

export function classifyEvidenceModalityFromPayload(
  payloadValue: unknown,
): EvidenceModality {
  const payload = asRecord(payloadValue);
  const metadata = asRecord(payload.metadata);
  const metadataValue = readEvidenceModality(metadata.evidenceModality);
  if (metadataValue) {
    return metadataValue;
  }

  const meaningfulTables = hasMeaningfulTables(payload);
  const meaningfulParagraphs = hasMeaningfulParagraphs(payload);

  if (meaningfulTables && meaningfulParagraphs) {
    return "mixed_dual_track";
  }
  if (meaningfulTables) {
    return classifyTableOnlyModality(payload);
  }
  if (meaningfulParagraphs) {
    return "narrative_qualitative";
  }

  return "insufficiently_extracted";
}

export function isEvidenceModalitySupported(
  evidenceModality: EvidenceModality,
): boolean {
  return evidenceModality !== "insufficiently_extracted";
}

export function getEvidenceModalitySupportState(
  evidenceModality: EvidenceModality,
): "supported" | "insufficiently_extracted" {
  return evidenceModality === "insufficiently_extracted"
    ? "insufficiently_extracted"
    : "supported";
}
