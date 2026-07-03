export interface OrganizationInvitationEmailInput {
  toEmail: string;
  organizationName: string;
  acceptUrl: string;
  acceptanceMode: "create_account" | "sign_in";
}

export interface EmailService {
  sendOrganizationInvitation(
    input: OrganizationInvitationEmailInput,
  ): Promise<void>;
}
