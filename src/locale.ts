import { zh } from './translations.ts';

export type Language = 'en' | 'zh';
const listeners = new Set<() => void>();
let language: Language = 'en';
try { if (typeof localStorage !== 'undefined' && localStorage.getItem('gamestudio.language') === 'zh') language = 'zh'; } catch { /* Storage may be unavailable. */ }

export const getLanguage = (): Language => language;
export const localeCode = (): string => language === 'zh' ? 'zh-CN' : 'en-US';
export function setLanguage(next: Language) {
  if (next !== 'en' && next !== 'zh') return;
  language = next;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem('gamestudio.language', next); } catch { /* In-memory switching still works. */ }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
    document.title = next === 'zh' ? 'GameStudio · 游戏创作工作台' : 'GameStudio · Game Creation Workspace';
  }
  for (const listener of listeners) listener();
}
export const subscribeLanguage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function t(message: string, values: Record<string, string | number> = {}): string {
  const translated = language === 'zh' ? zh[message] || message : message;
  return translated.replace(/\{([^{}]+)\}/g, (match, key: string) => Object.hasOwn(values, key) ? String(values[key]) : match);
}

/** Localize static label dictionaries at read time so switching never changes API values. */
export function localizedLabels<T extends object>(source: T): T {
  const cache = new WeakMap<object, object>();
  const wrap = (value: unknown): unknown => {
    if (typeof value === 'string') return t(value);
    if (!value || typeof value !== 'object' || '$$typeof' in value) return value;
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return value;
    if (cache.has(value)) return cache.get(value);
    const proxy = new Proxy(value, { get: (target, property, receiver) => wrap(Reflect.get(target, property, receiver)) });
    cache.set(value, proxy); return proxy;
  };
  return wrap(source) as T;
}
