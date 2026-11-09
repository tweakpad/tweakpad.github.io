import type {HomeCell} from './home-mosaic.ts';
import {freePackingRects,subtractPackingRect,patternConflicts,type PackedRect,type PackingRect,type PackingSize} from './rect-packing.ts';
import {flightCorridor,type Problem} from './mosaic-relaxation.ts';
import {responsivePackingSizes} from './responsive-sizes.ts';
/** Before publication, replace conflicting types only in mutable placements.
 * A replacement must fit the actual free pocket and its measured size range. */
export function avoidPatternNeighbors(input:HomeCell[],bounds:PackingRect,gap:[number,number],fixed:Set<string>,flight?:Problem['flight']){
  const cells=structuredClone(input);
  const profiles=new Map(input.filter(c=>c.profile).map(c=>[c.pattern,c.profile!]));
  const catalog=[...new Map(input.filter(c=>!c.excludeFromNeighbors && c.pattern!=='__intro').map(c=>{
    const preferred=c.profile?.slice().sort((a,b)=>a.width-b.width)[1];
    return [c.pattern,{key:c.pattern,excludeFromNeighbors:c.excludeFromNeighbors,width:preferred?.width??c.w,solidHeight:preferred?.minHeight??c.h,height:(preferred?.minHeight??c.h)+c.captionHeight}];
  })).values()];
  const variants:PackingSize[]=[...catalog,...responsivePackingSizes(catalog,profiles)];
  const pose=(c:HomeCell):PackedRect=>({x:c.x,y:c.y,card:{key:c.pattern,excludeFromNeighbors:c.excludeFromNeighbors,width:c.w,height:c.h+c.captionHeight,solidHeight:c.h}});
  const corridor=flightCorridor({flight},cells);
  for(let pass=0;pass<3;pass++){
    let changed=false;
    for(const cell of cells){
      if(fixed.has(cell.key))continue;
      const others=cells.filter(c=>c!==cell).map(pose),before=pose(cell);
      if(!patternConflicts(before,others,gap))continue;
      let slots=freePackingRects(bounds,others,[0,0]);if(corridor)slots=subtractPackingRect(slots,corridor);
      slots=slots.filter(r=>r.x<=cell.x+.01&&r.y<=cell.y+.01&&r.x+r.w>=cell.x+cell.w-.01&&r.y+r.h>=cell.y+cell.h+cell.captionHeight-.01);
      let best:{card:PackingSize;x:number;y:number;score:number}|undefined;
      const cx=cell.x+cell.w/2,cy=cell.y+(cell.h+cell.captionHeight)/2;
      for(const card of variants){
        if(card.key===cell.pattern)continue;
        for(const r of slots){
          if(card.width+16>r.w || card.height+16>r.h)continue;
          const x=Math.min(r.x+r.w-card.width-8,Math.max(r.x+8,cx-card.width/2));
          const y=Math.min(r.y+r.h-card.height-8,Math.max(r.y+8,cy-card.height/2));
          if(patternConflicts({card,x,y},others,gap))continue;
          const score=(x+card.width/2-cx)**2+(y+card.height/2-cy)**2+(card.width-cell.w)**2+(card.height-cell.h-cell.captionHeight)**2;
          if(!best||score<best.score)best={card,x,y,score};
        }
      }
      if(best){const {card,x,y}=best;Object.assign(cell,{pattern:card.key,x,y,w:card.width,h:card.solidHeight??card.height,captionHeight:card.height-(card.solidHeight??card.height),profile:profiles.get(card.key)});changed=true;}
    }
    if(!changed)break;
  }
  return cells;
}
