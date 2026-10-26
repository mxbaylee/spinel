/** Pure image hierarchy metadata, shared by source preparation and native paint. */
import type { IGroupBaseBound } from '@univerjs/core';
import type { ImageAppearance } from './image-render.ts';

/** Adapters validate hierarchy, appearance and resource budgets before constructing nodes. */
export interface ImageGroupNode {
  appearance: ImageAppearance;
  hidden: boolean;
  source?: string;
  opacity: number;
  base?: IGroupBaseBound;
  children: ImageGroupNode[];
}

export type PreparedImageGroups = ReadonlyMap<string, ImageGroupNode>;
/** Expand only sources selected after unused stories and hidden roots are removed. */
export function groupImageSources(
  sources: readonly string[],
  groups: PreparedImageGroups,
): string[] {
  const result = new Set<string>();
  const add = (node: ImageGroupNode) => {
    if (node.hidden) return;
    if (node.source) result.add(node.source);
    for (const child of node.children) add(child);
  };
  for (const source of sources) {
    const group = groups.get(source);
    if (group) add(group);
    else result.add(source);
  }
  return [...result];
}
