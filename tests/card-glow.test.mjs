import test from 'node:test';
import assert from 'node:assert/strict';
import {createCardGlow} from '../src/lib/card-glow.ts';
const card=()=>({glow:{trigger:'none',trackPoint:{x:-1e6,y:-1e6}},x:100,y:200,w:400,h:300,scale:1,onStage:true});
test('locked/off and out-of-reach flow disable pointer tracking; manual enables it',()=>{
  const manager=createCardGlow({reach:160,impact:1}),c=card();
  manager.update(0,[c],{kind:'off'},[0,0]);assert.equal(c.glow.trigger,'none');
  manager.update(1,[c],{kind:'flow',point:[300,200]},[10,20]);assert.equal(c.glow.trigger,'pointer');assert.deepEqual(c.glow.trackPoint,{x:310,y:220});
  manager.update(2,[c],{kind:'flow',point:[1500,1200]},[0,0]);assert.equal(c.glow.trigger,'none');
  manager.update(3,[c],{kind:'pointer'},[0,0]);assert.equal(c.glow.trigger,'pointer');assert.equal(c.glow.trackPoint,null);
});
test('first top-edge impact flares without pointer interaction then expires',()=>{
  const manager=createCardGlow({reach:160,impact:1}),c=card();
  manager.impact(c.glow,[200,0],[0,-1],0);
  manager.update(100,[c],{kind:'off'},[10,20]);assert.equal(c.glow.trigger,'pointer');assert.deepEqual(c.glow.trackPoint,{x:310,y:220});
  manager.update(500,[c],{kind:'off'},[10,20]);assert.ok(c.glow.trackPoint.y<220);
  manager.update(1100,[c],{kind:'off'},[10,20]);assert.equal(c.glow.trigger,'none');
});
test('retiring a card disables pointer observation even during a flare',()=>{
  const manager=createCardGlow({reach:160,impact:1}),c=card();manager.impact(c.glow,[200,0],[0,-1],0);c.onStage=false;
  manager.update(100,[c],{kind:'pointer'},[0,0]);assert.equal(c.glow.trigger,'none');assert.deepEqual(c.glow.trackPoint,{x:-1e6,y:-1e6});
});
