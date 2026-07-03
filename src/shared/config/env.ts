import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z
  .object({
    API_PORT: z.coerce.number().int().positive().default(4000),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().min(2).default("7d"),
    CORS_ORIGIN: z.string().min(1).default("http://localhost:8080"),
    WEBAPP_URL: z.string().url().default("http://localhost:8080"),
    PYTHON_SERVICE_URL: z.string().url().default("http://localhost:8000"),
    UPLOAD_DIR: z.string().min(1).default("./uploads"),
    MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017"),
    MONGODB_DB_NAME: z.string().min(1).default("gr_backend"),
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
