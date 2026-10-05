import { DEMOS } from './content.js';

const locale = language => /^zh(?:\b|[-_])/i.test(String(language || '')) ? 'zh' : 'en';
const variants = demo => [demo, ...Object.values(demo.locales || {})];
const knownValues = (demo, field, aliases) => new Set([
  ...variants(demo).map(value => value[field]), ...(demo[aliases] || []),
].filter(value => typeof value === 'string'));

function presetFor(project, version) {
  if (!project?.demo || (version && version.source !== 'demo')) return undefined;
  const direct = DEMOS.find(demo => demo.templateId === project.templateId);
  if (direct) return direct;
  // Older seed records may lack templateId. Only exact published identifiers qualify.
  return DEMOS.find(demo => knownValues(demo, 'name', 'legacyNames').has(project.name)
    && (!version || knownValues(demo, 'title', 'legacyTitles').has(version.title)));
}
function replaceKnown(target, field, demo, localized, aliases) {
  if (knownValues(demo, field, aliases).has(target[field])) target[field] = localized[field];
}

/**
 * A response-only copy of known system example labels. Personal project data,
 * custom node labels, edited designs, IDs, asset URLs, and layout stay intact.
 */
export function localizeDemoProject(project, language = 'en') {
  const demo = presetFor(project);
  if (!demo) return project;
  const localized = locale(language) === 'zh' ? demo.locales.zh : demo;
  const copy = structuredClone(project);
  replaceKnown(copy, 'name', demo, localized, 'legacyNames');
  replaceKnown(copy, 'description', demo, localized, 'legacyDescriptions');
  const versions = new Map();
  for (const version of copy.versions || []) {
    if (version.source !== 'demo') continue;
    replaceKnown(version, 'title', demo, localized, 'legacyTitles');
    replaceKnown(version, 'summary', demo, localized, 'legacySummaries');
    replaceKnown(version, 'controls', demo, localized, 'legacyControls');
    versions.set(version.id, version);
  }
  for (const node of copy.nodes || []) {
    // The editable label is a separate field and is intentionally never changed.
    if (!node.data || !versions.has(node.data.versionId)) continue;
    replaceKnown(node.data, 'title', demo, localized, 'legacyTitles');
    replaceKnown(node.data, 'summary', demo, localized, 'legacySummaries');
    replaceKnown(node.data, 'controls', demo, localized, 'legacyControls');
  }
  return copy;
}

/**
 * Select only a byte-identical built-in source variant. A `demo` flag or title
 * alone cannot replace arbitrary user HTML, even if it shares a preset genre.
 */
export function builtInDemoHtml(project, version, language = 'en', originalHtml) {
  const demo = presetFor(project, version);
  if (!demo || typeof originalHtml !== 'string') return originalHtml;
  const knownHtml = new Set([...variants(demo).map(value => value.html), ...(demo.legacyHtml || [])]);
  if (!knownHtml.has(originalHtml)) return originalHtml;
  return locale(language) === 'zh' ? demo.locales.zh.html : demo.html;
}
