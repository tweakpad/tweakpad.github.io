export interface PackingRect {x:number;y:number;w:number;h:number}
export interface PackingSize {key:string;width:number;height:number;solidHeight?:number;excludeFromNeighbors?:boolean}
export interface PackedRect {card:PackingSize;x:number;y:number}
const overlaps=(a:PackingRect,b:PackingRect)=>a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;
const contains=(a:PackingRect,b:PackingRect)=>a.x<=b.x && a.y<=b.y && a.x+a.w>=b.x+b.w && a.y+a.h>=b.y+b.h;
export function subtractPackingRect(free:PackingRect[],used:PackingRect) {
  const split:PackingRect[]=[];
  for(const r of free) {
    if(!overlaps(r,used)){split.push(r);continue;}
    if(used.x>r.x)split.push({...r,w:used.x-r.x});
    if(used.x+used.w<r.x+r.w)split.push({...r,x:used.x+used.w,w:r.x+r.w-used.x-used.w});
    if(used.y>r.y)split.push({...r,h:used.y-r.y});
    if(used.y+used.h<r.y+r.h)split.push({...r,y:used.y+used.h,h:r.y+r.h-used.y-used.h});
  }
  return split.filter((r,i)=>r.w>0 && r.h>0 && !split.some((other,j)=>j!==i && contains(other,r) && (j<i || !contains(r,other))));
}
const padded=(r:PackedRect,gap:readonly[number,number]):PackingRect=>({x:r.x-gap[0]/2,y:r.y-gap[1]/2,w:r.card.width+gap[0],h:r.card.height+gap[1]});
export function freePackingRects(bounds:PackingRect,occupied:readonly PackedRect[],gap:readonly[number,number]) {
  let free=[bounds];
  for(const p of occupied)free=subtractPackingRect(free,padded(p,gap));
  return free;
}
/** The nearest overlapping edge in each direction is a neighbor, regardless
 * of gutter width. Adjacency is symmetric: either rectangle may identify it. */
export function edgeNeighbors(a:PackedRect,others:readonly PackedRect[]){
  if(a.card.excludeFromNeighbors)return new Set<PackedRect>();
  others=others.filter(b=>!b.card.excludeFromNeighbors);
  const distances=[Infinity,Infinity,Infinity,Infinity],sets:PackedRect[][]=[[],[],[],[]];
  for(const b of others){
    const spansY=a.y<b.y+b.card.height-.01 && a.y+a.card.height>b.y+.01;
    const spansX=a.x<b.x+b.card.width-.01 && a.x+a.card.width>b.x+.01;
    const gaps=[spansY?a.x-b.x-b.card.width:-1,spansY?b.x-a.x-a.card.width:-1,spansX?a.y-b.y-b.card.height:-1,spansX?b.y-a.y-a.card.height:-1];
    for(let i=0;i<4;i++)if(gaps[i]>=-.01){
      if(gaps[i]<distances[i]-.01){distances[i]=gaps[i];sets[i]=[b];}
      else if(Math.abs(gaps[i]-distances[i])<=.01)sets[i].push(b);
    }
  }
  return new Set(sets.flat());
}
/** Cache existing nearest-edge distances once for a batch of candidates. */
export function patternConstraint(occupied:readonly PackedRect[]){
  const others=occupied.filter(b=>!b.card.excludeFromNeighbors);
  const distance=(a:PackedRect,b:PackedRect)=>{
    const y=a.y<b.y+b.card.height-.01&&a.y+a.card.height>b.y+.01;
    const x=a.x<b.x+b.card.width-.01&&a.x+a.card.width>b.x+.01;
    return [y?a.x-b.x-b.card.width:-1,y?b.x-a.x-a.card.width:-1,x?a.y-b.y-b.card.height:-1,x?b.y-a.y-a.card.height:-1];
  };
  const nearest=others.map(b=>{
    const d=[Infinity,Infinity,Infinity,Infinity];
    for(const c of others)if(c!==b)distance(b,c).forEach((v,i)=>{if(v>=-.01)d[i]=Math.min(d[i],v);});
    return d;
  });
  const check=(a:PackedRect)=>{
    if(a.card.excludeFromNeighbors)return 0;
    const conflicts=new Set<PackedRect>();
    for(const b of edgeNeighbors(a,others))if(b.card.key===a.card.key)conflicts.add(b);
    others.forEach((b,j)=>{if(b.card.key===a.card.key&&distance(b,a).some((v,i)=>v>=-.01&&v<=nearest[j][i]+.01))conflicts.add(b);});
    return conflicts.size;
  };
  check.add=(a:PackedRect)=>{
    if(a.card.excludeFromNeighbors)return;
    const next=[Infinity,Infinity,Infinity,Infinity];
    others.forEach((b,j)=>{
      distance(b,a).forEach((v,i)=>{if(v>=-.01)nearest[j][i]=Math.min(nearest[j][i],v);});
      distance(a,b).forEach((v,i)=>{if(v>=-.01)next[i]=Math.min(next[i],v);});
    });
    others.push(a);nearest.push(next);
  };
  return check;
}
export function patternConflicts(a:PackedRect,others:readonly PackedRect[],_gap:readonly[number,number]){
  // One-off validation avoids building the batch cache.
  if(a.card.excludeFromNeighbors)return 0;
  others=others.filter(b=>!b.card.excludeFromNeighbors);
  const matches=new Set([...edgeNeighbors(a,others)].filter(b=>b.card.key===a.card.key));
  for(const b of others)if(b.card.key===a.card.key&&!matches.has(b)&&edgeNeighbors(b,[a,...others.filter(c=>c!==b)]).has(a))matches.add(b);
  return matches.size;
}
/** Fill around existing placements. Existing cards are the geometry, never a
 * mask over another layout. A viewport extension adds cards without moving any. */
export function fillPacking(cards:readonly PackingSize[],bounds:PackingRect,occupied:readonly PackedRect[],gap:readonly[number,number],seed=0,options:{avoidSameType?:boolean;neighborGap?:readonly[number,number]}={}) {
  const added:PackedRect[]=[];
  if(!cards.length)return added;
  let free=freePackingRects(bounds,occupied,gap);
  let next=seed;const diverse=options.avoidSameType && new Set(cards.map(c=>c.key)).size>1;
  const conflictsAt=diverse?patternConstraint(occupied):undefined;
  while(true) {
    let best:{card:PackingSize;rect:PackingRect;index:number;short:number;area:number;conflicts:number;x:number;y:number}|undefined;
    for(let offset=0;offset<cards.length;offset++) {
      const index=(next+offset)%cards.length,card=cards[index];
      const w=card.width+gap[0],h=card.height+gap[1];
      for(const rect of free) {
        if(w>rect.w || h>rect.h)continue;
        const short=Math.min(rect.w-w,rect.h-h),area=rect.w*rect.h-w*h;
        const positions=diverse?[[rect.x+gap[0]/2,rect.y+gap[1]/2],[rect.x+rect.w-card.width-gap[0]/2,rect.y+gap[1]/2],[rect.x+gap[0]/2,rect.y+rect.h-card.height-gap[1]/2],[rect.x+rect.w-card.width-gap[0]/2,rect.y+rect.h-card.height-gap[1]/2]]:[[rect.x+gap[0]/2,rect.y+gap[1]/2]];
        for(const [x,y] of positions){
          const conflicts=diverse?conflictsAt!({card,x,y}):0;
          if(!best || conflicts<best.conflicts || conflicts===best.conflicts && (short<best.short || short===best.short && area<best.area))best={card,rect,index,short,area,conflicts,x,y};
        }
      }
      if(best?.conflicts===0)break;
    }
    if(!best || diverse && best.conflicts>0)break;
    const {card}=best;
    const at={card,x:best.x,y:best.y};
    added.push(at);conflictsAt?.add(at);free=subtractPackingRect(free,padded(at,gap));next=best.index+1;
  }
  return added;
}
