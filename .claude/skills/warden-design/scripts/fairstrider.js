// Fair (input-only) player bot for the Strider. Needs dbgsrc.js loaded first.
// Sees: positions (strider, stones, pool, marks), the strider's visible pose (state name), whether the plate
// is still on its back, HUD prompt, own stamina/hp. Writes: keys and camera yaw only.
(()=>{const g=__game,S=g.strider,p=g.player,a=g.world.arena2,V=p.pos.constructor,B=g.input.settings.get('bindings');
const K={W:B.forward,A:B.left,D:B.right,S:B.back,run:B.sprint,grip:B.grip,act:B.interact,jump:B.jump};
const ai=bot.sa={mode:'approach',k:0,ev:[]};
const E=(m)=>{ ai.ev.push((g.time|0)+' '+m+' S:'+S.state+' st'+(p.stamina|0)+' hp'+(p.health.hp|0)); };
const allUp=()=>bot.up(K.W,K.A,K.D,K.S,K.run,K.jump);
const faceDir=(fx,fz)=>{ g.cam.yaw=Math.atan2(-fx,-fz); };
const goTo=(x,z,run)=>{ bot.target={x,z}; bot.up(K.A,K.D,K.S); bot.hold(K.W); if(run) bot.hold(K.run); else bot.up(K.run); };
const sfwd=()=>({x:Math.sin(S.yaw),z:Math.cos(S.yaw)});
const dist2=(x,z)=>Math.hypot(x-p.pos.x,z-p.pos.z);
const fromS=()=>Math.hypot(p.pos.x-S.root.position.x,p.pos.z-S.root.position.z);
const PATCH=()=>{ if(p.state!=='climb'||!p.att) return null; const o=p.att.obj; return o===S.chestFur?'chest':o===S.withersFur||o===S.brisketFur?'withers':o===S.saddleFur?'saddle':o===S.backFur?'back':o===S.neckFur?'neck':'other'; };
const hostile=()=>['alert','hunt','paw','charge','skid','stagger','kick','toss'].includes(S.state);
// the hiding place: behind the standing stone nearest the pool, on the side away from the strider
const hideSpot=()=>{ let best=null,bd=1e9; for(const s of a.stones){ if(s.broken) continue; const d=Math.hypot(s.x-a.pool.x,s.z-a.pool.z)+0.5*Math.hypot(s.x-p.pos.x,s.z-p.pos.z); if(d<bd){bd=d;best=s;} }
  const dx=best.x-S.root.position.x, dz=best.z-S.root.position.z, l=Math.hypot(dx,dz)||1; return {x:best.x+dx/l*3.6, z:best.z+dz/l*3.6}; };
const chestPoint=()=>{ const c=S.chestFur.localToWorld(new V(0,-2.4,0.45)); return c; };
let stuck=0, lp=null, side=0;
bot.sai=()=>{ ai.k++; const k=ai.k, pt=PATCH(), shaky=S.shakeIntensity>0.25||S.state==='shakeWarn'||S.state==='shaking'||S.state==='rear';
  if(pt && ai.mode!=='ride' && ai.mode!=='climb') { ai.mode='climb'; E('mounted'); }
  if(!pt && (ai.mode==='ride'||ai.mode==='climb')) { ai.mode = S.stage===2?'phase2':'approach'; bot.up(K.grip,K.act); E('off'); }
  // ground: walk around anything we bump into
  if(p.state==='ground'&&bot.held.has(K.W)){ const d=lp?Math.hypot(p.pos.x-lp.x,p.pos.z-lp.z):1; stuck=d<0.02?stuck+1:0; if(stuck>20){side=k+35;stuck=0;} } lp={x:p.pos.x,z:p.pos.z};
  if(side>k&&p.state==='ground'){ bot.up(K.W); bot.hold(K.A); return; } else if(side){ bot.up(K.A); side=0; }

  // ---------------- on the ground
  // the way to the meadow: through the breach in the plaza's west wall
  if(p.state==='ground'&&p.pos.x>-74){ const wp = p.pos.x>-29&&Math.abs(p.pos.z-161.2)>2 ? {x:-26,z:161.2} : {x:-80,z:161.2}; goTo(wp.x,wp.z,true); bot.up(K.grip); return; }
  if(ai.mode==='approach'||ai.mode==='phase2'){
    bot.up(K.act);
    const ds=fromS();
    // its charge is coming: break sideways
    if(S.state==='charge'||(S.state==='paw'&&ds<30)){ const f=sfwd(); const rx=p.pos.x-S.root.position.x, rz=p.pos.z-S.root.position.z; const sd=Math.sign(rx*f.z-rz*f.x)||1; goTo(p.pos.x+f.z*sd*10, p.pos.z-f.x*sd*10, true); bot.up(K.grip); return; }
    if(S.state==='winded'||(S.state==='drink'&&S.stage===1)){
      // walk in from the front, keeping clear of its flanks; grab the breast mane
      const c=chestPoint(), f=sfwd(), r=S.root.position;
      const relx=p.pos.x-r.x, relz=p.pos.z-r.z, ahead=relx*f.x+relz*f.z;
      let tx=c.x, tz=c.z; if(ahead<6){ const sd=Math.sign(relx*f.z-relz*f.x)||1; tx=r.x+f.x*12+f.z*sd*9; tz=r.z+f.z*12-f.x*sd*9; }
      const near=dist2(c.x,c.z); goTo(tx,tz, S.state==='winded' || ds>30);
      // walk right up to the mane; take hold when the Grab prompt shows
      if(p.prompt?.label==='Grab'){ bot.up(K.run); bot.hold(K.grip); } else if(near<0.3){ bot.up(K.W,K.run); } else bot.up(K.grip);
      return;
    }
    bot.up(K.grip);
    if(S.stage===2){ // keep at a fair distance in the open and wait for the charge
      if(ds<18){ const rx=p.pos.x-S.root.position.x, rz=p.pos.z-S.root.position.z, l=Math.hypot(rx,rz)||1; goTo(p.pos.x+rx/l*8,p.pos.z+rz/l*8,true); } else { allUp(); bot.target=null; }
      return; }
    // phase 1, not drinking: keep well away, on the far side of the meadow from it, and wait for it to drink
    if(!ai.wait || k-ai.waitT>240 || Math.hypot(ai.wait.x-S.root.position.x, ai.wait.z-S.root.position.z)<34){
      const dx=a.center.x-S.root.position.x, dz=a.center.z-S.root.position.z, l=Math.hypot(dx,dz)||1;
      ai.wait={x:a.center.x+dx/l*42, z:a.center.z+dz/l*42}; ai.waitT=k; }
    if(dist2(ai.wait.x,ai.wait.z)>1.5) goTo(ai.wait.x,ai.wait.z, hostile() || ds>30); else { allUp(); bot.target=null; }
    return;
  }
  // ---------------- on its body
  bot.target=null; bot.up(K.run,K.jump);
  if(p.strike.phase!=='none'||bot.held.has(K.act)){ if(bot.held.has(K.act)&&k-ai.strikeT>70) bot.up(K.act); bot.hold(K.grip); return; }
  const top=p.climbNormal&&p.climbNormal.y>0.7;
  if(shaky){ allUp(); bot.hold(K.grip); return; }
  const nape=S.weakPoints[0], croup=S.weakPoints[1], plate=S.armour.visible;
  const want = !nape.destroyed && !plate ? 'nape' : plate ? 'steer' : 'croup';
  if(p.prompt?.label==='Strike'&&p.stamina>20){ allUp(); bot.hold(K.grip,K.act); ai.strikeT=k; E('strike'); return; }
  // breathe on the broad top when tired
  if(top&&p.stamina<35){ allUp(); bot.up(K.grip); ai.resting=true; return; }
  if(ai.resting&&top&&p.stamina<90){ allUp(); bot.up(K.grip); return; } ai.resting=false;
  bot.hold(K.grip);
  if(pt==='chest'){ bot.up(K.A,K.D,K.S); bot.hold(K.W); return; }      // straight up the breast mane
  const f=sfwd();
  if(want==='steer'){
    if(pt!=='withers'&&pt!=='neck'){ faceDir(f.x,f.z); bot.hold(K.W); return; }
    bot.up(K.W,K.S);
    let best=null,bs=1e9; for(const s of a.stones){ if(s.broken) continue; const dx=s.x-S.root.position.x, dz=s.z-S.root.position.z, d=Math.hypot(dx,dz); let w=Math.atan2(dx,dz)-S.yaw; w=Math.atan2(Math.sin(w),Math.cos(w)); const sc=Math.abs(w)+(d<15?4:0); if(sc<bs){bs=sc;best=w;} }
    bot.up(K.A,K.D); if(best!==null&&Math.abs(best)>0.1) bot.hold(best>0?K.A:K.D); return;
  }
  bot.up(K.A,K.D);
  // stuck against an edge on its body: coil and leap the way we are heading (the climbing leap)
  { const d=ai.cp?Math.hypot(p.pos.x-ai.cp.x,p.pos.y-ai.cp.y,p.pos.z-ai.cp.z):1; ai.cp={x:p.pos.x,y:p.pos.y,z:p.pos.z};
    const sp=d - (S.speed*(1/60)); // own movement over the body is hard to see; use time on the same patch spot instead
    const l=p.att?.local; const key=pt+(l?(l.x.toFixed(1)+l.z.toFixed(1)):'');
    ai.same = key===ai.key ? (ai.same||0)+1 : 0; ai.key=key;
    if(ai.leapT && k-ai.leapT<28){ bot.hold(K.W,K.jump); return; } if(ai.leapT && k-ai.leapT<40){ bot.up(K.jump); return; }
    if(ai.same>45 && p.stamina>40 && bot.held.has(K.W)){ ai.leapT=k; ai.same=0; E('leap'); bot.hold(K.W,K.jump); return; } }
  const wp = want==='nape'?nape:croup; const w=wp.mesh.getWorldPosition(new V());
  const dx=w.x-p.pos.x, dz=w.z-p.pos.z;
  if(top||pt==='neck'){ faceDir(dx,dz); if(Math.hypot(dx,dz)>0.5) bot.hold(K.W); else bot.up(K.W); return; }
  bot.hold(K.W); return;
};
window.deaths=0;
window.splay=async(sec)=>{ const t0=g.time;
  while(g.time-t0<sec){
    if(g.state==='playing'){ bot.sai(); bot.frame(false); if(S.state==='dying'||S.state==='dead'){ for(let i=0;i<30;i++) bot.frame(false); break; } continue; }
    if(g.state==='dying'){ await new Promise(r=>setTimeout(r,200)); bot.frame(false); continue; }
    if(g.state==='dead'){ deaths++; ai.ev.push('DIED'); bot.held.clear(); await new Promise(r=>setTimeout(r,800)); g.input.ui({type:'confirm'}); await new Promise(r=>setTimeout(r,3000)); for(let i=0;i<60;i++) bot.frame(false); ai.mode='approach'; continue; }
    await new Promise(r=>setTimeout(r,100)); bot.frame(false);
  }
  return {gs:g.state, S:S.state, stage:S.stage, plate:S.armour.visible, marks:S.weakPoints.map(w=>w.id+w.hits+(w.destroyed?'X':'')).join(' '), deaths, t:g.time|0}; };
return 'ok'})()
