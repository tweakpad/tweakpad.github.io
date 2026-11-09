import test from 'node:test';
import assert from 'node:assert/strict';
import {fillPacking} from '../src/lib/rect-packing.ts';
import {fillResponsiveRemainders} from '../src/lib/responsive-fill.ts';
import {responsivePackingSizes} from '../src/lib/home-mosaic.ts';
import {openingPoolCounts} from '../src/lib/intro-pool.ts';

test('responsive insertion keeps the requested gutter even in tight pockets',()=>{
  const bounds={x:-1000,y:-800,w:2000,h:1600},gap=[64,64];
  const wall=(key,x,y,width,height)=>({card:{key,width,height,solidHeight:height},x,y});
  const occupied=[wall('above',-1000,-800,2000,672.5),wall('below',-1000,227.8,2000,572.2),wall('left',-1000,-127.5,716,355.3),wall('right',284,-127.5,716,355.3)];
  const catalog=[{key:'profile',width:320,height:310.8,solidHeight:266.8}];
  const profiles=new Map([['profile',[{width:272,minHeight:310},{width:320,minHeight:266.8},{width:368,minHeight:232}]]]);
  assert.equal(fillPacking(catalog,bounds,occupied,gap).length,0,'Preferred dimensions cannot fill the actual pocket');
  assert.equal(fillResponsiveRemainders(catalog,bounds,occupied,gap,0,profiles).length,0,'Do not squeeze gutters to hide a pocket');
  const added=fillResponsiveRemainders(catalog,bounds,occupied,[32,32],0,profiles);
  assert.equal(added.length,1);
  const p=added[0];assert.equal(p.card.width,368);assert.equal(p.card.solidHeight,232);
  assert.ok(p.y+127.5>=32 && 227.8-p.y-p.card.height>=32,'The chosen gutter is respected on both sides');
});
test('responsive insertion rejects variants outside allowed resizing or measured content height',()=>{
  const c=[{key:'a',width:400,height:344,solidHeight:300}];
  const v=responsivePackingSizes(c,new Map([['a',[{width:339,minHeight:200},{width:340,minHeight:340},{width:460,minHeight:260},{width:461,minHeight:260}]]]));
  assert.equal(v.length,2);assert.deepEqual(v.map(c=>c.width),[340,460]);assert.ok(v.every(c=>c.solidHeight>=255 && c.solidHeight<=345));
});
test('pool demand derives from simultaneous visibility with dynamic ratios and guards',()=>{
  const cells=[{key:'a',x:0,y:500,w:100,h:100},{key:'a',x:0,y:1000,w:100,h:100},{key:'a',x:0,y:800,w:100,h:100},{key:'a',x:1000,y:500,w:100,h:100},{key:'tall',x:0,y:0,w:40,h:2000}];
  const view={x:0,w:400,h:300,fromY:0,toY:1200};
  assert.equal(openingPoolCounts(cells,view,0).get('a'),2);
  assert.equal(openingPoolCounts(cells,view,100).get('a'),3);
  assert.equal(openingPoolCounts(cells,view,100).get('tall'),1);
});
test('intro pattern repair uses another legal type without moving pinned cards',async()=>{
  const {avoidPatternNeighbors}=await import('../src/lib/home-patterns.ts');
  const c=(key,pattern,x,y)=>({key,pattern,x,y,w:300,h:220,captionHeight:44,profile:[{width:255,minHeight:220},{width:300,minHeight:220},{width:345,minHeight:220}]});
  const cells=[c('0','a',0,0),c('1','a',364,0),c('2','b',0,700),c('3','c',700,700)];
  const result=avoidPatternNeighbors(cells,{x:-64,y:-64,w:1200,h:1100},[64,64],new Set(['0']));
  assert.deepEqual(result[0],cells[0]);assert.notEqual(result[1].pattern,'a');
  assert.ok(result[1].w>=255 && result[1].w<=345);
});
