import { enLocale } from './en';
import { jaLocale } from './ja';
import type { LocaleBundle } from './schema';
import { zhCNLocale } from './zh-CN';
import { zhTWLocale } from './zh-TW';

export type * from './schema';

/**
 * Registered regional locale bundles.
 * To add or modify a language, create/edit its file in `src/lib/locales/` and register it here.
 */
export const LOCALE_BUNDLES: readonly LocaleBundle[] = [
  zhCNLocale,
  enLocale,
  zhTWLocale,
  jaLocale,
];
