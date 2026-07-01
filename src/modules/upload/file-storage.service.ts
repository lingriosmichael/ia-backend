import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MultipartFile } from "@fastify/multipart";
import { AppError } from "../../shared/errors/app-error.js";

const supportedDatasetExtensions = new Set([".csv", ".xlsx", ".xls"]);
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

    if (!supportedDatasetExtensions.has(extension)) {
      throw new AppError(
        "Only CSV and Excel files are supported.",
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
      throw new AppError("Stored file could not be found.", 404, "file_not_found");
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
