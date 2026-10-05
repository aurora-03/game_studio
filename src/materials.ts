import type { Asset, GameNode, Project } from './api';

export const materialCategories = ['character', 'scene', 'prop', 'audio', 'reference', 'unassigned'] as const;
export type MaterialCategory = typeof materialCategories[number];
export const materialCategoryLabels: Record<MaterialCategory, string> = {
  character: 'Characters', scene: 'Scenes', prop: 'Props', audio: 'Audio', reference: 'References', unassigned: 'Unassigned',
};
export type AssetCatalogItem = Asset & { project: Project; nodes: GameNode[]; categories: MaterialCategory[]; fileKind: string };
type MaterialNode = { id: string; type?: string; data: Record<string, unknown> };

export function boundAssetIds(data: Record<string, unknown>) {
  return Array.from(new Set([
    ...(Array.isArray(data.assetIds) ? data.assetIds.filter((id): id is string => typeof id === 'string') : []),
    ...(typeof data.assetId === 'string' ? [data.assetId] : []),
  ]));
}

/** Covers always resolve against this project's current asset inventory. */
export function materialCover(node: MaterialNode | undefined, assets: Asset[] = []) {
  if (!node) return undefined;
  const inventory = new Map(assets.map((asset) => [asset.id, asset]));
  return boundAssetIds(node.data).map((id) => inventory.get(id)).find((asset) => asset?.mimeType.startsWith('image/'));
}

export function fileKind(asset: Pick<Asset, 'mimeType'>) {
  if (asset.mimeType.startsWith('image/')) return 'image';
  if (asset.mimeType.startsWith('audio/')) return 'audio';
  if (asset.mimeType.startsWith('video/')) return 'video';
  return 'document';
}

export function buildAssetCatalog(projects: Project[]): AssetCatalogItem[] {
  return projects.filter((project) => project.status === 'active').flatMap((project) => {
    // A shared file is one asset card, even when several materials reference it.
    const inventory = new Map(project.assets.map((asset) => [asset.id, asset]));
    return Array.from(inventory.values()).map((asset) => {
      const nodes = project.nodes.filter((node) => boundAssetIds(node.data).includes(asset.id));
      const categories = Array.from(new Set(nodes.map((node): MaterialCategory =>
        ['character', 'scene', 'prop', 'audio'].includes(node.type || '') ? node.type as MaterialCategory : 'reference',
      )));
      return { ...asset, project, nodes, categories: categories.length ? categories : ['unassigned' as const], fileKind: fileKind(asset) };
    });
  });
}

export function filterAssetCatalog(items: AssetCatalogItem[], { projectId = 'all', category = 'all', kind = 'all', query = '' } = {}) {
  const search = query.trim().toLocaleLowerCase();
  return items.filter((item) => (projectId === 'all' || item.project.id === projectId)
    && (category === 'all' || item.categories.includes(category as MaterialCategory))
    && (kind === 'all' || item.fileKind === kind)
    && (!search || [item.name, item.project.name, item.mimeType, ...item.categories.flatMap((role) => [role, materialCategoryLabels[role]]),
      ...item.nodes.flatMap((node) => [node.data.title, node.data.label, node.data.content, ...Object.values(node.data.specifications || {})]),
    ].join(' ').toLocaleLowerCase().includes(search)));
}
