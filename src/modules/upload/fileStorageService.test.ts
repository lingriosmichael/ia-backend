import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { MultipartFile } from "@fastify/multipart";
import { AppError } from "../../shared/errors/appError.js";
import {
  FileStorageService,
  maxUploadFileNameLength,
} from "./fileStorageService.js";

function createMultipartFile(input: {
  filename: string;
  mimetype: string;
  content: Buffer | string;
}) {
  return {
    filename: input.filename,
    mimetype: input.mimetype,
    file: Readable.from([
      Buffer.isBuffer(input.content)
        ? input.content
        : Buffer.from(input.content, "utf8"),
    ]),
  } as MultipartFile;
}

test("storeActivityUpload preserves a Unicode filename while generating an internal storage key", async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), "brindl-upload-test-"));
  const service = new FileStorageService(uploadDir);

  const storedFile = await service.storeActivityUpload(
    "activity-1",
    createMultipartFile({
      filename: "Förderbericht März 2026.xlsx",
      mimetype:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: Buffer.from("PK\x03\x04test xlsx"),
    }),
  );

  assert.equal(storedFile.originalFileName, "Förderbericht März 2026.xlsx");
  assert.equal(path.extname(storedFile.storageKey), ".xlsx");
  assert.match(storedFile.storageKey, /^activity-1\/[0-9a-f-]+\.xlsx$/);
  assert.equal(storedFile.storageKey.includes("Förderbericht"), false);

  const persistedFile = await service.readStoredFile(storedFile.storageKey);
  assert.equal(
    persistedFile.buffer.subarray(0, 4).toString("binary"),
    "PK\u0003\u0004",
  );
});

test("storeActivityUpload rejects invalid path-like filenames", async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), "brindl-upload-test-"));
  const service = new FileStorageService(uploadDir);

  await assert.rejects(
    service.storeActivityUpload(
      "activity-1",
      createMultipartFile({
        filename: "../evidence.pdf",
        mimetype: "application/pdf",
        content: "%PDF-1.7 test",
      }),
    ),
    (error: unknown) =>
      error instanceof AppError && error.code === "invalid_file_name",
  );
});

test("storeActivityUpload rejects filenames longer than the supported limit", async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), "brindl-upload-test-"));
  const service = new FileStorageService(uploadDir);
  const longFileName = `${"a".repeat(maxUploadFileNameLength)}.pdf`;

  await assert.rejects(
    service.storeActivityUpload(
      "activity-1",
      createMultipartFile({
        filename: longFileName,
        mimetype: "application/pdf",
        content: "%PDF-1.7 test",
      }),
    ),
    (error: unknown) =>
      error instanceof AppError && error.code === "file_name_too_long",
  );
});

test("storeActivityUpload rejects files whose contents do not match the selected type", async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), "brindl-upload-test-"));
  const service = new FileStorageService(uploadDir);

  await assert.rejects(
    service.storeActivityUpload(
      "activity-1",
      createMultipartFile({
        filename: "report.pdf",
        mimetype: "application/pdf",
        content: "not a pdf",
      }),
    ),
    (error: unknown) =>
      error instanceof AppError && error.code === "invalid_file_contents",
  );
});

test("storeActivityUpload accepts generic browser mime types when the extension and contents are valid", async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), "brindl-upload-test-"));
  const service = new FileStorageService(uploadDir);

  const storedFile = await service.storeActivityUpload(
    "activity-1",
    createMultipartFile({
      filename: "förderbericht.pdf",
      mimetype: "application/octet-stream",
      content: "%PDF-1.7 test",
    }),
  );

  assert.equal(storedFile.originalFileName, "förderbericht.pdf");
  assert.equal(path.extname(storedFile.storageKey), ".pdf");
});
