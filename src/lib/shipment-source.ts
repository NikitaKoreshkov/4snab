import type { AmoLead } from "./amocrm";
import type { SourceMaterial } from "./warehouse-types";

type LeadFields = Pick<AmoLead, "custom_fields_values">;

export function sourceFieldValues(lead: LeadFields, fieldId: number | null) {
  if (!fieldId) return [];
  return lead.custom_fields_values?.find((field) => field.field_id === fieldId)?.values ?? [];
}

export function sourceFieldValue(lead: LeadFields, fieldId: number | null): unknown {
  return sourceFieldValues(lead, fieldId)[0]?.value;
}

export function sourceNumber(lead: LeadFields, fieldId: number | null): number | null {
  const value = sourceFieldValue(lead, fieldId);
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function sourceText(lead: LeadFields, fieldId: number | null): string | null {
  const value = sourceFieldValue(lead, fieldId);
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

export function sourceDate(lead: LeadFields, fieldId: number | null): string | null {
  const value = sourceFieldValue(lead, fieldId);
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  const date = Number.isFinite(number)
    ? new Date(number * 1000 + 12 * 3600 * 1000)
    : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function syntheticEnumId(name: string): number {
  let hash = 2166136261;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return -(Math.abs(hash | 0) || 1);
}

export function sourceMaterials(
  lead: LeadFields,
  fieldId: number | null,
): SourceMaterial[] {
  const seen = new Set<number>();
  const materials: SourceMaterial[] = [];
  for (const value of sourceFieldValues(lead, fieldId)) {
    const name = String(value.value ?? "").trim();
    if (!name) continue;
    const enumId =
      typeof value.enum_id === "number" && Number.isInteger(value.enum_id)
        ? value.enum_id
        : syntheticEnumId(name);
    if (seen.has(enumId)) continue;
    seen.add(enumId);
    materials.push({ enumId, name, sortOrder: materials.length });
  }
  return materials;
}
