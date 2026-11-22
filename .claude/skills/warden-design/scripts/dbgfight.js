window.fight=async function(maxT=240){
const g=__game, s=g.strider, p=g.player, V=p.pos.constructor, I=g.input, B=I.settings.get('bindings');
const H=(...a)=>{ bot.held.clear(); a.forEach(x=>bot.hold(B[x])); };
const wpPos=(w)=>{const v=new V(); w.mesh.getWorldPosition(v); return v;};
const ev=[]; let last='', k=0, mode='lure', stone=null, dodge=0;
const note=(m)=>ev.push([+(g.time).toFixed(1),m]);
for(let i=0;i<60*maxT;i++){
  if(p.state==='dead'){note('player dead');break;}
  if(!s.alive){note('boss '+s.state);break;}
  const tag=s.state+'|'+(p.att?p.att.obj.name:p.state); if(tag!==last){note(tag+' st'+Math.round(p.stamina)+' hp'+Math.round(p.health.hp)+' wp'+s.weakPoints.map(w=>w.hits).join('/'));last=tag;}
  let keys=[];
  if(p.state!=='climb'){
    // on the ground: if stunned run to its chest; else stand before the nearest stone, facing the boss, and sidestep the charge
    if(s.state==='stunned'||s.state==='rise'&&false){
      const cp=s.climbables.map(c=>{const v=new V(); c.getWorldPosition(v); return v;}).reduce((a,b)=>b.y<a.y?b:a); const d=Math.hypot(cp.x-p.pos.x,cp.z-p.pos.z);
      g.cam.yaw=Math.atan2(-(cp.x-p.pos.x),-(cp.z-p.pos.z)); keys=['forward','grip']; if(d>8) keys.push('sprint');
    } else {
      const st=g.world.arena2.stones; const sp=s.root.position;
      if(!stone||s.state==='hunt'&&!dodge){ stone=st.reduce((a,b)=>Math.hypot(b.x-p.pos.x,b.z-p.pos.z)<Math.hypot(a.x-p.pos.x,a.z-p.pos.z)?b:a); }
      const dir=new V(sp.x-stone.x,0,sp.z-stone.z).normalize(); const spot=new V(stone.x,0,stone.z).addScaledVector(dir,3.2);
      const d=Math.hypot(spot.x-p.pos.x,spot.z-p.pos.z), db=Math.hypot(sp.x-p.pos.x,sp.z-p.pos.z);
      if(s.state==='charge'&&db<17&&dodge<=0){ dodge=1.1; }
      if(dodge>0){ dodge-=1/60; const side=new V(-dir.z,0,dir.x); const t=p.pos.clone().addScaledVector(side,5); g.cam.yaw=Math.atan2(-(t.x-p.pos.x),-(t.z-p.pos.z)); keys=['forward','sprint']; }
      else if(d>1.0 && s.state!=='charge'){ g.cam.yaw=Math.atan2(-(spot.x-p.pos.x),-(spot.z-p.pos.z)); keys=['forward']; if(d>6) keys.push('sprint'); }
    }
  } else {
    const target=s.weakPoints.find(w=>!w.destroyed); const tp=wpPos(target); const near=s.weakPointNear(p.lastAttWorld||p.pos,2.6);
    const shaking=s.state==='shaking'||s.state==='shakeWarn';
    const N=p.climbNormal||new V(0,0,1);
    keys=['grip'];
    if(shaking){ }
    else if(near){ k++; if(k%150<100) keys.push('interact'); }
    else if(p.stamina<25 && N.y>0.9 && s.state==='carry'&&s.shakeIntensity<0.15){ keys=[]; }
    else if(p.stamina>=25||N.y<0.7){ k=0; g.cam.yaw=Math.atan2(-(tp.x-p.pos.x),-(tp.z-p.pos.z)); keys.push('forward'); }
    if(p.stamina<30) window.__rest=true; if(p.stamina>92) window.__rest=false; if(N.y>0.9 && s.state==='carry'&&s.shakeIntensity<0.15 && window.__rest && !near) keys=[];
  }
  H(...keys); bot.frame(false);
  if(i%600===0) await new Promise(r=>setTimeout(r,0));
}
H(); return ev;}