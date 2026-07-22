import { createHash, createHmac } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import type { BackendConfig } from "../../shared/config/env.js";
import { AppError } from "../../shared/errors/appError.js";

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
const emptyPayloadSha256 = createHash("sha256").update("").digest("hex");

interface StoredFileWriteResult {
  originalFileName: string;
  contentType: string | null;
  sizeBytes: number;
  storageKey: string;
  absolutePath?: string;
}

interface StoredFileReadResult {
  buffer: Buffer;
  absolutePath?: string;
}

interface StoredFileStreamResult {
  stream: Readable;
  absolutePath?: string;
}

type FileStorageConfig =
  | {
      driver: "local";
      uploadDir: string;
    }
  | {
      driver: "s3";
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      keyPrefix: string;
      forcePathStyle: boolean;
    };

interface FileWriteInput {
  storageKey: string;
  sourceFilePath: string;
  contentType: string | null;
  sizeBytes: number;
}

interface FileStorageBackend {
  writeFile(input: FileWriteInput): Promise<{ absolutePath?: string }>;
  readObject(storageKey: string): Promise<StoredFileReadResult>;
  openReadStream(storageKey: string): Promise<StoredFileStreamResult>;
  deleteObjects(storageKeys: string[]): Promise<void>;
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function normalizeStorageKeySegment(segment: string) {
  return segment
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((part) => sanitizeFileName(part))
    .join("/");
}

function normalizeStorageKey(storageKey: string) {
  const normalized = storageKey
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .join("/");

  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new AppError("Invalid storage path.", 400, "invalid_storage_path");
  }

  return normalized;
}

function buildStorageKey(
  directorySegments: string[],
  originalFileName: string,
): string {
  const normalizedDirectorySegments = directorySegments
    .map(normalizeStorageKeySegment)
    .filter(Boolean);
  const storedFileName = `${Date.now()}-${sanitizeFileName(originalFileName)}`;

  return normalizeStorageKey(
    path.posix.join(...normalizedDirectorySegments, storedFileName),
  );
}

function sha256Hex(input: Buffer | string) {
  return createHash("sha256").update(input).digest("hex");
}

async function sha256FileHex(filePath: string) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }

  return hash.digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function collectResponseBuffer(response: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of response) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

class LocalFileStorageBackend implements FileStorageBackend {
  constructor(private readonly uploadDir: string) {}

  async writeFile(input: FileWriteInput): Promise<{ absolutePath: string }> {
    const absolutePath = this.resolveStoragePath(input.storageKey);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    try {
      await rename(input.sourceFilePath, absolutePath);
    } catch {
      await copyFile(input.sourceFilePath, absolutePath);
      await rm(input.sourceFilePath, { force: true });
    }

    return { absolutePath };
  }

  async readObject(storageKey: string): Promise<StoredFileReadResult> {
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

  async openReadStream(storageKey: string): Promise<StoredFileStreamResult> {
    const absolutePath = this.resolveStoragePath(storageKey);

    try {
      await stat(absolutePath);
    } catch {
      throw new AppError(
        "Stored file could not be found.",
        404,
        "file_not_found",
      );
    }

    return {
      absolutePath,
      stream: createReadStream(absolutePath),
    };
  }

  async deleteObjects(storageKeys: string[]): Promise<void> {
    const uniqueStorageKeys = [...new Set(storageKeys.filter(Boolean))];

    for (const storageKey of uniqueStorageKeys) {
      const absolutePath = this.resolveStoragePath(storageKey);
      await rm(absolutePath, { force: true });
    }
  }

  private resolveStoragePath(storageKey: string) {
    const normalizedStorageKey = normalizeStorageKey(storageKey);
    const uploadRoot = path.resolve(this.uploadDir);
    const absolutePath = path.resolve(
      uploadRoot,
      ...normalizedStorageKey.split("/"),
    );

    if (
      absolutePath !== uploadRoot &&
      !absolutePath.startsWith(`${uploadRoot}${path.sep}`)
    ) {
      throw new AppError("Invalid storage path.", 400, "invalid_storage_path");
    }

    return absolutePath;
  }
}

class S3FileStorageBackend implements FileStorageBackend {
  private readonly endpoint: URL;

  constructor(
    private readonly config: Extract<FileStorageConfig, { driver: "s3" }>,
  ) {
    this.endpoint = new URL(config.endpoint);
  }

  async writeFile(input: FileWriteInput): Promise<{ absolutePath?: string }> {
    const response = await this.sendSignedRequest("PUT", input.storageKey, {
      sourceFilePath: input.sourceFilePath,
      contentType: input.contentType ?? "application/octet-stream",
      contentLength: input.sizeBytes,
      payloadHash: await sha256FileHex(input.sourceFilePath),
    });
    const responseBody = await collectResponseBuffer(response);

    if (
      response.statusCode &&
      response.statusCode >= 200 &&
      response.statusCode < 300
    ) {
      return {};
    }

    throw new AppError(
      `Stored file could not be written to object storage.${responseBody.length > 0 ? ` Response: ${responseBody.toString("utf8")}` : ""}`,
      502,
      "file_storage_write_failed",
    );
  }

  async readObject(storageKey: string): Promise<StoredFileReadResult> {
    const response = await this.sendSignedRequest("GET", storageKey);
    const responseBody = await collectResponseBuffer(response);

    if (response.statusCode === 404) {
      throw new AppError(
        "Stored file could not be found.",
        404,
        "file_not_found",
      );
    }

    if (
      !response.statusCode ||
      response.statusCode < 200 ||
      response.statusCode >= 300
    ) {
      throw new AppError(
        "Stored file could not be read from object storage.",
        502,
        "file_storage_read_failed",
      );
    }

    return {
      buffer: responseBody,
    };
  }

  async openReadStream(storageKey: string): Promise<StoredFileStreamResult> {
    const response = await this.sendSignedRequest("GET", storageKey);

    if (response.statusCode === 404) {
      await collectResponseBuffer(response);
      throw new AppError(
        "Stored file could not be found.",
        404,
        "file_not_found",
      );
    }

    if (
      !response.statusCode ||
      response.statusCode < 200 ||
      response.statusCode >= 300
    ) {
      const responseBody = await collectResponseBuffer(response);
      throw new AppError(
        `Stored file could not be streamed from object storage.${responseBody.length > 0 ? ` Response: ${responseBody.toString("utf8")}` : ""}`,
        502,
        "file_storage_read_failed",
      );
    }

    return {
      stream: response,
    };
  }

  async deleteObjects(storageKeys: string[]): Promise<void> {
    const uniqueStorageKeys = [...new Set(storageKeys.filter(Boolean))];

    for (const storageKey of uniqueStorageKeys) {
      const response = await this.sendSignedRequest("DELETE", storageKey);
      const responseBody = await collectResponseBuffer(response);

      if (response.statusCode === 404) {
        continue;
      }

      if (
        response.statusCode &&
        response.statusCode >= 200 &&
        response.statusCode < 300
      ) {
        continue;
      }

      throw new AppError(
        `Stored file could not be deleted from object storage.${responseBody.length > 0 ? ` Response: ${responseBody.toString("utf8")}` : ""}`,
        502,
        "file_storage_delete_failed",
      );
    }
  }

  private async sendSignedRequest(
    method: "GET" | "PUT" | "DELETE",
    storageKey: string,
    input?: {
      sourceFilePath?: string;
      contentType?: string;
      contentLength?: number;
      payloadHash?: string;
    },
  ) {
    const objectKey = this.buildObjectKey(storageKey);
    const requestUrl = this.buildRequestUrl(objectKey);
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = input?.payloadHash ?? emptyPayloadSha256;

    const headers: Record<string, string> = {
      host: requestUrl.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };

    if (input?.contentType) {
      headers["content-type"] = input.contentType;
    }

    if (input?.contentLength !== undefined) {
      headers["content-length"] = String(input.contentLength);
    }

    const sortedHeaderEntries = Object.entries(headers).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    const signedHeaders = sortedHeaderEntries.map(([key]) => key).join(";");
    const canonicalHeaders = sortedHeaderEntries
      .map(([key, value]) => `${key}:${value.trim()}\n`)
      .join("");
    const canonicalRequest = [
      method,
      requestUrl.pathname,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signingKey = hmac(
      hmac(
        hmac(
          hmac(`AWS4${this.config.secretAccessKey}`, dateStamp),
          this.config.region,
        ),
        "s3",
      ),
      "aws4_request",
    );
    const signature = createHmac("sha256", signingKey)
      .update(stringToSign)
      .digest("hex");

    headers.authorization = [
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", ");

    const transport = requestUrl.protocol === "http:" ? http : https;

    return new Promise<IncomingMessage>((resolve, reject) => {
      const request = transport.request(
        requestUrl,
        {
          method,
          headers,
        },
        (response) => resolve(response),
      );

      request.on("error", reject);

      if (!input?.sourceFilePath) {
        request.end();
        return;
      }

      pipeline(createReadStream(input.sourceFilePath), request).catch(reject);
    });
  }

  private buildObjectKey(storageKey: string) {
    const normalizedStorageKey = normalizeStorageKey(storageKey);

    if (!this.config.keyPrefix) {
      return normalizedStorageKey;
    }

    return normalizeStorageKey(
      path.posix.join(this.config.keyPrefix, normalizedStorageKey),
    );
  }

  private buildRequestUrl(objectKey: string) {
    const url = new URL(this.endpoint);
    const basePath = url.pathname.replace(/\/+$/, "");
    const encodedObjectKey = objectKey
      .split("/")
      .map((segment) => encodeRfc3986(segment))
      .join("/");

    if (this.config.forcePathStyle) {
      url.pathname = `${basePath}/${encodeRfc3986(this.config.bucket)}/${encodedObjectKey}`;
      return url;
    }

    url.hostname = `${this.config.bucket}.${url.hostname}`;
    url.pathname = `${basePath}/${encodedObjectKey}`;
    return url;
  }
}

export class FileStorageService {
  private readonly backend: FileStorageBackend;
  private readonly uploadSpoolDirectory: string;

  constructor(config: string | FileStorageConfig) {
    if (typeof config === "string") {
      this.backend = new LocalFileStorageBackend(config);
      this.uploadSpoolDirectory = path.resolve(config, ".upload-spool");
      return;
    }

    this.backend =
      config.driver === "s3"
        ? new S3FileStorageBackend(config)
        : new LocalFileStorageBackend(config.uploadDir);
    this.uploadSpoolDirectory =
      config.driver === "local"
        ? path.resolve(config.uploadDir, ".upload-spool")
        : path.resolve(tmpdir(), "impact-atlas-upload-spool");
  }

  static fromConfig(config: BackendConfig) {
    if (config.FILE_STORAGE_DRIVER === "s3") {
      return new FileStorageService({
        driver: "s3",
        endpoint: config.S3_ENDPOINT as string,
        region: config.S3_REGION as string,
        bucket: config.S3_BUCKET as string,
        accessKeyId: config.S3_ACCESS_KEY_ID as string,
        secretAccessKey: config.S3_SECRET_ACCESS_KEY as string,
        keyPrefix: config.S3_KEY_PREFIX?.trim().replace(/^\/+|\/+$/g, "") ?? "",
        forcePathStyle: config.S3_FORCE_PATH_STYLE,
      });
    }

    return new FileStorageService({
      driver: "local",
      uploadDir: config.UPLOAD_DIR,
    });
  }

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

  async readStoredFile(storageKey: string) {
    return this.backend.readObject(storageKey);
  }

  async openStoredFileStream(storageKey: string) {
    return this.backend.openReadStream(storageKey);
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
    await this.backend.deleteObjects(storageKeys);
  }

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
  }): Promise<StoredFileWriteResult> {
    const originalFileName = file.filename || defaultFileName;
    const extension = path.extname(originalFileName).toLowerCase();

    if (!isSupportedType(extension, file.mimetype || "")) {
      throw new AppError(unsupportedTypeMessage, 400, unsupportedTypeCode);
    }

    const spooledFile = await this.spoolUploadToTempFile(
      file,
      originalFileName,
    );

    if (spooledFile.sizeBytes === 0) {
      await rm(spooledFile.tempDirectory, { recursive: true, force: true });
      throw new AppError("Uploaded file is empty.", 400, "empty_file");
    }

    const storageKey = buildStorageKey(directorySegments, originalFileName);

    try {
      const writeResult = await this.backend.writeFile({
        storageKey,
        sourceFilePath: spooledFile.tempFilePath,
        contentType: file.mimetype || null,
        sizeBytes: spooledFile.sizeBytes,
      });

      return {
        originalFileName,
        contentType: file.mimetype || null,
        sizeBytes: spooledFile.sizeBytes,
        storageKey,
        absolutePath: writeResult.absolutePath,
      };
    } finally {
      await rm(spooledFile.tempDirectory, { recursive: true, force: true });
    }
  }

  private async spoolUploadToTempFile(
    file: MultipartFile,
    originalFileName: string,
  ) {
    await mkdir(this.uploadSpoolDirectory, { recursive: true });
    const tempDirectory = await mkdtemp(
      path.join(this.uploadSpoolDirectory, "upload-"),
    );
    const tempFilePath = path.join(
      tempDirectory,
      sanitizeFileName(originalFileName),
    );
    let sizeBytes = 0;

    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        sizeBytes += Buffer.isBuffer(chunk)
          ? chunk.byteLength
          : Buffer.byteLength(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(file.file, counter, createWriteStream(tempFilePath));
    } catch (error) {
      await rm(tempDirectory, { recursive: true, force: true });
      throw error;
    }

    return {
      tempDirectory,
      tempFilePath,
      sizeBytes,
    };
  }
}
