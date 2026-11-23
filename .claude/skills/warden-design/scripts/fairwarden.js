// Fair (input-only) player bot for the Warden. Needs dbgsrc.js + dbgai.js loaded first.
// Reads only what a player can see (positions, the giant's pose/state, HUD prompt, own stamina bar).
// Writes only keys (bot.hold/up) and camera yaw (bot.target / g.cam.yaw). Usage: await play(seconds)
(()=>{const g=__game,c=g.colossus,p=g.player,V=p.pos.constructor; const back=c.weakPoints.find(w=>w.id==='back');
const NM=['hips','thighL','shinL','thighR','shinR','back','shoulders','armL','armR','crown','headBack','belt','haunchL','haunchR','foldL','foldR'];
bot.on=()=>p.state==='climb'&&p.att?NM[c.climbables.indexOf(p.att.obj)]:null;
const shakyNow=()=>c.state==='shakeWarn'||c.state==='shaking'||c.shakeIntensity>0.1;
const base=bot.ai;
// the way on (the shins can be grabbed any time, but a walking leg flings you; a stamped, stuck foot is calm):
// stand where it will stamp at us, jump the landing, then run to the back of the stuck leg and grab when the
// prompt shows. Reads only the visible leg pose.
const steer=(x,z)=>{ bot.target=null; g.cam.yaw=Math.atan2(x-p.pos.x,z-p.pos.z)-Math.PI; };
const mountW=()=>{ const a=bot.a; a.k++; bot.up('KeyE','KeyA','KeyD','KeyS');
  const leg=c.stompLeg||c.legs[0], f=leg.foot.getWorldPosition(new V()), footUp=f.y-g.world.heightAt(f.x,f.z);
  const root=c.root.position, dr=Math.hypot(p.pos.x-root.x,p.pos.z-root.z), vy=a.pf!=null?footUp-a.pf:0; a.pf=footUp;
  if(a.k-(a.jumpT||0)>10) bot.up('Space');
  if(c.state==='stomp'&&footUp>0.5){
    const df=Math.hypot(p.pos.x-f.x,p.pos.z-f.z);
    if(df<6.5){ steer(p.pos.x+(p.pos.x-f.x),p.pos.z+(p.pos.z-f.z)); bot.hold('KeyW','ShiftLeft'); } else bot.up('KeyW','ShiftLeft');
    if(vy<-0.04&&footUp<3.2&&p.state==='ground'){ bot.hold('Space'); a.jumpT=a.k; WL.push((g.time|0)+' jump'); }
    return; }
  if(c.state==='stomp'){
    const s=leg.shin.localToWorld(new V(0,-1.2,-1.5)); steer(s.x,s.z); bot.hold('KeyW','ShiftLeft');
    if(p.prompt?.label==='Grab'){ bot.hold('Mouse0'); bot.up('ShiftLeft'); } else if(p.state==='ground') bot.up('Mouse0');
    return; }
  bot.up('Mouse0','ShiftLeft');
  if(dr>11){ steer(root.x,root.z); bot.hold('KeyW'); if(dr>20) bot.hold('ShiftLeft'); }
  else if(dr<8){ steer(p.pos.x+(p.pos.x-root.x),p.pos.z+(p.pos.z-root.z)); bot.hold('KeyW'); }
  else { bot.up('KeyW'); steer(root.x,root.z); }
};
bot.ai=()=>{ const a=bot.a, on=bot.on(), top=on&&p.climbNormal&&p.climbNormal.y>0.7, shaky=shakyNow();
  const mounting=!on&&p.state!=='climb'&&(!a.mode||a.mode==='mount')&&!(c.state==='dying'||c.state==='dead');
  // unstick on the ground: walked into a corner -> sidestep
  const d=a.lp?Math.hypot(p.pos.x-a.lp.x,p.pos.z-a.lp.z):1; a.lp={x:p.pos.x,z:p.pos.z};
  if(p.state==='ground'&&bot.held.has('KeyW')&&!(a.side&&a.k<a.side)){ a.stuck=d<0.02?(a.stuck||0)+1:0; if(a.stuck>20){a.side=a.k+40;a.stuck=0;} }
  if(a.side&&a.k<a.side&&p.state==='ground'){ a.k++; bot.up('KeyW'); bot.hold('KeyA'); return; } else if(a.side){ bot.up('KeyA'); a.side=0; }
  if(mounting){ a.mode='mount'; mountW(); return; }
  if(bot.held.has('KeyE')||p.strike.phase!=='none'){ base(); return; }
  // stab whenever the prompt offers it
  if(p.prompt?.label==='Strike'&&p.stamina>20&&!shaky&&p.state==='climb'){ a.k++; bot.log(); bot.up('KeyW','KeyA','KeyD','KeyS','Space'); bot.hold('Mouse0','KeyE'); a.strikeT=a.k; bot.E('strike'); return; }
  // rest on any ledge below the shoulders until the stamina bar is full
  if(top&&on!=='shoulders'&&on!=='crown'){
    a.k++; bot.log(); bot.target=null; bot.up('Space','KeyA','KeyD','KeyS');
    if(shaky){ bot.up('KeyW'); bot.hold('Mouse0'); return; }
    if(p.stamina<97&&!a.leaving){ bot.up('KeyW','Mouse0'); return; }
    // rested: try to climb on, first into the body, then out over the back edge (as a player would try both)
    if(!a.leaving){ a.leaving=a.k; }
    const into=((a.k-a.leaving)%160)<80, s=into?1:-1;
    g.cam.yaw=Math.atan2(-Math.sin(c.yaw)*s,-Math.cos(c.yaw)*s); bot.hold('Mouse0','KeyW');
    if(p.stamina<60) a.leaving=0; return;
  }
  a.leaving=0;
  // pushing up under the overhanging fold of hide and getting nowhere: work sideways toward the gap down the spine
  if(p.state==='climb'&&['thighL','thighR','haunchL','haunchR','foldL','foldR','hips'].includes(on)&&(a.mode==='up'||a.mode==='mount')&&!shaky){
    const cur=p.lastAttWorld.clone(); a.cl=a.cl||{p:cur,n:0}; if(cur.distanceTo(a.cl.p)<0.01&&bot.held.has('KeyW')) a.cl.n++; else if(!a.slide) a.cl.n=0; a.cl.p=cur;
    if(a.cl.n>25||a.slide){ a.slide=a.slide||40; a.slide--; a.k++; bot.log();
      const hl=c.hips.worldToLocal(cur.clone()); const N=p.climbNormal.clone(), up=new V(0,1,0).addScaledVector(N,-N.y).normalize(), right=new V().crossVectors(N.clone().negate(),up).normalize();
      const mid=c.hips.localToWorld(new V(0,hl.y,hl.z)); const dx=mid.sub(cur).dot(right);
      bot.hold('Mouse0'); bot.up('KeyW','KeyS','KeyA','KeyD','Space'); if(Math.abs(dx)>0.3) bot.hold(dx>0?'KeyD':'KeyA'); else { a.slide=0; a.cl.n=0; }
      if(a.slide<=0){ a.slide=0; a.cl.n=0; } return; }
  }
  // resting on the shoulders: once the bar is nearly full and it is not thrashing, head for the open mark
  if(a.mode==='rest'&&on==='shoulders'&&p.stamina>=90&&!shaky){ const wp=c.weakPoints.find(x=>!x.destroyed&&!x.sealed); if(wp){ a.mode=wp.id==='back'?'dropBack':'toHead'; a.fell=false; } }
  // arms nearly spent on the back (stamina bar low): climb down onto the shelf below and get the breath back there
  if(on==='back'&&p.stamina<32&&!shaky&&p.strike.phase==='none'&&p.prompt?.label!=='Strike'){ a.k++; bot.log(); bot.target=null; bot.up('KeyW','KeyA','KeyD','Space','ShiftLeft'); bot.hold('Mouse0','KeyS'); if(a.mode!=='down'){a.mode='down'; bot.E('down');} return; }
  if(a.mode==='down'&&on!=='back'){ bot.up('KeyS'); a.mode='up'; }
  // on the back with the mark intact: work over to it
  if(on==='back'&&!back.destroyed&&(a.mode==='up'||a.mode==='strike')){
    a.k++; bot.log(); bot.hold('Mouse0'); bot.target=null; bot.up('Space','ShiftLeft','KeyW','KeyA','KeyD','KeyS'); if(shaky) return;
    const w=back.mesh.getWorldPosition(new V()), N=p.climbNormal.clone(), up=new V(0,1,0).addScaledVector(N,-N.y).normalize(), right=new V().crossVectors(N.clone().negate(),up).normalize();
    const dd=w.sub(p.pos.clone().add(new V(0,1.3,0))), dy=dd.dot(up), dx=dd.dot(right);
    if(dy>0.3)bot.hold('KeyW'); else if(dy<-0.6)bot.hold('KeyS'); if(dx>0.4)bot.hold('KeyD'); else if(dx<-0.4)bot.hold('KeyA'); return;
  }
  base();
};
window.deaths=0; window.WL=window.WL||[];
window.play=async(sec)=>{ const t0=g.time;
  while(g.time-t0<sec){
    if(g.state==='playing'){ bot.ai(); bot.frame(false); if(c.state==='dead'||c.state==='dying') { for(let i=0;i<30;i++) bot.frame(false); break; } continue; }
    if(g.state==='dying'){ await new Promise(r=>setTimeout(r,200)); bot.frame(false); continue; }
    if(g.state==='dead'){ deaths++; bot.held.clear(); await new Promise(r=>setTimeout(r,800)); g.input.ui({type:'confirm'}); await new Promise(r=>setTimeout(r,3000)); for(let i=0;i<60;i++) bot.frame(false); bot.a.mode='mount'; continue; }
    await new Promise(r=>setTimeout(r,100)); bot.frame(false);
  }
  return {gs:g.state, col:c.state, info:bot.info(), deaths, WL:WL.slice(-14)}; };
return 'ok'})()
