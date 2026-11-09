import {fillPacking,type PackedRect,type PackingRect,type PackingSize} from './rect-packing.ts';
import {responsivePackingSizes} from './responsive-sizes.ts';
import type {HomeCell} from './home-mosaic.ts';
/** Insert measured responsive variants using the same gutter as the main fill. */
export function fillResponsiveRemainders(catalog:PackingSize[],bounds:PackingRect,occupied:PackedRect[],gap:[number,number],seed:number,profiles:Map<string,NonNullable<HomeCell['profile']>>){
  const variants=responsivePackingSizes(catalog,profiles);
  if(!variants.length)return [];
  const added=fillPacking(variants,bounds,occupied,gap,seed,{avoidSameType:true});
  return added;
}
