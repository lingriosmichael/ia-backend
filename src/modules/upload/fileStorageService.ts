import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MultipartFile } from "@fastify/multipart";
import { AppError } from "../../shared/errors/appError.js";

// Mirrors the extension+MIME check already used for logo uploads below.
// CSV/XLS in particular have more real-world MIME variance across
// browsers/OSes than image types, so each extension allows a small set of
// known-legitimate MIME types rather than a single canonical value.
const supportedDatasetMimeTypesByExtension: Record<string, Set<string>> = {
  ".csv": new Set(["text/csv", "application/vnd.ms-excel", "application/csv"]),
  ".xlsx": new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  ".xls": new Set(["application/vnd.ms-excel"]),
  ".pdf": new Set(["application/pdf"]),
  ".docx": new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
};
const supportedLogoExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const supportedLogoMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export class FileStorageService {
  constructor(private readonly uploadDir: string) {}

  async storeActivityUpload(activityId: string, file: MultipartFile) {
    return this.persistUploadedFile({
      directorySegments: [activityId],
      file,
      defaultFileName: "upload",
      isSupportedType: (extension, mimeType) =>
        Boolean(supportedDatasetMimeTypesByExtension[extension]?.has(mimeType)),
      unsupportedTypeMessage:
        "Only CSV, Excel, PDF, and DOCX files are supported.",
      unsupportedTypeCode: "unsupported_file_type",
    });
  }

  async storeOrganizationLogo(organizationId: string, file: MultipartFile) {
    return this.persistUploadedFile({
      directorySegments: ["organizations", organizationId],
      file,
      defaultFileName: "organization-logo",
      isSupportedType: (extension, mimeType) =>
        supportedLogoExtensions.has(extension) &&
        supportedLogoMimeTypes.has(mimeType),
      unsupportedTypeMessage:
        "Only PNG, JPG, JPEG, and WebP images are supported.",
      unsupportedTypeCode: "unsupported_logo_type",
    });
  }

  // Shared by storeActivityUpload/storeOrganizationLogo: both validate an
  // extension+MIME allowlist, reject empty files, then write into a
  // dedicated subdirectory under a timestamp-prefixed, sanitized filename —
  // only the allowlist and target subdirectory actually differ between them.
  private async persistUploadedFile({
    directorySegments,
    file,
    defaultFileName,
    isSupportedType,
    unsupportedTypeMessage,
    unsupportedTypeCode,
  }: {
    directorySegments: string[];
    file: MultipartFile;
    defaultFileName: string;
    isSupportedType: (extension: string, mimeType: string) => boolean;
    unsupportedTypeMessage: string;
    unsupportedTypeCode: string;
  }) {
    const originalFileName = file.filename || defaultFileName;
    const extension = path.extname(originalFileName).toLowerCase();

    if (!isSupportedType(extension, file.mimetype || "")) {
      throw new AppError(unsupportedTypeMessage, 400, unsupportedTypeCode);
    }

    const fileBuffer = await file.toBuffer();
    if (fileBuffer.byteLength === 0) {
      throw new AppError("Uploaded file is empty.", 400, "empty_file");
    }

    const targetDirectory = path.resolve(this.uploadDir, ...directorySegments);
    await mkdir(targetDirectory, { recursive: true });

    const storedFileName = `${Date.now()}-${sanitizeFileName(originalFileName)}`;
    const absolutePath = path.join(targetDirectory, storedFileName);

    await writeFile(absolutePath, fileBuffer);

    return {
      originalFileName,
      contentType: file.mimetype || null,
      sizeBytes: fileBuffer.byteLength,
      storageKey: path.relative(this.uploadDir, absolutePath),
      absolutePath,
    };
  }

  async readStoredFile(storageKey: string) {
    const absolutePath = this.resolveStoragePath(storageKey);

    try {
      const buffer = await readFile(absolutePath);

      return {
        absolutePath,
        buffer,
      };
    } catch {
      throw new AppError(
        "Stored file could not be found.",
        404,
        "file_not_found",
      );
    }
  }

  getContentTypeForPath(storageKey: string) {
    const extension = path.extname(storageKey).toLowerCase();

    if (extension === ".png") {
      return "image/png";
    }

    if (extension === ".jpg" || extension === ".jpeg") {
      return "image/jpeg";
    }

    if (extension === ".webp") {
      return "image/webp";
    }

    if (extension === ".csv") {
      return "text/csv";
    }

    if (extension === ".xlsx") {
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    }

    if (extension === ".xls") {
      return "application/vnd.ms-excel";
    }

    if (extension === ".pdf") {
      return "application/pdf";
    }

    if (extension === ".doc") {
      return "application/msword";
    }

    if (extension === ".docx") {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }

    return "application/octet-stream";
  }

  async deleteStoredFiles(storageKeys: string[]) {
    const uniqueStorageKeys = [...new Set(storageKeys.filter(Boolean))];

    for (const storageKey of uniqueStorageKeys) {
      const absolutePath = this.resolveStoragePath(storageKey);
      await rm(absolutePath, { force: true });
    }
  }

  private resolveStoragePath(storageKey: string) {
    const uploadRoot = path.resolve(this.uploadDir);
    const absolutePath = path.resolve(uploadRoot, storageKey);

    if (
      absolutePath !== uploadRoot &&
      !absolutePath.startsWith(`${uploadRoot}${path.sep}`)
    ) {
      throw new AppError("Invalid storage path.", 400, "invalid_storage_path");
    }

    return absolutePath;
  }
}
