import test from 'node:test';
import assert from 'node:assert/strict';
import { fillPacking } from '../src/lib/rect-packing.ts';

const collides=(a,b,g)=>a.x<b.x+b.card.width+g[0]-.001 && a.x+a.card.width+g[0]-.001>b.x && a.y<b.y+b.card.height+g[1]-.001 && a.y+a.card.height+g[1]-.001>b.y;
// Independent coverage audit: the bottom-left corner of any vacant region
// occurs at a boundary or an occupied card's padded right/bottom edge.
function vacancies(cards,bounds,poses,gap) {
  const xs=[bounds.x+gap[0]/2,...poses.map(p=>p.x+p.card.width+gap[0])];
  const ys=[bounds.y+gap[1]/2,...poses.map(p=>p.y+p.card.height+gap[1])];
  for(const card of cards)for(const x of xs)for(const y of ys) {
    if(x<bounds.x+gap[0]/2 || y<bounds.y+gap[1]/2 || x+card.width+gap[0]/2>bounds.x+bounds.w || y+card.height+gap[1]/2>bounds.y+bounds.h)continue;
    if(!poses.some(p=>collides({x,y,card},p,gap)))return {x,y,card};
  }
}

test('random catalogs leave no usable card-sized vacancy throughout the packed region',()=>{
  let state=1937;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  for(let scenario=0;scenario<15;scenario++) {
    const cards=Array.from({length:1+Math.floor(random()*15)},(_,i)=>({key:`c${i}`,width:150+Math.round(random()*400),height:160+Math.round(random()*600)}));
    const bounds={x:-1200,y:-1000,w:2400,h:2000},gap=[64,64];
    const poses=fillPacking(cards,bounds,[],gap);
    assert.equal(vacancies(cards,bounds,poses,gap),undefined,`scenario ${scenario} has a usable hole`);
    for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++)assert.ok(!collides(poses[i],poses[j],gap));
    assert.ok(poses.every(p=>cards.includes(p.card)),'Natural sizes must be preserved');
  }
});

test('extensions in all four directions keep every existing coordinate and fill around it',()=>{
  const cards=[{key:'a',width:384,height:406},{key:'b',width:416,height:319},{key:'c',width:320,height:276}];
  const gap=[64,64];let poses=[];
  for(const bounds of [{x:-1000,y:-900,w:2000,h:1800},{x:0,y:-900,w:2000,h:1800},{x:0,y:0,w:2000,h:1800},{x:-1500,y:0,w:2000,h:1800},{x:-1500,y:-1800,w:2000,h:1800}]) {
    const before=structuredClone(poses);
    const added=fillPacking(cards,bounds,poses,gap,poses.length);poses.push(...added);
    assert.deepEqual(poses.slice(0,before.length),before,'Extension must not reposition cards');
    assert.equal(vacancies(cards,bounds,poses,gap),undefined,'Extension must not leave usable holes');
    for(const a of added)for(const b of poses)if(a!==b)assert.ok(!collides(a,b,gap));
  }
});
test('pattern-aware insertion prevents equal types on neighboring edges',()=>{
  const cards=[{key:'a',width:220,height:180},{key:'b',width:240,height:220},{key:'c',width:200,height:190}];
  const poses=fillPacking(cards,{x:0,y:0,w:1500,h:1200},[],[64,64],0,{avoidSameType:true});
  assert.ok(poses.length>8);
  for(const a of poses)for(const b of poses)if(a!==b && a.card.key===b.card.key){
    const dx=Math.max(a.x-b.x-b.card.width,b.x-a.x-a.card.width),dy=Math.max(a.y-b.y-b.card.height,b.y-a.y-a.card.height);
    assert.ok(!(dy<0 && dx>=0 && dx<=128 || dx<0 && dy>=0 && dy<=128),'Repeated type on a neighboring edge');
  }
});
test('wide-gutter nearest neighbors are still neighbors; an intervening card blocks them',async()=>{
  const {patternConflicts}=await import('../src/lib/rect-packing.ts');
  const p=(key,x,y=0)=>({card:{key,width:220,height:220},x,y});
  const a=p('profile',0),b=p('profile',700);
  assert.equal(patternConflicts(a,[b],[64,64]),1,'Adjacency cannot have a distance cutoff');
  assert.equal(patternConflicts(a,[p('different',350),b],[64,64]),0,'A real intervening card separates the pair');
});
test('temporary viewport reservations cannot hide equal-type real neighbors',async()=>{
  const {patternConflicts}=await import('../src/lib/rect-packing.ts');
  const a={card:{key:'profile',width:220,height:220},x:0,y:0};
  const b={card:{key:'profile',width:220,height:220},x:700,y:0};
  const temporary={card:{key:'viewport',width:220,height:220,excludeFromNeighbors:true},x:350,y:0};
  assert.equal(patternConflicts(a,[temporary,b],[64,64]),1);
});


test('cached neighbor constraints match independent checks after every insertion',async()=>{
  const {patternConstraint,patternConflicts}=await import('../src/lib/rect-packing.ts');
  const poses=[];const cached=patternConstraint(poses);
  for(let i=0;i<80;i++){
    const p={x:(i%8)*231+(i%3)*17,y:Math.floor(i/8)*187,card:{key:String(i%5),width:80+(i*37)%130,height:60+(i*19)%110}};
    assert.equal(cached(p),patternConflicts(p,poses,[64,64]));
    cached.add(p);poses.push(p);
  }
});
