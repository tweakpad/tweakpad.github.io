import {edgeNeighbors,patternConflicts,type PackedRect,type PackingRect,type PackingSize} from './rect-packing.ts';
import {responsivePackingSizes,type ResponsiveProfile} from './responsive-sizes.ts';
/** Fit the unused width/height budget to actual neighboring edges. Existing
 * placements are immutable; candidate dimensions must remain content-safe. */
export function fitGutters(added:PackedRect[],fixed:PackedRect[],catalog:PackingSize[],profiles:Map<string,ResponsiveProfile>,bounds:PackingRect,gap:readonly[number,number]){
  const cells=added.map(p=>({...p,card:{...p.card}}));
  const variants=responsivePackingSizes(catalog,profiles);
  const all=()=>[...fixed,...cells];
  const score=(a:PackedRect,others:PackedRect[])=>{
    let sum=0;
    for(const b of edgeNeighbors(a,others)){
      const dx=Math.max(b.x-a.x-a.card.width,a.x-b.x-b.card.width,0);
      const dy=Math.max(b.y-a.y-a.card.height,a.y-b.y-b.card.height,0);
      sum+=(dx>0?dx-gap[0]:dy-gap[1])**2;
    }return sum;
  };
  for(let pass=0;pass<2;pass++)for(const a of cells){
    const base=catalog.find(c=>c.key===a.card.key);if(!base)continue;
    const world=all().filter(b=>b!==a);
    const reach=Math.max(base.width,base.height)*1.15+Math.max(...gap);
    const nearby=world.filter(b=>b.x+b.card.width>a.x-reach&&b.x<a.x+a.card.width+reach&&b.y+b.card.height>a.y-reach&&b.y<a.y+a.card.height+reach);
    const others=[...new Set([...nearby,...edgeNeighbors(a,world)])];
    const caption=base.height-(base.solidHeight??base.height),body=base.solidHeight??base.height;
    const options=[a.card,...variants.filter(c=>c.key===a.card.key)];
    let best={...a,card:{...a.card}},cost=score(a,others);
    for(const card of options){
      let left=bounds.x,right=bounds.x+bounds.w,top=bounds.y,bottom=bounds.y+bounds.h;
      for(const b of others){
        if(b.y<a.y+a.card.height&&b.y+b.card.height>a.y){if(b.x+b.card.width<=a.x+.01)left=Math.max(left,b.x+b.card.width+gap[0]);if(b.x>=a.x+a.card.width-.01)right=Math.min(right,b.x-gap[0]);}
      }
      if(card.width<a.card.width || card.width>right-left+.01)continue;
      const x=Math.max(left,Math.min(right-card.width,a.x+(a.card.width-card.width)/2));
      if(x>a.x+.01||x+card.width<a.x+a.card.width-.01)continue;
      for(const b of others)if(b.x<x+card.width&&b.x+b.card.width>x){if(b.y+b.card.height<=a.y+.01)top=Math.max(top,b.y+b.card.height+gap[1]);if(b.y>=a.y+a.card.height-.01)bottom=Math.min(bottom,b.y-gap[1]);}
      const h=Math.min(body*1.15+caption,bottom-top),floor=card.solidHeight??card.height-caption;
      if(h<Math.max(a.card.height,floor+caption)-.01)continue;
      const y=(top+bottom-h)/2,candidate={x,y,card:{...card,height:h,solidHeight:h-caption}};
      if(y>a.y+.01||y+h<a.y+a.card.height-.01)continue;
      if(others.some(b=>x<b.x+b.card.width&&x+card.width>b.x&&y<b.y+b.card.height&&y+h>b.y))continue;
      if(patternConflicts(candidate,others,gap))continue;
      const next=score(candidate,others);
      if(next<cost-.01){best=candidate;cost=next;}
    }
    Object.assign(a,best);
  }
  return cells;
}
