// Run from page start, like opening-hit.browser.js: wrap it in navigate_page's initScript.
async () => {
  const home=document.querySelector('.home');
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const deadline=performance.now()+20000;
  while(home.dataset.intro!=='playing'){
    assert(home.dataset.experience==='intro' && performance.now()<deadline,'Intro must reach border playback');await frame();
  }
  const visible=[...home.querySelectorAll('[data-world] tp-card,[data-intro-item] .intro')].filter(card=>{
    if(card.closest('[data-pooled]'))return false;
    const r=(card.shadowRoot?.querySelector('[part~="card"]')??card).getBoundingClientRect();
    return r.width>0 && r.height>0 && r.right>0 && r.bottom>0 && r.left<innerWidth && r.top<innerHeight;
  });
  const layer=home.querySelector('.home-intro-shells');
  const borders=[...layer.querySelectorAll('tp-mo-segment-border')];
  assert(borders.length>1 && borders.length===visible.length,'Every visible card must have an intro border shell');
  let outlinesBeforeContent=false,partial=false,drawn=false;
  while(home.dataset.intro==='playing' && performance.now()<deadline){
    const paths=borders.flatMap(b=>[...b.shadowRoot.querySelectorAll('path.segment')]);
    const active=paths.filter(p=>getComputedStyle(p).visibility==='visible' && parseFloat(p.style.strokeDasharray)>0);
    if(active.length){
      assert(paths.length===borders.length*4,'Each card must reveal all four border segments');
      drawn=true;
      outlinesBeforeContent ||= +getComputedStyle(home.querySelector('[data-card-layer]')).opacity<.01;
      partial ||= active.some(p=>parseFloat(p.style.strokeDasharray)<p.getTotalLength()/4-.1);
    }
    if(outlinesBeforeContent && partial)break;
    await frame();
  }
  assert(drawn && partial,'Borders must visibly draw, rather than appear complete');
  assert(outlinesBeforeContent,'Outlines must reveal before card contents');
  return {passed:true,visibleCards:visible.length,borderShells:borders.length,outlinesBeforeContent};
}
