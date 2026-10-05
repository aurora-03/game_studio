import { useSyncExternalStore } from 'react';
import { Languages } from 'lucide-react';
import { getLanguage, setLanguage, subscribeLanguage, t } from './locale.ts';
import type { Language } from './locale.ts';
export { t, localizedLabels, localeCode } from './locale.ts';
export type { Language } from './locale.ts';

export function useLanguage() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => 'en' as const);
  return { language, setLanguage };
}
export function LanguageSwitch({ onChange }: { onChange?: (language: Language) => void }) {
  const { language } = useLanguage();
  return <label className="language-switch">
    <Languages size={15} aria-hidden="true" />
    <select aria-label={t('Language')} value={language} onChange={(event) => {
      const next = event.target.value as Language; setLanguage(next); onChange?.(next);
      window.dispatchEvent(new CustomEvent('gamestudio:language-change', { detail: next }));
    }}>
      <option value="en">English</option><option value="zh">简体中文</option>
    </select>
  </label>;
}
