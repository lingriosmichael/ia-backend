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
    const originalFileName = file.filename || "upload";
    const extension = path.extname(originalFileName).toLowerCase();
    const allowedMimeTypes = supportedDatasetMimeTypesByExtension[extension];

    if (!allowedMimeTypes || !allowedMimeTypes.has(file.mimetype || "")) {
      throw new AppError(
        "Only CSV, Excel, PDF, and DOCX files are supported.",
        400,
        "unsupported_file_type",
      );
    }

    const fileBuffer = await file.toBuffer();
    if (fileBuffer.byteLength === 0) {
      throw new AppError("Uploaded file is empty.", 400, "empty_file");
    }

    const activityDirectory = path.resolve(this.uploadDir, activityId);
    await mkdir(activityDirectory, { recursive: true });

    const storedFileName = `${Date.now()}-${sanitizeFileName(originalFileName)}`;
    const absolutePath = path.join(activityDirectory, storedFileName);

    await writeFile(absolutePath, fileBuffer);

    return {
      originalFileName,
      contentType: file.mimetype || null,
      sizeBytes: fileBuffer.byteLength,
      storageKey: path.relative(this.uploadDir, absolutePath),
      absolutePath,
    };
  }

  async storeOrganizationLogo(organizationId: string, file: MultipartFile) {
    const originalFileName = file.filename || "organization-logo";
    const extension = path.extname(originalFileName).toLowerCase();

    if (
      !supportedLogoExtensions.has(extension) ||
      !supportedLogoMimeTypes.has(file.mimetype || "")
    ) {
      throw new AppError(
        "Only PNG, JPG, JPEG, and WebP images are supported.",
        400,
        "unsupported_logo_type",
      );
    }

    const fileBuffer = await file.toBuffer();
    if (fileBuffer.byteLength === 0) {
      throw new AppError("Uploaded file is empty.", 400, "empty_file");
    }

    const organizationDirectory = path.resolve(
      this.uploadDir,
      "organizations",
      organizationId,
    );
    await mkdir(organizationDirectory, { recursive: true });

    const storedFileName = `${Date.now()}-${sanitizeFileName(originalFileName)}`;
    const absolutePath = path.join(organizationDirectory, storedFileName);

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
