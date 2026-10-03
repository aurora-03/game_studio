import { createLucideIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Shared 24px geometry; the interface renders these with a 1.5px stroke.
// Keep category symbols identical in the canvas, menus and @ suggestions.
export const DirectorIcon = createLucideIcon('StudioDirector', [
  ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2, key: 'frame' }],
  ['path', { d: 'M3 9h18M7 4l3 5m4-5 3 5', key: 'slate' }],
  ['path', { d: 'm10 12 5 3-5 3z', key: 'play' }],
]);
export const GameCanvasIcon = createLucideIcon('StudioGameCanvas', [
  ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 3, key: 'frame' }],
  ['path', { d: 'm10 8 6 4-6 4z', key: 'play' }],
]);
export const AssetLibraryIcon = createLucideIcon('StudioAssetLibrary', [
  ['path', { d: 'm7 3 4 4-4 4-4-4z', key: 'diamond' }],
  ['circle', { cx: 17, cy: 7, r: 3, key: 'circle' }],
  ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 2, key: 'square' }],
  ['path', { d: 'M17 14v7m-3.5-3.5h7', key: 'plus' }],
]);
export const TextNodeIcon = createLucideIcon('StudioTextNode', [
  ['rect', { x: 3, y: 4, width: 18, height: 16, rx: 3, key: 'frame' }],
  ['path', { d: 'M7 9h10M7 14h6', key: 'lines' }],
]);
export const WorkflowIcon = createLucideIcon('StudioWorkflow', [
  ['rect', { x: 2, y: 8, width: 5, height: 8, rx: 1.5, key: 'input' }],
  ['rect', { x: 17, y: 3, width: 5, height: 7, rx: 1.5, key: 'top' }],
  ['rect', { x: 17, y: 14, width: 5, height: 7, rx: 1.5, key: 'bottom' }],
  ['path', { d: 'M7 12h5m0-5.5v11M12 6.5h5m-5 11h5', key: 'links' }],
]);
export const ArrangeIcon = createLucideIcon('StudioArrange', [
  ['rect', { x: 3, y: 3, width: 7, height: 11, rx: 1.5, key: 'a' }],
  ['rect', { x: 14, y: 3, width: 7, height: 6, rx: 1.5, key: 'b' }],
  ['rect', { x: 3, y: 18, width: 7, height: 3, rx: 1, key: 'c' }],
  ['rect', { x: 14, y: 13, width: 7, height: 8, rx: 1.5, key: 'd' }],
]);
export const CursorIcon = createLucideIcon('StudioCursor', [
  ['path', { d: 'm4 3 16 6-7 3-3 8z', key: 'cursor' }],
]);
export const HistoryIcon = createLucideIcon('StudioHistory', [
  ['circle', { cx: 12, cy: 12, r: 9, key: 'clock' }],
  ['path', { d: 'M12 6v6l4 3', key: 'hands' }],
]);
export const CharacterIcon = createLucideIcon('StudioCharacter', [
  ['circle', { cx: 12, cy: 12, r: 9, key: 'face' }],
  ['path', { d: 'M8 9h.01M16 9h.01M8 14a4.5 4.5 0 0 0 8 0', key: 'expression' }],
]);
export const SceneIcon = createLucideIcon('StudioScene', [
  ['rect', { x: 3, y: 3, width: 18, height: 18, rx: 3, key: 'frame' }],
  ['circle', { cx: 8, cy: 8, r: 1.5, key: 'sun' }],
  ['path', { d: 'm3 17 6-5 4 3 4-6 4 7', key: 'landscape' }],
]);
export const PropIcon = createLucideIcon('StudioProp', [
  ['path', { d: 'm12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5m-9 5v8', key: 'object' }],
]);
export const AudioIcon = createLucideIcon('StudioAudio', [
  ['path', { d: 'M3 10v4M7.5 6v12M12 3v18m4.5-15v12M21 10v4', key: 'waveform' }],
]);

const nodeIcons: Record<string, LucideIcon> = {
  brief: TextNodeIcon, text: TextNodeIcon, character: CharacterIcon,
  scene: SceneIcon, prop: PropIcon, audio: AudioIcon,
  asset: AssetLibraryIcon, game: GameCanvasIcon,
};
export const iconForNodeType = (type?: string): LucideIcon => nodeIcons[type || 'text'] || TextNodeIcon;
