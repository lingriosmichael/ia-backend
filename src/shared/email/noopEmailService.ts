import type {
  EmailService,
  OrganizationInvitationEmailInput,
} from "./emailService.js";

export class NoopEmailService implements EmailService {
  async sendOrganizationInvitation(
    _input: OrganizationInvitationEmailInput,
  ): Promise<void> {
    return Promise.resolve();
  }
}
