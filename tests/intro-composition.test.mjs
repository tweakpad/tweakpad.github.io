import test from 'node:test';
import assert from 'node:assert/strict';
import { introComposition } from '../src/lib/intro-composition.ts';

const intersects=(a,b,gap=0)=>a.x<b.x+b.card.width+gap&&a.x+a.card.width+gap>b.x&&a.y<b.y+b.card.height+gap&&a.y+a.card.height+gap>b.y;
for(const count of [1,3,12,20])test(`intro adapts to ${count} naturally sized cards`,()=>{
  const cards=Array.from({length:count},(_,i)=>({key:`card-${i}`,width:300+(i%4)*32,height:210+(i%5)*57}));
  const hero={key:'hero',width:440,height:214};
  const poses=introComposition(cards,hero,124,5,844,[64,64]);
  const landing=poses.find(p=>p.role==='landing');
  assert.equal(landing.x+landing.card.width/2,0);
  assert.ok(landing.y>844);
  poses.forEach(p=>assert.ok(p.card===hero||cards.includes(p.card)));
  for(const side of [-1,1]) {
    const bank=poses.filter(p=>p.bank===side).sort((a,b)=>a.y-b.y);
    for(let i=1;i<bank.length;i++)assert.equal(bank[i].y-bank[i-1].y-bank[i-1].card.height,64,'The lane banks must have the normal gap');
    for(const p of bank)assert.equal(side<0 ? p.x+p.card.width : p.x,side*32,'A bank card must never shift sideways before reaching the landing');
    const last=bank.at(-1);
    assert.equal(landing.y-last.y-last.card.height,64,'Landing must have the normal gap above it');
    const below=poses.filter(p=>p.role==='context' && p.x<landing.x+landing.card.width && p.x+p.card.width>landing.x && p.y>=landing.y+landing.card.height).sort((a,b)=>a.y-b.y)[0];
    assert.equal(below.y-landing.y-landing.card.height,64,'Landing must have the normal gap below it');
  }
  for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++) assert.ok(!intersects(poses[i],poses[j],63.99),`overlap ${i}/${j}`);
  for(const p of poses.filter(p=>p.role==='context'&&p.y<landing.y&&p.y+p.card.height>hero.height/2))assert.ok(p.x+p.card.width<=-32||p.x>=32);
});

test('distance is configurable independently of endless packing',()=>{
  const cards=[{key:'a',width:384,height:410},{key:'b',width:320,height:276}];
  const hero={key:'hero',width:440,height:214};
  const short=introComposition(cards,hero,124,3,844,[64,64]);
  const long=introComposition(cards,hero,124,8,844,[64,64]);
  assert.ok(long.find(p=>p.role==='landing').y>short.find(p=>p.role==='landing').y);
  assert.ok(long.length>short.length);
});


test('an empty future catalog leaves a valid hero-only composition',()=>{
  const hero={key:'hero',width:440,height:214};
  assert.deepEqual(introComposition([],hero,124,5,844,[64,64]),[{role:'hero',card:hero,x:-220,y:-107}]);
});

test('desktop intro leaves no vacant card-sized slots beside the lane',()=>{
  const cards=[
    {key:'a',width:384,height:406}, {key:'b',width:416,height:319},
    {key:'c',width:440,height:485}, {key:'d',width:320,height:276},
  ];
  const hero={key:'hero',width:440,height:214};
  for(const width of [1440,1920,2560]) {
    const poses=introComposition(cards,hero,124,5,1000,[64,64],width);
    const landing=poses.find(p=>p.role==='landing');
    const top=-hero.height/2-1000;
    const bottom=landing.y+landing.card.height+1000;
    const right=width/2+880;
    for(const side of [-1,1]) {
      const obstacles=poses.map(p=>({...p,x:side<0 ? -p.x-p.card.width : p.x}));
      const xs=[32,...obstacles.map(p=>p.x+p.card.width+64)].filter(x=>x>=32);
      const ys=[top,...obstacles.map(p=>p.y+p.card.height+64)].filter(y=>y>=top);
      for(const card of cards)for(const x of xs)for(const y of ys) {
        if(x+card.width+64>right || y+card.height+64>bottom)continue;
        assert.ok(obstacles.some(p=>intersects({x,y,card},p,63.99)),`${width}px: vacant ${card.key} slot at ${side*x},${y}`);
      }
    }
  }
});

test('catalog additions, removals, and arbitrary dimensions need no placement overrides',()=>{
  let state=4917;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  for(let scenario=0;scenario<40;scenario++) {
    const cards=Array.from({length:1+Math.floor(random()*24)},(_,i)=>({key:`scenario-${scenario}-${i}`,width:160+Math.round(random()*480),height:100+Math.round(random()*900)}));
    cards.forEach(card=>card.solidHeight=Math.max(1,card.height-44));
    const hero={key:'hero',width:300+Math.round(random()*200),height:160+Math.round(random()*150)};
    const gap=[32+Math.round(random()*64),32+Math.round(random()*64)];
    const poses=introComposition(cards,hero,hero.height*.6,2+random()*6,600+random()*500,gap,1000+random()*1600);
    const landing=poses.find(p=>p.role==='landing');
    assert.equal(landing.x+landing.card.width/2,0);
    for(const side of [-1,1]) {
      const card=cards[(side<0 ? 1 : 2)%cards.length];
      const adjacent=poses.find(p=>p.card===card && Math.abs(p.y+(card.solidHeight ?? card.height)/2)<.001 && (side<0 ? Math.abs(p.x+p.card.width+hero.width/2+gap[0])<.001 : Math.abs(p.x-hero.width/2-gap[0])<.001));
      assert.ok(adjacent,'Hero and neighboring visible card bodies must share their vertical center');
    }
    for(const p of poses)assert.ok(p.card===hero || cards.includes(p.card),'Dimensions must come from the catalog, without resizing');
    for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++) {
      const a=poses[i],b=poses[j];
      assert.ok(!(a.x<b.x+b.card.width+gap[0]-.001 && a.x+a.card.width+gap[0]-.001>b.x && a.y<b.y+b.card.height+gap[1]-.001 && a.y+a.card.height+gap[1]-.001>b.y),`scenario ${scenario}: overlap ${i}/${j}`);
    }
    for(const side of [-1,1]) {
      const bank=poses.filter(p=>p.bank===side).sort((a,b)=>a.y-b.y);
      assert.ok(Math.abs(landing.y-bank.at(-1).y-bank.at(-1).card.height-gap[1])<.001);
      for(const p of bank)assert.equal(side<0 ? p.x+p.card.width : p.x,side*gap[0]/2);
    }
  }
});
