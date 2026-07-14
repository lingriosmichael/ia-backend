import type { InterpretationDataType } from "../contracts.js";
import {
  asRecord,
  asRecordArray,
  readNumber,
  readString,
} from "./unknownValueReaders.js";

export function readInterpretationDataType(
  value: unknown,
): InterpretationDataType | null {
  return value === "tabular_structured" ||
    value === "text_narrative" ||
    value === "mixed_structured_text" ||
    value === "insufficiently_extracted"
    ? value
    : null;
}

const MIN_MEANINGFUL_TABLE_ROWS = 1;
const MIN_MEANINGFUL_TABLE_COLUMNS = 1;
const MIN_MEANINGFUL_PARAGRAPH_CHARS = 40;
const MIN_MEANINGFUL_TOTAL_TEXT_CHARS = 120;

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

export function classifyInterpretationDataTypeFromPayload(
  payloadValue: unknown,
): InterpretationDataType {
  const payload = asRecord(payloadValue);
  const metadata = asRecord(payload.metadata);
  const metadataValue = readInterpretationDataType(
    metadata.interpretationDataType,
  );
  if (metadataValue) {
    return metadataValue;
  }

  const meaningfulTables = hasMeaningfulTables(payload);
  const meaningfulParagraphs = hasMeaningfulParagraphs(payload);

  if (meaningfulTables && meaningfulParagraphs) {
    return "mixed_structured_text";
  }

  if (meaningfulTables) {
    return "tabular_structured";
  }

  if (meaningfulParagraphs) {
    return "text_narrative";
  }

  return "insufficiently_extracted";
}

export function isInterpretationDataTypeSupported(
  interpretationDataType: InterpretationDataType,
): boolean {
  return interpretationDataType !== "insufficiently_extracted";
}

export function getInterpretationSupportState(
  interpretationDataType: InterpretationDataType,
): "supported" | "not_supported_yet" | "insufficiently_extracted" {
  return interpretationDataType === "insufficiently_extracted"
    ? "insufficiently_extracted"
    : "supported";
}
