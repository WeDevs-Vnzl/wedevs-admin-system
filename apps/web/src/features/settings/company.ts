import type { CompanySettingsResponseDto } from "@/lib/api/types/identity";
import type { CompanySettings } from "@/lib/validators/settings";

/** `GET|PATCH /settings/company` response → the form's `CompanySettings` (a `null` column is an absent value). */
export function toCompanySettings(dto: CompanySettingsResponseDto): CompanySettings {
  return {
    name: dto.name,
    legalName: dto.legalName ?? undefined,
    taxId: dto.taxId ?? undefined,
    address: dto.address ?? undefined,
    logoFileId: dto.logoFileId ?? undefined,
  };
}

/** Maps the data of an `openapi-fetch` result and leaves a failure untouched. */
export function mapCompanyResult<R extends { data?: CompanySettingsResponseDto }>(
  result: R,
): Omit<R, "data"> & { data?: CompanySettings } {
  const { data, ...rest } = result;
  return data === undefined ? rest : { ...rest, data: toCompanySettings(data) };
}
