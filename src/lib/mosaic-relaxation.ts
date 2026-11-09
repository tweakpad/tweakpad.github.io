import { freePackingRects, subtractPackingRect, patternConflicts } from './rect-packing.ts';

/** Bounded shared-edge solver shared by the inspector and homepage. No DOM dependencies. */
export interface Range {min:number;preferred:number;max:number}
export interface MosaicCard {key:string;pattern?:string;excludeFromNeighbors?:boolean;resizePercent?:number;width:Range;height:Range;captionHeight?:number;heightFloor?:{width:number;minHeight:number}[]}
export interface Rect {x:number;y:number;w:number;h:number}
export interface Cell extends Rect {key:string}
export interface Edge {axis:'x'|'y';position:number;start:number;end:number;gap:number;target:number}
export interface Problem {cards:MosaicCard[];bounds:Rect;gutter:[number,number];seed:number;limit?:number;recordHistory?:boolean;avoidSamePattern?:boolean;tolerance?:number;initialCells?:Cell[];pins?:Cell[];anchors?:{key:string;centerX:number;centerY:number}[];flight?:{from:string;to:string;width:number}}
export interface Result {cells:Cell[];edges:Edge[];status:'converged'|'budget-exhausted'|'infeasible'|'searching'|'best-effort';steps:number;maxError:number;rmsError:number;deviation:number;pocketArea?:number;pockets?:Rect[];boundaryError?:number;failures:string[];retainedPrevious?:boolean}
interface Node {card?:MosaicCard;axis?:'x'|'y';a?:Node;b?:Node;ratio:number;minW:number;maxW:number;minH:number;maxH:number}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function heightFloor(card:MosaicCard,width:number) {
  const samples=card.heightFloor?.slice().sort((a,b)=>a.width-b.width);
  if(!samples?.length)return card.height.min;
  // Conservative step envelope: never interpolate below either adjacent sample.
  const exact=samples.find(p=>Math.abs(p.width-width)<1e-6);if(exact)return Math.max(card.height.min,exact.minHeight);
  const i=samples.findIndex(p=>p.width>=width);
  if(i===0)return Math.max(card.height.min,samples[0].minHeight);
  if(i<0)return Math.max(card.height.min,samples.at(-1)!.minHeight);
  return Math.max(card.height.min,samples[i-1].minHeight,samples[i].minHeight);
}
function tree(cards:MosaicCard[],random:()=>number,aspect=1):Node {
  if(cards.length===1){const c=cards[0];return {card:c,ratio:.5,minW:c.width.min,maxW:c.width.max,minH:c.height.min,maxH:c.height.max};}
  const split=Math.max(1,Math.min(cards.length-1,Math.round(cards.length*(.4+random()*.2))));
  const axis: 'x'|'y'=aspect*(.8+random()*.4)>1?'x':'y';
  const fraction=split/cards.length;
  const n={axis,a:tree(cards.slice(0,split),random,axis==='x'?aspect*fraction:aspect/fraction),b:tree(cards.slice(split),random,axis==='x'?aspect*(1-fraction):aspect/(1-fraction)),ratio:fraction} as Node;
  propagate(n);return n;
}
function spatialTree(cards:MosaicCard[],cells:Cell[],aspect:number,random:()=>number):Node {
  if(cards.length<2)return tree(cards,random,aspect);
  const candidates:{axis:'x'|'y';left:MosaicCard[];right:MosaicCard[];balance:number}[]=[];
  for(const axis of ['x','y'] as const){
    const ordered=cards.map(card=>({card,rect:cells.find(c=>c.key===card.key)!}));
    if(ordered.some(c=>!c.rect))return tree(cards,random,aspect);
    const sorted=ordered.sort((a,b)=>axis==='x' ? a.rect.x+a.rect.w/2-b.rect.x-b.rect.w/2 : a.rect.y+a.rect.h/2-b.rect.y-b.rect.h/2);
    for(let k=1;k<sorted.length;k++){
      const left=sorted.slice(0,k),right=sorted.slice(k);
      const end=Math.max(...left.map(c=>axis==='x'?c.rect.x+c.rect.w:c.rect.y+c.rect.h));
      const start=Math.min(...right.map(c=>axis==='x'?c.rect.x:c.rect.y));
      if(end<=start+1e-6)candidates.push({axis,left:left.map(c=>c.card),right:right.map(c=>c.card),balance:Math.abs(cards.length/2-k)});
    }
  }
  candidates.sort((a,b)=>a.balance-b.balance);
  const split=candidates[0];
  if(!split){const axis=aspect>1?'x':'y';const sorted=[...cards].sort((a,b)=>{const x=cells.find(c=>c.key===a.key)!,y=cells.find(c=>c.key===b.key)!;return axis==='x'?x.x+x.w/2-y.x-y.w/2:x.y+x.h/2-y.y-y.h/2;});const k=Math.ceil(sorted.length/2);return {axis,a:spatialTree(sorted.slice(0,k),cells,aspect/2,random),b:spatialTree(sorted.slice(k),cells,aspect/2,random),ratio:k/cards.length,minW:0,maxW:Infinity,minH:0,maxH:Infinity};}
  const fraction=split.left.length/cards.length;
  return {axis:split.axis,a:spatialTree(split.left,cells,split.axis==='x'?aspect*fraction:aspect/fraction,random),b:spatialTree(split.right,cells,split.axis==='x'?aspect*(1-fraction):aspect/(1-fraction),random),ratio:fraction,minW:0,maxW:Infinity,minH:0,maxH:Infinity};
}
function propagate(n:Node) {
  if(n.card)return;
  const a=n.a!,b=n.b!;propagate(a);propagate(b);
  n.minW=n.axis==='x'?a.minW+b.minW:Math.max(a.minW,b.minW);
  n.maxW=n.axis==='x'?Infinity:Math.min(a.maxW,b.maxW);
  n.minH=n.axis==='y'?a.minH+b.minH:Math.max(a.minH,b.minH);
  n.maxH=n.axis==='y'?Infinity:Math.min(a.maxH,b.maxH);
}
function project(n:Node,r:Rect,g:[number,number],cells:Cell[],edges:Edge[],failures:string[]) {
  if(n.card){const c=n.card;const floor=heightFloor(c,r.w);n.minH=floor;
    if(r.w<c.width.min-1e-6||r.w>c.width.max+1e-6||r.h<floor-1e-6||r.h>c.height.max+1e-6|| (c.captionHeight??0)>g[1])failures.push(c.key);
    cells.push({...r,key:c.key});return;
  }
  const a=n.a!,b=n.b!,x=n.axis==='x',size=x?r.w:r.h;
  const amin=x?a.minW:a.minH,amax=x?a.maxW:a.maxH,bmin=x?b.minW:b.minH,bmax=x?b.maxW:b.maxH;
  const target=g[x?0:1],minGap=Math.max(0,size-amax-bmax),maxGap=size-amin-bmin;
  if(maxGap<minGap){failures.push('partition bounds');return;}
  const gap=clamp(target,minGap,maxGap),lo=Math.max(amin,size-gap-bmax),hi=Math.min(amax,size-gap-bmin);
  if(lo>hi){failures.push('split interval');return;}
  const preferred=(node:Node):number=>node.card ? (x?node.card.width.preferred:node.card.height.preferred) : (x=== (node.axis==='x') ? preferred(node.a!)+preferred(node.b!)+target : Math.max(preferred(node.a!),preferred(node.b!)));
  const ratio=preferred(a)/(preferred(a)+preferred(b));
  n.ratio+=(ratio-n.ratio)*.5;
  const first=clamp((size-gap)*n.ratio,lo,hi);
  edges.push({axis:x?'x':'y',position:(x?r.x:r.y)+first,start:x?r.y:r.x,end:x?r.y+r.h:r.x+r.w,gap,target});
  project(a,{...r,w:x?first:r.w,h:x?r.h:first},g,cells,edges,failures);
  project(b,{...r,x:x?r.x+first+gap:r.x,y:x?r.y:r.y+first+gap,w:x?size-first-gap:r.w,h:x?r.h:size-first-gap},g,cells,edges,failures);
}
/** Only the open segment from the heading's bottom to the target's top.
 * Ordinary card gutters are separate; the flight has no end caps or padding. */
export function flightCorridor(p:Pick<Problem,'flight'>,cells:readonly Cell[]):Rect|undefined {
  if(!p.flight)return;
  const a=cells.find(c=>c.key===p.flight!.from),b=cells.find(c=>c.key===p.flight!.to);
  if(!a || !b || b.y<=a.y+a.h)return;
  return {x:a.x+a.w/2-p.flight.width/2,y:a.y+a.h,w:p.flight.width,h:b.y-a.y-a.h};
}
export function blocksFlight(p:Pick<Problem,'flight'>,cells:readonly Cell[],r:Cell) {
  if(!p.flight || r.key===p.flight.from || r.key===p.flight.to)return false;
  const corridor=flightCorridor(p,cells);return !!corridor && overlap(r,corridor);
}
function overlap(a:Rect,b:Rect){return a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;}
/** Split into disjoint rectangles around pins; pin boundaries never move. */
function regions(bounds:Rect,pins:Cell[],g:[number,number]) {
  let free=[bounds];
  for(const p of pins){const cut={x:p.x-g[0],y:p.y-g[1],w:p.w+g[0]*2,h:p.h+g[1]*2};const next:Rect[]=[];
    for(const r of free){if(!overlap(r,cut)){next.push(r);continue;}
      const left=Math.max(r.x,cut.x),right=Math.min(r.x+r.w,cut.x+cut.w),top=Math.max(r.y,cut.y),bottom=Math.min(r.y+r.h,cut.y+cut.h);
      if(top>r.y)next.push({...r,h:top-r.y});if(bottom<r.y+r.h)next.push({...r,y:bottom,h:r.y+r.h-bottom});
      const middleTop=Math.max(r.y,p.y),middleBottom=Math.min(r.y+r.h,p.y+p.h);
      if(left>r.x && middleBottom>middleTop)next.push({x:r.x,y:middleTop,w:left-r.x,h:middleBottom-middleTop});if(right<r.x+r.w && middleBottom>middleTop)next.push({x:right,y:middleTop,w:r.x+r.w-right,h:middleBottom-middleTop});
    }free=next;
  }return free.filter(r=>r.w>0&&r.h>0);
}
export function resizeAllowance(card:MosaicCard,percent:number):MosaicCard {
  const factor=Math.max(0,Math.min(99,percent))/100;
  return {...card,resizePercent:percent,width:{min:card.width.preferred*(1-factor),preferred:card.width.preferred,max:card.width.preferred*(1+factor)},height:{min:card.height.preferred*(1-factor),preferred:card.height.preferred,max:card.height.preferred*(1+factor)}};
}
function measuredEdges(cells:Cell[],g:[number,number]):Edge[]{
  const edges:Edge[]=[];
  for(const a of cells)for(const axis of ['x','y'] as const){
    const others=cells.filter(b=>b!==a && (axis==='x' ? b.x>=a.x+a.w && b.y<a.y+a.h && b.y+b.h>a.y : b.y>=a.y+a.h && b.x<a.x+a.w && b.x+b.w>a.x));
    others.sort((b,c)=>axis==='x'?b.x-c.x:b.y-c.y);const b=others[0];
    if(b)edges.push({axis,position:axis==='x'?a.x+a.w:a.y+a.h,start:axis==='x'?Math.max(a.y,b.y):Math.max(a.x,b.x),end:axis==='x'?Math.min(a.y+a.h,b.y+b.h):Math.min(a.x+a.w,b.x+b.w),gap:axis==='x'?b.x-a.x-a.w:b.y-a.y-a.h,target:g[axis==='x'?0:1]});
  }return edges;
}
function bestEffortSeed(p:Problem):Result {
  const cells:Cell[]=[...(p.pins??[])];
  for(const c of p.cards){if(cells.some(r=>r.key===c.key))continue;
    const anchor=p.anchors?.find(a=>a.key===c.key),initial=p.initialCells?.find(r=>r.key===c.key);
    const w=c.width.preferred,h=Math.min(c.height.max,Math.max(c.height.preferred,heightFloor(c,w)));
    const preferred={key:c.key,x:anchor?anchor.centerX-w/2:initial?.x??p.bounds.x,y:anchor?anchor.centerY-h/2:initial?.y??p.bounds.y,w,h};
    if(!cells.some(r=>overlap(preferred,r))){cells.push(preferred);continue;}
    const xs=[p.bounds.x,...cells.map(r=>r.x+r.w+p.gutter[0])],ys=[p.bounds.y,...cells.map(r=>r.y+r.h+p.gutter[1])];
    let best:Cell|undefined,score=Infinity;
    for(const x of xs)for(const y of ys){const r={key:c.key,x,y,w,h};if(cells.some(c=>overlap({...r,x:x-p.gutter[0],y:y-p.gutter[1],w:w+p.gutter[0]*2,h:h+p.gutter[1]*2},c)))continue;const value=Math.max(0,x+w-p.bounds.x-p.bounds.w)*10000+(y-p.bounds.y)*100+(x-p.bounds.x);if(value<score){best=r;score=value;}}
    cells.push(best??{key:c.key,x:p.bounds.x,y:Math.max(p.bounds.y,...cells.map(r=>r.y+r.h))+p.gutter[1],w,h});
  }
  const edges=measuredEdges(cells,p.gutter);
  const pockets=measurePockets(cells,p);
  return {cells,edges,pockets,pocketArea:pockets[0]?pockets[0].w*pockets[0].h:0,status:'best-effort',steps:0,boundaryError:Math.max(Math.abs(Math.min(...cells.map(c=>c.x))-p.bounds.x),Math.abs(Math.min(...cells.map(c=>c.y))-p.bounds.y),Math.abs(Math.max(...cells.map(c=>c.x+c.w))-p.bounds.x-p.bounds.w),Math.abs(Math.max(...cells.map(c=>c.y+c.h))-p.bounds.y-p.bounds.h)),maxError:Math.max(0,...edges.map(e=>Math.abs(e.gap-e.target))),rmsError:Math.sqrt(edges.reduce((s,e)=>s+(e.gap-e.target)**2,0)/Math.max(1,edges.length)),deviation:0,failures:[]};
}
export function measurePockets(cells:Cell[],p:Problem):Rect[]{
  let free=freePackingRects(p.bounds,cells.map(c=>({x:c.x,y:c.y,card:{key:c.key,width:c.w,height:c.h}})),p.gutter);
  const flight=flightCorridor(p,cells);if(flight)free=subtractPackingRect(free,flight);
  return free.filter(r=>r.w>1 && r.h>1 && r.x>p.bounds.x+1 && r.y>p.bounds.y+1 && r.x+r.w<p.bounds.x+p.bounds.w-1 && r.y+r.h<p.bounds.y+p.bounds.h-1).sort((a,b)=>b.w*b.h-a.w*a.h);
}
function evaluateCells(cells:Cell[],p:Problem,steps:number):Result {
  const edges=measuredEdges(cells,p.gutter);
  const pockets=measurePockets(cells,p);
  return {cells,edges,pockets,pocketArea:pockets[0]?pockets[0].w*pockets[0].h:0,status:'best-effort',steps,boundaryError:Math.max(Math.abs(Math.min(...cells.map(c=>c.x))-p.bounds.x),Math.abs(Math.min(...cells.map(c=>c.y))-p.bounds.y),Math.abs(Math.max(...cells.map(c=>c.x+c.w))-p.bounds.x-p.bounds.w),Math.abs(Math.max(...cells.map(c=>c.y+c.h))-p.bounds.y-p.bounds.h)),maxError:Math.max(0,...edges.map(e=>Math.abs(e.gap-e.target))),rmsError:Math.sqrt(edges.reduce((s,e)=>s+(e.gap-e.target)**2,0)/Math.max(1,edges.length)),deviation:cells.reduce((s,r)=>{const c=p.cards.find(c=>c.key===r.key)!;return s+((r.w-c.width.preferred)/c.width.preferred)**2+((r.h-c.height.preferred)/c.height.preferred)**2;},0),failures:[]};
}
/** The two-bank seed is an intro constraint only. Re-seed the free areas
 * beyond its endpoints as full-width regions, including the former centerline. */
export function releaseOutsideFlight(p:Problem,seed:Cell[],rows=false):Cell[] {
  if(!p.flight)return structuredClone(seed);
  const cells=structuredClone(seed),a=cells.find(c=>c.key===p.flight!.from),b=cells.find(c=>c.key===p.flight!.to);
  if(!a||!b)return cells;
  const frozen=new Set([...(p.pins??[]).map(c=>c.key),...(p.anchors??[]).map(c=>c.key)]);
  const center=a.x+a.w/2;
  for(const direction of [-1,1]){
    const moving=cells.filter(c=>!frozen.has(c.key) && (direction<0?c.y+c.h<=a.y:c.y>=b.y+b.h));
    if(!moving.length)continue;
    const keys=new Set(moving.map(c=>c.key));
    const transform=(c:Cell)=>({...c,y:direction<0?-c.y-c.h:c.y});
    const fixed=cells.filter(c=>!keys.has(c.key)).map(transform);
    const pending=moving.map(transform);
    const maxW=Math.max(...pending.map(c=>c.w)),maxH=Math.max(...pending.map(c=>c.h));
    const w=Math.max(p.bounds.w,maxW+p.gutter[0]);
    const start=direction<0?-a.y:b.y+b.h;
    const area={x:center-w/2,y:start+p.gutter[1]/2,w,h:Math.max(maxH+p.gutter[1],direction<0?-p.bounds.y-start:p.bounds.y+p.bounds.h-start)};
    while(pending.length){
      const free=freePackingRects(area,fixed.map(c=>({x:c.x,y:c.y,card:{key:c.key,width:c.w,height:c.h}})),p.gutter);
      let choice:{index:number;x:number;y:number;score:number}|undefined;
      for(let index=0;index<pending.length;index++){
        const c=pending[index];
        for(const r of free){if(c.w+p.gutter[0]>r.w || c.h+p.gutter[1]>r.h)continue;
          const x=clamp(center-c.w/2,r.x+p.gutter[0]/2,r.x+r.w-p.gutter[0]/2-c.w),y=r.y+p.gutter[1]/2;
          const score=(y-area.y)*10000+Math.abs(x+c.w/2-center);
          if(!choice||score<choice.score)choice={index,x,y,score};
        }
      }
      if(!choice){area.h+=maxH+p.gutter[1];continue;}
      if(rows){
        const seed=pending[choice.index],spec=p.cards.find(c=>c.key===seed.key)!;
        let lo=spec.height.min,hi=spec.height.max;
        const available=free.find(r=>choice!.x>=r.x && choice!.x+seed.w<=r.x+r.w && Math.abs(choice!.y-r.y-p.gutter[1]/2)<1)!;
        if(available){
          const group=[seed];let minWidth=spec.width.min;
          for(const c of pending){if(c===seed)continue;const q=p.cards.find(q=>q.key===c.key)!;const lower=Math.max(lo,q.height.min),upper=Math.min(hi,q.height.max,available.h-p.gutter[1]);if(lower<=upper && minWidth+p.gutter[0]+q.width.min<=available.w-p.gutter[0]){group.push(c);lo=lower;hi=upper;minWidth+=p.gutter[0]+q.width.min;}}
          const specs=group.map(c=>p.cards.find(q=>q.key===c.key)!);
          const widths=specs.map(q=>q.width.preferred);
          const maximum=specs.reduce((s,q)=>s+q.width.max,0);
          const target=Math.min(available.w-p.gutter[0]-p.gutter[0]*(group.length-1),maximum);
          let remainder=target-widths.reduce((a,b)=>a+b,0);
          for(let pass=0;pass<group.length+1 && Math.abs(remainder)>.01;pass++)for(let n=0;n<widths.length;n++){const delta=clamp(remainder/(widths.length-n),specs[n].width.min-widths[n],specs[n].width.max-widths[n]);widths[n]+=delta;remainder-=delta;}
          const rowHeight=clamp(group.reduce((s,c)=>s+c.h,0)/group.length,Math.max(lo,...specs.map((q,i)=>heightFloor(q,widths[i]))),Math.min(hi,available.h-p.gutter[1]));
          const rowWidth=widths.reduce((a,b)=>a+b,0)+p.gutter[0]*(group.length-1);
          let x=clamp(center-rowWidth/2,available.x+p.gutter[0]/2,available.x+available.w-p.gutter[0]/2-rowWidth);
          if(rowHeight>=lo && rowHeight<=hi && rowHeight<=available.h-p.gutter[1] && specs.every((q,i)=>rowHeight>=heightFloor(q,widths[i]))){
            for(let n=0;n<group.length;n++){const c=group[n];c.x=x;c.y=choice.y;c.w=widths[n];c.h=rowHeight;fixed.push(c);Object.assign(cells.find(r=>r.key===c.key)!,{x:c.x,y:direction<0?-c.y-c.h:c.y,w:c.w,h:c.h});pending.splice(pending.indexOf(c),1);x+=c.w+p.gutter[0];}continue;
          }
        }
      }
      const c=pending.splice(choice.index,1)[0];c.x=choice.x;c.y=choice.y;fixed.push(c);
      Object.assign(cells.find(r=>r.key===c.key)!,{x:c.x,y:direction<0?-c.y-c.h:c.y});
    }
  }return cells;
}
function compressPocket(cells:Cell[],p:Problem,pocket:Rect,axis:'x'|'y'):Cell[]|undefined {
  const x=axis==='x',fixed=new Set([...(p.pins??[]).map(c=>c.key),...(p.anchors??[]).map(c=>c.key)]);
  const low=x?pocket.x:pocket.y,high=low+(x?pocket.w:pocket.h);
  const anchors=cells.filter(c=>fixed.has(c.key));
  const forward=anchors.every(c=>(x?c.x+c.w:c.y+c.h)<=low);
  const reverse=anchors.every(c=>(x?c.x:c.y)>=high);
  if(!forward&&!reverse)return;
  const sign=forward?1:-1,start=forward?low:-high,length=high-low;
  if(length<=1)return;
  const fraction=(v:number)=>clamp((v-start)/length,0,1);
  let amount=Math.min(32,length*.25);
  for(const cell of cells){const c=p.cards.find(c=>c.key===cell.key)!;const position=x?cell.x:cell.y,size=x?cell.w:cell.h,q=sign>0?position:-position-size;
    const share=fraction(q+size)-fraction(q),min=x?c.width.min:Math.max(c.height.min,heightFloor(c,cell.w));
    if(share>0)amount=Math.min(amount,Math.max(0,size-min)/share);
  }
  if(amount<.1)return;
  const mapped=(v:number)=>v-amount*fraction(v);
  const out=cells.map(cell=>{const position=x?cell.x:cell.y,size=x?cell.w:cell.h,q=sign>0?position:-position-size,a=mapped(q),b=mapped(q+size);return {...cell,[x?'x':'y']:sign>0?a:-b,[x?'w':'h']:b-a};});
  for(const cell of out){const c=p.cards.find(c=>c.key===cell.key)!;if(cell.h<heightFloor(c,cell.w)-1e-6)return;const next=out.filter(b=>b!==cell&&b.y>=cell.y+cell.h-1e-6&&b.x<cell.x+cell.w&&b.x+b.w>cell.x).sort((a,b)=>a.y-b.y)[0];if(next&&next.y-cell.y-cell.h<(c.captionHeight??0)-1e-6)return;}
  return out;
}
function relaxMeasured(seed:Cell[],p:Problem,step:number):Cell[] {
  const cells=structuredClone(seed),fixed=new Set([...(p.pins??[]).map(c=>c.key),...(p.anchors??[]).map(c=>c.key)]);
  const valid=(r:Cell,except:Set<string>)=>!cells.some(b=>!except.has(b.key)&&overlap({x:r.x-p.gutter[0],y:r.y-p.gutter[1],w:r.w+2*p.gutter[0],h:r.h+2*p.gutter[1]},b)) && !blocksFlight(p,cells,r);
  const order=cells.map((_,i)=>(i+step)%cells.length);
  for(const i of order){const a=cells[i];if(fixed.has(a.key))continue;const c=p.cards.find(c=>c.key===a.key)!;
    for(const axis of ['x','y'] as const){const x=axis==='x',g=p.gutter[x?0:1],position=x?a.x:a.y,size=x?a.w:a.h;
      const related=cells.filter(b=>b!==a && (x?b.y<a.y+a.h && b.y+b.h>a.y:b.x<a.x+a.w && b.x+b.w>a.x));
      const before=related.filter(b=>(x?b.x+b.w:b.y+b.h)<=position+1e-6).sort((b,c)=>x?c.x+c.w-b.x-b.w:c.y+c.h-b.y-b.h)[0];
      const after=related.filter(b=>(x?b.x:b.y)>=position+size-1e-6).sort((b,c)=>x?b.x-c.x:b.y-c.y)[0];
      const low=before?(x?before.x+before.w:before.y+before.h)+g:position;
      const high=after?(x?after.x:after.y)-g:position+size;
      const limits=x?c.width:c.height,min=x?limits.min:Math.max(limits.min,heightFloor(c,a.w));
      const targetSize=clamp(high-low,min,limits.max),targetPos=before&&after?(low+high-targetSize)/2:before?low:after?high-targetSize:position;
      const r={...a,[x?'x':'y']:position+(targetPos-position)*.4,[x?'w':'h']:size+(targetSize-size)*.4};
      if(r.h>=heightFloor(c,r.w)-1e-6 && valid(r,new Set([a.key])))Object.assign(a,r);
    }
  }
  // Explore assignment changes as well as resizing; this is necessary when a
  // short card occupies a pocket bounded by much taller neighbors.
  const a=cells[step%cells.length],b=cells[(Math.floor(step/cells.length)+step+1)%cells.length];
  if(a&&b&&!fixed.has(a.key)&&!fixed.has(b.key)&&a!==b){const ra={...a,x:b.x,y:b.y},rb={...b,x:a.x,y:a.y};const except=new Set([a.key,b.key]);if(!overlap(ra,rb)&&valid(ra,except)&&valid(rb,except)){Object.assign(a,ra);Object.assign(b,rb);}}
  return cells;
}
/** Final presentation pass: retain dimensions and center each movable card in
 * its containing free rectangle. Reservations and visible pins remain fixed. */
export function centerAvailableSpace(cells:Cell[],p:Problem,axes:readonly ('x'|'y')[]=['x','y']):Cell[]{
  const out=structuredClone(cells),fixed=new Set([...(p.pins??[]).map(c=>c.key),...(p.anchors??[]).map(c=>c.key)]);
  const captions=new Map(p.cards.map(c=>[c.key,c.captionHeight??0]));
  const corridor=flightCorridor(p,out);
  const patterns=new Map(p.cards.map(c=>[c.key,c.pattern??c.key]));
  const excluded=new Set(p.cards.filter(c=>c.excludeFromNeighbors).map(c=>c.key));
  const diverse=p.avoidSamePattern && new Set(patterns.values()).size>1;
  const validPattern=(c:Cell)=>!diverse || !patternConflicts({x:c.x,y:c.y,card:{key:patterns.get(c.key)!,excludeFromNeighbors:excluded.has(c.key),width:c.w,height:c.h+(captions.get(c.key)??0)}},out.filter(b=>b!==c).map(b=>({x:b.x,y:b.y,card:{key:patterns.get(b.key)!,excludeFromNeighbors:excluded.has(b.key),width:b.w,height:b.h+(captions.get(b.key)??0)}})),p.gutter);
  // One sweep is not enough: moving the right/bottom neighbor changes the
  // available space of cards already visited. Rebalance until stable, bounded.
  for(let pass=0;pass<24;pass++){
    let movement=0;
    for(const c of out){
      if(fixed.has(c.key))continue;
      const h=c.h+(captions.get(c.key)??0),oldX=c.x,oldY=c.y;
      const obstacles:Rect[]=out.filter(b=>b!==c).map(b=>({...b,h:b.h+(captions.get(b.key)??0)}));
      if(corridor)obstacles.push(corridor);
      let left=p.bounds.x,right=p.bounds.x+p.bounds.w;
      for(const b of obstacles)if(b.y<c.y+h-1e-6 && b.y+b.h>c.y+1e-6){
        if(b.x+b.w<=c.x+1e-6)left=Math.max(left,b.x+b.w);
        if(b.x>=c.x+c.w-1e-6)right=Math.min(right,b.x);
      }
      if(axes.includes('x') && right-left>=c.w-1e-6){c.x=(left+right-c.w)/2;if(!validPattern(c))c.x=oldX;}
      let top=p.bounds.y,bottom=p.bounds.y+p.bounds.h;
      for(const b of obstacles)if(b.x<c.x+c.w-1e-6 && b.x+b.w>c.x+1e-6){
        if(b.y+b.h<=c.y+1e-6)top=Math.max(top,b.y+b.h);
        if(b.y>=c.y+h-1e-6)bottom=Math.min(bottom,b.y);
      }
      if(axes.includes('y') && bottom-top>=h-1e-6){c.y=(top+bottom-h)/2;if(!validPattern(c))c.y=oldY;}
      movement=Math.max(movement,Math.abs(c.x-oldX),Math.abs(c.y-oldY));
    }
    if(movement<.05)break;
  }
  return out;
}

export function createRelaxation(problem:Problem,_previous?:Result) {
  const p=structuredClone(problem);p.cards=p.cards.map(c=>c.resizePercent===undefined?c:resizeAllowance(c,c.resizePercent));
  const limit=Number.isFinite(p.limit??200)?Math.max(0,Math.floor(p.limit??200)):0,tolerance=p.tolerance??1;
  let seed=p.seed>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  let steps=0,attempt=0,stale=0,trees:{node:Node;bounds:Rect}[]=[],best:Result|undefined;
  const history:Result[]=[];const failures:string[]=[];
  for(const c of p.cards)for(const r of [c.width,c.height])if(![r.min,r.preferred,r.max].every(Number.isFinite)||r.min<=0||r.min>r.preferred||r.preferred>r.max)failures.push(`Invalid range: ${c.key}`);
  if(!p.cards.length)failures.push('Invalid empty catalog');
  if(new Set(p.cards.map(c=>c.key)).size!==p.cards.length)failures.push('Invalid duplicate card keys');
  const pins=[...(p.pins??[])];for(const pin of pins){const c=p.cards.find(c=>c.key===pin.key);if(!c||pin.w<c.width.min||pin.w>c.width.max||pin.h<heightFloor(c,pin.w)||pin.h>c.height.max)failures.push(`Invalid pin: ${pin.key}`);}
  for(let i=0;i<pins.length;i++)for(let j=i+1;j<pins.length;j++)if(overlap(pins[i],pins[j]))failures.push('Overlapping pins');
  const restart=()=>{
    pins.splice(0,pins.length,...(p.pins??[]));
    for(const anchor of p.anchors??[]){const c=p.cards.find(c=>c.key===anchor.key)!;const w=attempt===0?c.width.preferred:c.width.min+random()*(c.width.max-c.width.min);const h=attempt===0?c.height.preferred:Math.max(heightFloor(c,w),c.height.min)+random()*Math.max(0,c.height.max-Math.max(heightFloor(c,w),c.height.min));pins.push({key:c.key,x:anchor.centerX-w/2,y:anchor.centerY-h/2,w,h});}
    const cards=p.cards.filter(c=>!pins.some(pin=>pin.key===c.key));
    for(let i=cards.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]];}
    let areas=regions(p.bounds,pins,p.gutter);
    const corridor=flightCorridor(p,pins);if(corridor)areas=areas.flatMap(r=>regions(r,[{...corridor,key:'spine'}],[0,0]));const groups=areas.map(()=>[] as MosaicCard[]);
    if(p.initialCells && cards.length>=areas.length){
      const total=areas.reduce((sum,r)=>sum+r.w*r.h,0);
      const quota=areas.map(r=>Math.max(1,Math.floor(cards.length*r.w*r.h/total)));
      while(quota.reduce((a,b)=>a+b,0)>cards.length){const i=quota.indexOf(Math.max(...quota));quota[i]--;}
      while(quota.reduce((a,b)=>a+b,0)<cards.length){const i=areas.map((r,i)=>r.w*r.h/(quota[i]+1)).reduce((best,v,i,arr)=>v>arr[best]?i:best,0);quota[i]++;}
      const pool=[...cards];
      for(const i of areas.map((_,i)=>i).sort((a,b)=>Math.min(areas[a].w,areas[a].h)-Math.min(areas[b].w,areas[b].h))){
        const area=areas[i];
        for(let n=0;n<quota[i];n++){
          const eligible=pool.filter(c=>c.width.min<=area.w && c.height.min<=area.h);
          const choices=eligible.length?eligible:pool;
          if(attempt===0)choices.sort((a,b)=>{const x=p.initialCells!.find(c=>c.key===a.key)!,y=p.initialCells!.find(c=>c.key===b.key)!;return Math.hypot(x.x+x.w/2-area.x-area.w/2,x.y+x.h/2-area.y-area.h/2)-Math.hypot(y.x+y.w/2-area.x-area.w/2,y.y+y.h/2-area.y-area.h/2);});
          const c=choices[0];if(c){groups[i].push(c);pool.splice(pool.indexOf(c),1);}
        }
      }
    }else cards.forEach((c,i)=>{if(groups.length)groups[i%groups.length].push(c);});
    trees=areas.map((bounds,i)=>({bounds,node:groups[i].length?(attempt===0 && p.initialCells ? spatialTree(groups[i],p.initialCells,bounds.w/bounds.h,random) : tree(groups[i],random,bounds.w/bounds.h)):undefined})).filter(t=>t.node) as typeof trees;
    if(groups.some(group=>!group.length))failures.push('Insufficient cards to fill pinned regions');
  };
  restart();
  const quality=(r:Result)=>p.initialCells?(r.pocketArea??Infinity):Math.max(r.maxError,r.boundaryError??0);
  const originalSeed=bestEffortSeed(p);
  let fallback=p.initialCells && p.flight?evaluateCells(releaseOutsideFlight(p,originalSeed.cells),p,0):originalSeed;
  const relaxedSeeds=[fallback];
  if(p.initialCells && p.flight){const rows=evaluateCells(releaseOutsideFlight(p,originalSeed.cells,true),p,0);const a=rows.cells.find(c=>c.key===p.flight!.from)!,b=rows.cells.find(c=>c.key===p.flight!.to)!;const crossing=(predicate:(c:Cell)=>boolean)=>rows.cells.some(c=>predicate(c)&&c.x<a.x+a.w/2&&c.x+c.w>a.x+a.w/2);if(crossing(c=>c.y+c.h<=a.y)&&crossing(c=>c.y>=b.y+b.h)){relaxedSeeds.push(rows);if(quality(rows)<quality(fallback))fallback=rows;}}
  let relaxed=fallback;
  const pending=()=>steps<limit && !failures.some(f=>f.startsWith('Invalid')||f==='Overlapping pins');
  let centered:Result|undefined;
  const result=():Result=>{
    const chosen=best && (quality(best)<quality(relaxed) || quality(best)===quality(relaxed) && best.rmsError<=relaxed.rmsError) ? best : relaxed;
    if(!pending() && !(chosen===best && best.maxError<=tolerance)) {
      centered??=evaluateCells(centerAvailableSpace(chosen.cells,p),p,steps);
      return {...centered,status:'best-effort',steps,failures:best?[]:[...new Set(failures)]};
    }
    return {...chosen,status:chosen===best && best.maxError<=tolerance?'converged':pending()?'searching':'best-effort',steps,failures:best?[]:[...new Set(failures)],retainedPrevious:undefined};
  };
  return {history,initial:structuredClone(originalSeed),get result(){return result();},get done(){return steps>=limit || !!best&&best.maxError<=tolerance || failures.some(f=>f.startsWith('Invalid')||f==='Overlapping pins');},
    step(){if(this.done)return result();steps++;const seedIndex=(steps-1)%relaxedSeeds.length;relaxed=relaxedSeeds[seedIndex];
      if(p.initialCells){const candidate=evaluateCells(relaxMeasured(relaxed.cells,p,steps),p,steps);if(quality(candidate)<quality(relaxed)-1e-6 || quality(candidate)<=quality(relaxed)+1e-6 && candidate.rmsError<relaxed.rmsError)relaxed=candidate;}
      if(p.initialCells){
        for(const pocket of (relaxed.pockets??[]).slice(0,3))for(const axis of ['x','y'] as const){const cells=compressPocket(relaxed.cells,p,pocket,axis);if(!cells)continue;const candidate=evaluateCells(cells,p,steps);if(quality(candidate)<quality(relaxed)-1e-6 && candidate.rmsError<=relaxed.rmsError+1e-6)relaxed=candidate;}
      }
      relaxedSeeds[seedIndex]=relaxed;relaxed=relaxedSeeds.reduce((a,b)=>quality(a)<quality(b) || quality(a)===quality(b)&&a.rmsError<=b.rmsError?a:b);
      const cells=[...pins],edges:Edge[]=[],errors:string[]=[];
      for(const t of trees){propagate(t.node);project(t.node,t.bounds,p.gutter,cells,edges,errors);}
      if(cells.length!==p.cards.length)errors.push('Unassigned cards');
      for(const cell of cells)if(cell.x<p.bounds.x-1e-6||cell.y<p.bounds.y-1e-6||cell.x+cell.w>p.bounds.x+p.bounds.w+1e-6||cell.y+cell.h>p.bounds.y+p.bounds.h+1e-6)errors.push('Outside region');
      for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++)if(overlap(cells[i],cells[j]))errors.push('Overlap');
      // Measure nearest adjacent surfaces independently of partition bookkeeping.
      for(const a of cells)for(const axis of ['x','y'] as const){
        const others=cells.filter(b=>b!==a && (axis==='x' ? b.x>=a.x+a.w && b.y<a.y+a.h && b.y+b.h>a.y : b.y>=a.y+a.h && b.x<a.x+a.w && b.x+b.w>a.x));
        others.sort((b,c)=>axis==='x'?b.x-c.x:b.y-c.y);const b=others[0];
        if(b)edges.push({axis,position:axis==='x'?a.x+a.w:a.y+a.h,start:axis==='x'?Math.max(a.y,b.y):Math.max(a.x,b.x),end:axis==='x'?Math.min(a.y+a.h,b.y+b.h):Math.min(a.x+a.w,b.x+b.w),gap:axis==='x'?b.x-a.x-a.w:b.y-a.y-a.h,target:p.gutter[axis==='x'?0:1]});
      }
      if(!errors.length && !failures.includes('Insufficient cards to fill pinned regions')){
        const maxError=Math.max(0,...edges.map(e=>Math.abs(e.gap-e.target))),rmsError=Math.sqrt(edges.reduce((s,e)=>s+(e.gap-e.target)**2,0)/Math.max(1,edges.length));
        const deviation=cells.reduce((s,r)=>{const c=p.cards.find(c=>c.key===r.key)!;return s+((r.w-c.width.preferred)/c.width.preferred)**2+((r.h-c.height.preferred)/c.height.preferred)**2;},0);
        const pockets=measurePockets(cells,p);
        const candidate:Result={cells,edges,pockets,pocketArea:pockets[0]?pockets[0].w*pockets[0].h:0,status:maxError<=tolerance?'converged':'budget-exhausted',steps,maxError,rmsError,deviation,failures:[]};
        if(!best||quality(candidate)<quality(best)||quality(candidate)===quality(best)&&(rmsError<best.rmsError||rmsError===best.rmsError&&deviation<best.deviation)){best=candidate;stale=0;}else stale++;
      }else{stale++;failures.push(...errors);}
      if(p.recordHistory!==false)history.push(structuredClone(result()));
      if((stale>=8||steps%50===0)&&attempt<3){attempt++;stale=0;restart();}
      return result();
    },run(){while(!this.done)this.step();return result();}};
}
