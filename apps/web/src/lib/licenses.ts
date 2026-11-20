import type { LicenseId, LocaleCode } from './types';

export type LicenseEmblem =
  | 'cc'
  | 'by'
  | 'sa'
  | 'nc'
  | 'nd'
  | 'zero'
  | 'copyright';

export interface LicenseMeta {
  id: LicenseId;
  shortCode: string;
  emblems: LicenseEmblem[];
  deedPath?: string;
}

export const ALL_LICENSE_OPTIONS: LicenseMeta[] = [
  {
    id: 'cc-by-4.0',
    shortCode: 'CC BY 4.0',
    emblems: ['cc', 'by'],
    deedPath: 'licenses/by/4.0',
  },
  {
    id: 'cc-by-sa-4.0',
    shortCode: 'CC BY-SA 4.0',
    emblems: ['cc', 'by', 'sa'],
    deedPath: 'licenses/by-sa/4.0',
  },
  {
    id: 'cc-by-nc-4.0',
    shortCode: 'CC BY-NC 4.0',
    emblems: ['cc', 'by', 'nc'],
    deedPath: 'licenses/by-nc/4.0',
  },
  {
    id: 'cc-by-nc-sa-4.0',
    shortCode: 'CC BY-NC-SA 4.0',
    emblems: ['cc', 'by', 'nc', 'sa'],
    deedPath: 'licenses/by-nc-sa/4.0',
  },
  {
    id: 'cc-by-nd-4.0',
    shortCode: 'CC BY-ND 4.0',
    emblems: ['cc', 'by', 'nd'],
    deedPath: 'licenses/by-nd/4.0',
  },
  {
    id: 'cc-by-nc-nd-4.0',
    shortCode: 'CC BY-NC-ND 4.0',
    emblems: ['cc', 'by', 'nc', 'nd'],
    deedPath: 'licenses/by-nc-nd/4.0',
  },
  {
    id: 'cc0-1.0',
    shortCode: 'CC0 1.0',
    emblems: ['cc', 'zero'],
    deedPath: 'publicdomain/zero/1.0',
  },
  {
    id: 'all-rights-reserved',
    shortCode: '©',
    emblems: ['copyright'],
  },
  {
    id: 'none',
    shortCode: '',
    emblems: [],
  },
];

const LICENSE_MAP = new Map<string, LicenseMeta>(
  ALL_LICENSE_OPTIONS.map((item) => [item.id, item]),
);

export function normalizeLicenseId(raw?: string | null): LicenseId | '' {
  const cleaned = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_ ]+/g, '-');
  if (!cleaned || cleaned === 'default' || cleaned === 'site-default') {
    return '';
  }
  if (LICENSE_MAP.has(cleaned)) {
    return cleaned as LicenseId;
  }
  return '';
}

export function resolveEffectiveLicense(
  stepLicense?: string | null,
  siteDefaultLicense?: string | null,
): LicenseMeta | null {
  const stepId = normalizeLicenseId(stepLicense);
  const effectiveId =
    stepId || normalizeLicenseId(siteDefaultLicense) || 'cc-by-nc-sa-4.0';
  if (effectiveId === 'none') {
    return null;
  }
  return LICENSE_MAP.get(effectiveId) ?? null;
}

export function getLicenseDeedUrl(
  meta: LicenseMeta,
  locale: LocaleCode,
): string | null {
  if (!meta.deedPath) return null;
  const deedLang =
    locale === 'zh-CN'
      ? 'deed.zh-hans'
      : locale === 'zh-TW'
        ? 'deed.zh-hant'
        : locale === 'ja'
          ? 'deed.ja'
          : 'deed.en';
  return `https://creativecommons.org/${meta.deedPath}/${deedLang}`;
}
