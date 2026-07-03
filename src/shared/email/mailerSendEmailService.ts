import type { BackendConfig } from "../config/env.js";
import type {
  EmailService,
  OrganizationInvitationEmailInput,
} from "./emailService.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export class MailerSendEmailService implements EmailService {
  constructor(private readonly config: BackendConfig) {}

  async sendOrganizationInvitation(
    input: OrganizationInvitationEmailInput,
  ): Promise<void> {
    const subject = `Invitation to join ${input.organizationName} on Impact Atlas`;
    const inviteAction =
      input.acceptanceMode === "sign_in"
        ? "Sign in with your invited email address to accept the invitation."
        : "Create your account to accept the invitation.";
    const escapedOrganizationName = escapeHtml(input.organizationName);
    const escapedAcceptUrl = escapeHtml(input.acceptUrl);

    const response = await fetch(
      `${this.config.MAILERSEND_API_BASE_URL.replace(/\/+$/, "")}/email`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.MAILERSEND_API_TOKEN}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          from: {
            email: this.config.EMAIL_FROM,
            name: this.config.EMAIL_FROM_NAME,
          },
          reply_to: this.config.EMAIL_REPLY_TO
            ? {
                email: this.config.EMAIL_REPLY_TO,
                name:
                  this.config.EMAIL_REPLY_TO_NAME ??
                  this.config.EMAIL_FROM_NAME,
              }
            : undefined,
          to: [
            {
              email: input.toEmail,
            },
          ],
          subject,
          text: [
            `You've been invited to join ${input.organizationName} on Impact Atlas.`,
            "",
            inviteAction,
            "",
            `Accept invitation: ${input.acceptUrl}`,
          ].join("\n"),
          html: [
            `<p>You've been invited to join <strong>${escapedOrganizationName}</strong> on Impact Atlas.</p>`,
            `<p>${escapeHtml(inviteAction)}</p>`,
            `<p><a href="${escapedAcceptUrl}">Accept invitation</a></p>`,
          ].join(""),
        }),
      },
    );

    if (response.ok) {
      return;
    }

    const errorMessage = await this.extractErrorMessage(response);
    throw new Error(
      `MailerSend email delivery failed with status ${response.status}: ${errorMessage}`,
    );
  }

  private async extractErrorMessage(response: Response) {
    try {
      const payload = (await response.json()) as {
        message?: string;
        errors?: Record<string, string[] | string>;
      };

      if (payload.message) {
        return payload.message;
      }

      if (payload.errors) {
        return JSON.stringify(payload.errors);
      }
    } catch {
      // Fall back to plain text when MailerSend does not return JSON.
    }

    const fallback = await response.text();
    return fallback || "Unknown MailerSend error";
  }
}
