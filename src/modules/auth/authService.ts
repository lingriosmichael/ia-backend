import type { BackendConfig } from "../../shared/config/env.js";
import { databaseSession } from "../../shared/database/databaseClient.js";
import type { TransactionManager } from "../../shared/database/transactionManager.js";
import { AppError } from "../../shared/errors/appError.js";
import {
  mapAuthResponse,
  mapOrganizationMembership,
  mapUser,
} from "../../shared/utils/mappers.js";
import { hashPassword, verifyPassword } from "../../shared/utils/password.js";
import { ensureUniqueSlug } from "../../shared/utils/slug.js";
import jwt from "jsonwebtoken";
import type { Secret, SignOptions } from "jsonwebtoken";
import type { OrganizationRepository } from "../organization/organizationRepository.js";
import type { UserRepository } from "../user/userRepository.js";

function expiresToSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);

  if (!match) {
    throw new AppError(
      "JWT_EXPIRES_IN must use a simple duration such as 15m, 12h, or 7d.",
      500,
      "config_error",
    );
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier =
    unit === "s" ? 1 : unit === "m" ? 60 : unit === "h" ? 3600 : 86400;
  return amount * multiplier;
}

export class AuthService {
  constructor(
    private readonly config: BackendConfig,
    private readonly userRepository: UserRepository,
    private readonly organizationRepository: OrganizationRepository,
    private readonly transactionManager: TransactionManager,
  ) {}

  async register(input: { fullName: string; email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const existingUser = await this.userRepository.findByEmail(
      email,
      databaseSession,
    );

    if (existingUser) {
      throw new AppError(
        "An account already exists for this email address.",
        409,
        "email_already_exists",
      );
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.userRepository.create(
      {
        email,
        fullName: input.fullName.trim(),
        passwordHash,
      },
      databaseSession,
    );
    const accessToken = this.signToken(user.id, user.email);

    return mapAuthResponse({
      accessToken,
      expiresInSeconds: expiresToSeconds(this.config.JWT_EXPIRES_IN),
      user,
      organizations: [],
    });
  }

  async login(input: { email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const user = await this.userRepository.findByEmail(email, databaseSession);

    if (!user) {
      throw new AppError(
        "Invalid email or password.",
        401,
        "invalid_credentials",
      );
    }

    const isValid = await verifyPassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new AppError(
        "Invalid email or password.",
        401,
        "invalid_credentials",
      );
    }

    const memberships = await this.organizationRepository.listForUser(
      user.id,
      databaseSession,
    );
    const accessToken = this.signToken(user.id, user.email);

    return mapAuthResponse({
      accessToken,
      expiresInSeconds: expiresToSeconds(this.config.JWT_EXPIRES_IN),
      user,
      organizations: memberships,
    });
  }

  async getSession(userId: string) {
    const user = await this.userRepository.findById(userId, databaseSession);

    if (!user) {
      throw new AppError("User session is invalid.", 401, "invalid_session");
    }

    const memberships = await this.organizationRepository.listForUser(
      user.id,
      databaseSession,
    );

    return {
      user: mapUser(user),
      organizations: memberships.map(mapOrganizationMembership),
    };
  }

  verifyToken(token: string) {
    const payload = jwt.verify(token, this.config.JWT_SECRET) as {
      sub: string;
      email: string;
    };

    return {
      userId: payload.sub,
      email: payload.email,
    };
  }

  private signToken(userId: string, email: string) {
    return jwt.sign(
      {
        sub: userId,
        email,
      },
      this.config.JWT_SECRET as Secret,
      {
        expiresIn: this.config.JWT_EXPIRES_IN as SignOptions["expiresIn"],
      },
    );
  }
}
