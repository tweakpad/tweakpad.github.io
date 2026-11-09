import test from 'node:test';
import assert from 'node:assert/strict';
import { firstVerticalLanding } from '../src/lib/opening-layout.ts';

test('the first real centered card is the landing, without skipping intervening cards', () => {
  const card = (id, x, y, w = 440, h = 300) => ({ pattern: id, box: { x, y, w, h } });
  const first = card('first', 0, 2400);
  const later = card('later', 0, 3100);
  const retired = card('__intro', 0, 100, 0, 0);
  assert.equal(firstVerticalLanding([later, card('side', 504, 500), retired, first], 220, 200), first);
  assert.equal(firstVerticalLanding([card('off-center', 50, 800)], 220, 200), undefined);
});

test('retired intro spacers cannot become autopilot targets', async () => {
  const { cardsNear, cardBox } = await import('../src/lib/autopilot/model.ts');
  const empty = { x: 0, y: 0, w: 0, h: 0 };
  const layout = { version: 1, build: 1, columnWidth: 440, gap: [64, 64], offsetX: 0,
    columns: [{ phase: 0, height: 3600, items: [
      { row: 0, pattern: '__intro', y: 0, height: 2384, card: empty, caption: empty },
      { row: 1, pattern: 'sign-in', y: 2448, height: 410, card: { x: 28, y: 0, w: 384, h: 362 }, caption: empty },
    ] }] };
  const cards = cardsNear(layout, [220, 1300], 3000).map(card => ({ ...card, box: cardBox(layout, card.ref) }));
  assert.ok(cards.every(card => card.pattern !== '__intro'));
  const target = firstVerticalLanding(cards, 220, 124);
  assert.equal(target.pattern, 'sign-in');
  assert.equal(target.box.y, 2448);
  assert.equal(target.box.x + target.box.w / 2, 220);
});



test('one flat placement set is used by targeting without an underlying grid',async()=>{
  const {cardsNear,cardBox,itemOf,featureOf,relocate,sameCard}=await import('../src/lib/autopilot/model.ts');
  const card={x:0,y:0,w:320,h:200};
  const local={row:0,pattern:'placed-card',x:-200,y:500,height:240,card,caption:card};
  const layout={version:1,build:1,columnWidth:440,gap:[64,64],offsetX:0,columns:[{phase:0,height:0,items:[]}],patch:{bounds:{x:-1000,y:-1000,w:3000,h:3000},items:[local]}};
  const ref={local:true,u:0,k:0,row:0};
  assert.deepEqual(cardBox(layout,ref),{...card,x:-200,y:500});
  assert.equal(itemOf(layout,ref),local);
  assert.deepEqual(featureOf(layout,ref),{column:-1,row:0});
  assert.deepEqual(relocate(layout,ref,500),ref);
  assert.equal(sameCard(ref,{u:0,k:0,row:0}),false);
  assert.deepEqual(cardsNear(layout,[-40,600],300).map(c=>c.ref),[ref]);
});
