import type { BackendConfig } from "../config/env.js";
import type { EmailService } from "./emailService.js";
import { MailerSendEmailService } from "./mailerSendEmailService.js";
import { NoopEmailService } from "./noopEmailService.js";

export function createEmailService(config: BackendConfig): EmailService {
  if (config.EMAIL_PROVIDER === "mailersend") {
    return new MailerSendEmailService(config);
  }

  return new NoopEmailService();
}
