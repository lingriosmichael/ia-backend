import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const optionalBooleanSchema = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }

    return value === "true";
  });

const envSchema = z
  .object({
    API_PORT: z.coerce.number().int().positive().default(4000),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().min(2).default("7d"),
    AUTH_COOKIE_NAME: z.string().min(1).default("ia_session"),
    AUTH_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
    AUTH_COOKIE_SECURE: optionalBooleanSchema,
    ALLOW_LOCAL_FILE_STORAGE_IN_PRODUCTION: optionalBooleanSchema,
    CORS_ORIGIN: z.string().min(1).default("http://localhost:8080"),
    WEBAPP_URL: z.string().url().default("http://localhost:8080"),
    PYTHON_SERVICE_URL: z.string().url().default("http://localhost:8000"),
    PYTHON_SERVICE_SHARED_SECRET: z.string().min(16),
    PYTHON_SERVICE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(30000),
    PYTHON_ANALYTICS_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(120000),
    FILE_STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    UPLOAD_DIR: z.string().min(1).default("./uploads"),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_KEY_PREFIX: z.string().optional(),
    S3_FORCE_PATH_STYLE: z
      .string()
      .optional()
      .transform((value) => value?.trim().toLowerCase())
      .pipe(z.enum(["true", "false"]).optional())
      .transform((value) => value !== "false"),
    MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017"),
    MONGODB_DB_NAME: z.string().min(1).default("impact_atlas_backend"),
    EMAIL_PROVIDER: z.enum(["disabled", "mailersend"]).default("disabled"),
    EMAIL_FROM: z.string().email().default("noreply@example.org"),
    EMAIL_FROM_NAME: z.string().min(1).default("Impact Atlas"),
    EMAIL_REPLY_TO: z.string().email().optional(),
    EMAIL_REPLY_TO_NAME: z.string().min(1).optional(),
    MAILERSEND_API_BASE_URL: z
      .string()
      .url()
      .default("https://api.mailersend.com/v1"),
    MAILERSEND_API_TOKEN: z.string().min(1).optional(),
    AI_PROVIDER: z.enum(["mock"]).default("mock"),
    AI_MODEL: z.string().min(1).default("mock-structured-v1"),
  })
  .superRefine((environment, context) => {
    const isProduction = process.env.NODE_ENV === "production";

    if (
      isProduction &&
      environment.FILE_STORAGE_DRIVER !== "s3" &&
      environment.ALLOW_LOCAL_FILE_STORAGE_IN_PRODUCTION !== true
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FILE_STORAGE_DRIVER"],
        message:
          "FILE_STORAGE_DRIVER must be s3 in production unless ALLOW_LOCAL_FILE_STORAGE_IN_PRODUCTION=true is set explicitly.",
      });
    }

    if (environment.FILE_STORAGE_DRIVER === "s3") {
      const requiredS3Fields = [
        "S3_ENDPOINT",
        "S3_REGION",
        "S3_BUCKET",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
      ] as const;

      for (const field of requiredS3Fields) {
        if (environment[field]) {
          continue;
        }

        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when FILE_STORAGE_DRIVER is s3.`,
        });
      }
    }

    if (environment.EMAIL_PROVIDER !== "mailersend") {
      return;
    }

    if (!environment.MAILERSEND_API_TOKEN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MAILERSEND_API_TOKEN"],
        message:
          "MAILERSEND_API_TOKEN is required when EMAIL_PROVIDER is mailersend.",
      });
    }
  });

export type BackendConfig = z.infer<typeof envSchema>;

export function loadConfig(): BackendConfig {
  return envSchema.parse(process.env);
}
