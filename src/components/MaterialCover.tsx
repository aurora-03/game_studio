import type { Asset } from '../api';
import { materialCover } from '../materials';
import { iconForNodeType } from './StudioIcons';
import { t, useLanguage } from '../i18n';

export function MaterialCover({ node, assets = [], className = '' }: {
  node: { id: string; type?: string; data: Record<string, unknown> }; assets?: Asset[]; className?: string;
}) {
  useLanguage();
  const cover = materialCover(node, assets), Icon = iconForNodeType(node.type);
  return <div className={`material-cover ${className}`} data-material-type={node.type}>
    {cover ? <img src={cover.url} alt={cover.name} data-asset-id={cover.id} loading="lazy" />
      : <div className="material-cover-placeholder"><Icon size={38} /><span>{t(node.type === 'audio' ? 'Audio direction' : 'Design direction')}</span></div>}
  </div>;
}
