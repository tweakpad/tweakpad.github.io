export interface IntroCardSize { key: string; width: number; height: number; solidHeight?: number }
export interface IntroPlacement { role: 'hero' | 'landing' | 'context'; card: IntroCardSize; x: number; y: number; bank?: number }

/** Finite, measured masonry around the opening's two anchors and center lane. */
export function introComposition(cards: readonly IntroCardSize[], hero: IntroCardSize, titleCenter: number, distanceCards: number, viewportHeight: number, gap: readonly [number,number], viewportWidth = 1440) {
  const placements: IntroPlacement[] = [{ role:'hero', card:hero, x:-hero.width/2, y:-hero.height/2 }];
  if (!cards.length) return placements;
  const heights = cards.map(card=>card.height).sort((a,b)=>a-b);
  const distance = Math.max(viewportHeight, (heights[Math.floor(heights.length/2)]+gap[1])*Math.max(1,distanceCards));
  const landing = cards[0];
  const targetEnd = -hero.height/2 + titleCenter + distance;
  const firstCards=[cards[1 % cards.length],cards[2 % cards.length]];
  const bankStart=Math.max(hero.height/2,...firstCards.map(card=>card.height-(card.solidHeight ?? card.height)/2))+gap[1];
  const course:IntroCardSize[]=[];
  let end=bankStart;
  let next=1;
  // Place the landing on a completed course rather than cutting through a
  // naturally sized card and moving that whole card away from the lane.
  do {
    const card=cards[next++ % cards.length];
    course.push(card);end+=card.height+gap[1];
  } while(end<targetEnd);

  placements.push({ role:'landing', card:landing, x:-landing.width/2, y:end });
  const widest = Math.max(...cards.map(card=>card.width));
  const start = -hero.height/2-viewportHeight;
  const bottom = end+landing.height+viewportHeight;
  type Rect = {x:number;y:number;w:number;h:number};
  const overlaps=(a:Rect,b:Rect)=>a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;
  const contains=(a:Rect,b:Rect)=>a.x<=b.x && a.y<=b.y && a.x+a.w>=b.x+b.w && a.y+a.h>=b.y+b.h;
  // Keep all maximal empty rectangles. Splitting just into shelves would reserve
  // the height of the tallest card, recreating the empty cells this avoids.
  const subtract=(free:Rect[], used:Rect) => {
    const split:Rect[]=[];
    for(const r of free) {
      if(!overlaps(r,used)){split.push(r);continue;}
      if(used.x>r.x)split.push({...r,w:used.x-r.x});
      if(used.x+used.w<r.x+r.w)split.push({...r,x:used.x+used.w,w:r.x+r.w-used.x-used.w});
      if(used.y>r.y)split.push({...r,h:used.y-r.y});
      if(used.y+used.h<r.y+r.h)split.push({...r,y:used.y+used.h,h:r.y+r.h-used.y-used.h});
    }
    return split.filter((r,i)=>r.w>0 && r.h>0 && !split.some((other,j)=>j!==i && contains(other,r) && (j<i || !contains(r,other))));
  };
  let index=3;
  const put=(card:IntroCardSize,y:number,side:number,edge=gap[0]/2,bank?:number)=>
    placements.push({role:'context',card,x:side<0 ? -edge-card.width : edge,y,bank});
  // Both banks use the same measured course in different orders. Their total
  // height agrees without resizing cards or leaving a remainder at the end.
  for(const side of [-1,1]) {
    const first=firstCards[side<0 ? 0 : 1];
    const firstY=-(first.solidHeight ?? first.height)/2;
    put(first,firstY,side,hero.width/2+gap[0]);
    const ordered=side<0 ? course : [...course].reverse();
    let y=bankStart;
    for(const card of ordered){put(card,y,side,gap[0]/2,side);y+=card.height+gap[1];}
    // Flank the landing only over its own height; the preceding bank never
    // shifts sideways to make room for an anchor it has not reached yet.
    const flank=cards.filter(card=>card!==landing && card.height<=landing.height)
      .sort((a,b)=>b.height-a.height)[0] ?? landing;
    put(flank,end+landing.height-flank.height,side,landing.width/2+gap[0]);
    y=end+landing.height+gap[1];
    while(y<bottom) {
      const card=cards[index++ % cards.length];
      put(card,y,side);y+=card.height+gap[1];
    }
    y=Math.min(firstY,-hero.height/2)-gap[1];
    while(y>start) {
      const card=cards[index++ % cards.length];
      y-=card.height;put(card,y,side);y-=gap[1];
    }
  }
  for(const side of [-1,1]) {
    const inner=gap[0]/2;
    let free:Rect[]=[{x:inner,y:start,w:viewportWidth/2+widest*2-inner,h:bottom-start}];
    for(const anchor of placements) {
      const x=side<0 ? -anchor.x-anchor.card.width : anchor.x;
      free=subtract(free,{x,y:anchor.y,w:anchor.card.width+gap[0],h:anchor.card.height+gap[1]});
    }
    while(true) {
      let choice:{rect:Rect;card:IntroCardSize;index:number;y:number;score:number}|undefined;
      for(const rect of free) {
        for(let attempt=0;attempt<cards.length;attempt++) {
          const at=(index+attempt)%cards.length;
          const card=cards[at];
          if(card.width+gap[0]<=rect.w && card.height+gap[1]<=rect.h) {
            // Grow from the hero outwards, rather than allowing an arbitrary
            // offscreen row to dictate empty space around the opening card.
            const y=Math.max(rect.y,Math.min(-card.height/2,rect.y+rect.h-card.height-gap[1]));
            const score=Math.hypot(rect.x+card.width/2,y+card.height/2);
            if(!choice || score<choice.score)choice={rect,card,index:at,y,score};
            break;
          }
        }
      }
      if(!choice)break;
      const {rect,card,y}=choice;
      placements.push({role:'context',card,x:side<0 ? -rect.x-card.width : rect.x,y});
      free=subtract(free,{x:rect.x,y,w:card.width+gap[0],h:card.height+gap[1]});
      index=choice.index+1;
    }
  }
  return placements;
}
