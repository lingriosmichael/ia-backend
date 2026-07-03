import type { OrganizationSettings } from "../../shared/contracts.js";

const defaultOrganizationSettings = {
  legalForm: null,
  foundingYear: null,
  country: null,
  employeeCount: null,
  activityAreas: [],
  targetGroups: [],
  operatingRegions: [],
  isRecognizedNonProfit: null,
  taxExemptionValidFrom: null,
} satisfies Omit<OrganizationSettings, "organizationName" | "mission">;

function normalizeNullableString(value: string | null | undefined) {
  return value ?? null;
}

function normalizeStringArray(value: string[] | null | undefined) {
  return Array.isArray(value) ? [...value] : [];
}

export function createOrganizationSettings(params: {
  organizationName: string;
  mission?: string | null;
}): OrganizationSettings {
  return {
    organizationName: params.organizationName,
    mission: params.mission ?? null,
    legalForm: defaultOrganizationSettings.legalForm,
    foundingYear: defaultOrganizationSettings.foundingYear,
    country: defaultOrganizationSettings.country,
    employeeCount: defaultOrganizationSettings.employeeCount,
    activityAreas: [],
    targetGroups: [],
    operatingRegions: [],
    isRecognizedNonProfit: defaultOrganizationSettings.isRecognizedNonProfit,
    taxExemptionValidFrom: defaultOrganizationSettings.taxExemptionValidFrom,
  };
}

export function resolveOrganizationSettings(params: {
  name: string;
  mission?: string | null;
  settings?: Partial<OrganizationSettings> | null;
}): OrganizationSettings {
  return {
    organizationName: params.settings?.organizationName?.trim() || params.name,
    mission: normalizeNullableString(
      params.settings?.mission ?? params.mission,
    ),
    legalForm: normalizeNullableString(params.settings?.legalForm),
    foundingYear: params.settings?.foundingYear ?? null,
    country: normalizeNullableString(params.settings?.country),
    employeeCount: params.settings?.employeeCount ?? null,
    activityAreas: normalizeStringArray(params.settings?.activityAreas),
    targetGroups: normalizeStringArray(params.settings?.targetGroups),
    operatingRegions: normalizeStringArray(params.settings?.operatingRegions),
    isRecognizedNonProfit: params.settings?.isRecognizedNonProfit ?? null,
    taxExemptionValidFrom: normalizeNullableString(
      params.settings?.taxExemptionValidFrom,
    ),
  };
}
