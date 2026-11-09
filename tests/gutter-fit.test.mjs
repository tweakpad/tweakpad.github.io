import test from 'node:test';
import assert from 'node:assert/strict';
import {fitGutters} from '../src/lib/gutter-fit.ts';
const card=(key,x,y,w,h)=>({x,y,card:{key,width:w,height:h,solidHeight:h}});
test('fits residual space with legal dimensions and keeps published neighbors fixed',()=>{
 const fixed=[card('left',0,0,100,200),card('right',364,0,100,200),card('top',164,-164,136,100),card('bottom',164,264,136,100)];
 const before=structuredClone(fixed),input=[card('a',182,0,100,200)];
 const out=fitGutters(input,fixed,[input[0].card],new Map([['a',[{width:85,minHeight:200},{width:100,minHeight:200},{width:115,minHeight:180}]]]),{x:0,y:-200,w:500,h:700},[64,64]);
 assert.deepEqual(fixed,before);assert.equal(out[0].card.width,115);assert.ok(out[0].card.height<=230);assert.ok(out[0].x>=164&&out[0].x+115<=300);
});
test('heterogeneous inputs remain collision free and within each size allowance',()=>{
 for(let seed=1;seed<=20;seed++){
 const input=Array.from({length:12},(_,i)=>card(String(i),i%4*600,Math.floor(i/4)*800,180+(seed*i*37)%260,200+(seed*i*53)%400));
 const profiles=new Map(input.map(p=>[p.card.key,[.85,1,1.15].map(f=>({width:p.card.width*f,minHeight:p.card.height/f}))]));
 const out=fitGutters(input,[],input.map(p=>p.card),profiles,{x:-64,y:-64,w:2500,h:2600},[64,64]);
 for(let i=0;i<out.length;i++){const a=out[i],b=input[i];assert.ok(a.card.width>=b.card.width*.85-.01&&a.card.width<=b.card.width*1.15+.01);assert.ok(a.card.height<=b.card.height*1.15+.01);for(const c of out.slice(i+1))assert.ok(!(a.x<c.x+c.card.width&&a.x+a.card.width>c.x&&a.y<c.y+c.card.height&&a.y+a.card.height>c.y));}
 }
});
