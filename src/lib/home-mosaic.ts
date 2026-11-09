import {avoidPatternNeighbors} from './home-patterns.ts';
import {createRelaxation,centerAvailableSpace, type Cell, type Problem} from './mosaic-relaxation.ts';
export interface HomeCell extends Cell {pattern:string;captionHeight:number;excludeFromNeighbors?:boolean;profile?:{width:number;minHeight:number}[]}
/** Same bounded solver as the inspector, using content-safe height floors. */
export function relaxHomeGrid(cells:HomeCell[],bounds:Problem['bounds'],gutter:[number,number],pins:string[]=[],flight?:Problem['flight'],limit=200) {
  const problem:Problem={bounds,gutter,seed:271828,limit,recordHistory:false,tolerance:1,initialCells:cells,
    cards:cells.map(c=>({key:c.key,excludeFromNeighbors:c.excludeFromNeighbors,width:{min:c.w*.85,preferred:c.w,max:c.w*1.15},height:{min:Math.max(c.h*.85,Math.min(c.h,...(c.profile??[]).map(s=>s.minHeight))),preferred:c.h,max:c.h*1.15},heightFloor:pins.includes(c.key)?undefined:c.profile,captionHeight:c.captionHeight})),
    pins:cells.filter(c=>pins.includes(c.key)),flight};
  const solved=createRelaxation(problem).run().cells;
  const repaired=avoidPatternNeighbors(solved.map(c=>({...cells.find(a=>a.key===c.key)!,...c})),bounds,gutter,new Set(pins),flight);
  const metadata=new Map(repaired.map(c=>[c.key,c]));
  for(const card of problem.cards){card.captionHeight=metadata.get(card.key)!.captionHeight;card.pattern=metadata.get(card.key)!.pattern;card.excludeFromNeighbors=metadata.get(card.key)!.excludeFromNeighbors;}
  problem.avoidSamePattern=true;
  let result:Cell[]=repaired;
  if(flight){
    // Center the initial card in its final available vertical space, then make
    // its center the world origin. The target stays on the same vertical axis.
    let header=result.find(c=>c.key===flight.from)!;
    for(let pass=0;pass<8;pass++){
      const centered=centerAvailableSpace(result,{...problem,flight:undefined,anchors:undefined,pins:result.filter(c=>c.key!==header.key)},['y']).find(c=>c.key===header.key)!;
      const move=Math.abs(centered.y-header.y);header.y=centered.y;
      if(move<.05)break;
      result=centerAvailableSpace(result,{...problem,pins:result.filter(c=>pins.includes(c.key))});
      header=result.find(c=>c.key===flight.from)!;
    }
    const origin=header.y+header.h/2;
    result=result.map(c=>({...c,y:c.y-origin}));
  }
  return result.map(c=>({...metadata.get(c.key)!,...c}));
}

export {responsivePackingSizes} from './responsive-sizes.ts';
