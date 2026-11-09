import {relaxHomeGrid,type HomeCell} from './home-mosaic';
import {fillPacking,patternConflicts,type PackedRect,type PackingRect,type PackingSize} from './rect-packing';
import {fillResponsiveRemainders} from './responsive-fill';
import {responsivePackingSizes} from './responsive-sizes';
import {fitGutters} from './gutter-fit';
import {type Problem} from './mosaic-relaxation';
export type GridJob =
  | {type:'intro';cells:HomeCell[];bounds:PackingRect;gutter:[number,number];pins:string[];flight:Problem['flight']}
  | {type:'extend';catalog:PackingSize[];bounds:PackingRect;occupied:PackedRect[];gutter:[number,number];seed:number;relax:boolean;profiles:[string,NonNullable<HomeCell['profile']>][]};
self.onmessage=({data}:{data:{id:number;job:GridJob}})=>{
  const {id,job}=data;
  try {
    if(job.type==='intro'){
      self.postMessage({id,result:relaxHomeGrid(job.cells,job.bounds,job.gutter,job.pins,job.flight)});
      return;
    }
    const occupied=[...job.occupied];
    const refill:PackedRect[]=[];
    if(!job.relax){
      const candidates=[...job.catalog,...responsivePackingSizes(job.catalog,new Map(job.profiles))].sort((a,b)=>a.height-b.height);
      for(const card of candidates){
        const p={card,x:-card.width/2,y:-card.height/2};
        if(occupied.some(b=>p.x<b.x+b.card.width+job.gutter[0]&&p.x+card.width+job.gutter[0]>b.x&&p.y<b.y+b.card.height+job.gutter[1]&&p.y+card.height+job.gutter[1]>b.y))continue;
        if(patternConflicts(p,occupied,job.gutter))continue;
        refill.push(p);occupied.push(p);break;
      }
    }
    const added=fillPacking(job.catalog,job.bounds,occupied,job.gutter,job.seed,{avoidSameType:true});
    added.push(...fillResponsiveRemainders(job.catalog,job.bounds,[...occupied,...added],job.gutter,job.seed+added.length,new Map(job.profiles)));
    self.postMessage({id,result:job.relax?fitGutters(added,occupied,job.catalog,new Map(job.profiles),job.bounds,job.gutter):[...refill,...added]});
  }catch(error){self.postMessage({id,error:String(error)});}
};
