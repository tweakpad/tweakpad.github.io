export interface PoolRect {key:string;x:number;y:number;w:number;h:number}
/** Maximum simultaneous instances during a vertical camera sweep, including
 * the mounting guard. Counts derive from measured geometry, not card names. */
export function openingPoolCounts(cards:PoolRect[],view:{x:number;w:number;h:number;fromY:number;toY:number},guard=256){
  const events=new Map<string,[number,number][]>();
  for(const c of cards){
    if(c.x+c.w<=view.x-guard || c.x>=view.x+view.w+guard)continue;
    const a=Math.max(view.fromY,c.y-view.h-guard),b=Math.min(view.toY,c.y+c.h+guard);
    if(a>=b)continue;
    const list=events.get(c.key)??[];list.push([a,1],[b,-1]);events.set(c.key,list);
  }
  return new Map([...events].map(([key,list])=>{
    let count=0,max=0;for(const [,delta] of list.sort((a,b)=>a[0]-b[0]||a[1]-b[1])){count+=delta;max=Math.max(max,count);}
    return [key,max];
  }));
}
