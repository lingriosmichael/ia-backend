import { AppError } from "../../../shared/errors/app-error.js";
import type { AIProvider } from "./ai-provider.js";

export class AIProviderRegistry {
  private readonly providersByKey: Map<string, AIProvider>;

  constructor(providers: AIProvider[]) {
    this.providersByKey = new Map(
      providers.map((provider) => [provider.providerKey, provider]),
    );
  }

  getProvider(providerKey: string): AIProvider {
    const provider = this.providersByKey.get(providerKey);

    if (!provider) {
      throw new AppError(
        `AI provider "${providerKey}" is not registered.`,
        500,
        "ai_provider_not_found",
      );
    }

    return provider;
  }
}
