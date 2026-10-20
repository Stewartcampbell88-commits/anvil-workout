// ANVIL · How-to sheets: looping figure animations, cues, mistakes, easier/harder.
// Classic script (shared global scope, no build step); load order is set in index.html.
const HTK = { TH:29, SH:27, TO:36, UA:22, FA:20, HD:9, HR:7, FT:8, FLOOR:162 };
const HT_PREF = { f:[1,0], b:[-1,0], u:[0,-1], d:[0,1], fu:[.7,-.7], fd:[.7,.7], bu:[-.7,-.7], bd:[-.7,.7] };
function htDir(a){ const r=a*Math.PI/180; return [Math.sin(r), -Math.cos(r)]; }
function htAng(v){ return Math.atan2(v[0], -v[1])*180/Math.PI; }
function htAdd(p,v,k){ return [p[0]+v[0]*k, p[1]+v[1]*k]; }
function htLerp(a,b,u){ return a+(b-a)*u; }
function htLerpAng(a,b,u){ let d=((b-a)%360+540)%360-180; return a+d*u; }
function htIK(root, target, L1, L2, pref){
  const dx=target[0]-root[0], dy=target[1]-root[1], d=Math.hypot(dx,dy)||0.001;
  const dc=Math.min(L1+L2-0.05, Math.max(Math.abs(L1-L2)+0.05, d));
  const a=Math.acos(Math.min(1,Math.max(-1,(L1*L1+dc*dc-L2*L2)/(2*L1*dc))));
  const base=Math.atan2(dy,dx), pv=HT_PREF[pref]||pref||HT_PREF.f;
  const c1=[root[0]+L1*Math.cos(base+a), root[1]+L1*Math.sin(base+a)];
  const c2=[root[0]+L1*Math.cos(base-a), root[1]+L1*Math.sin(base-a)];
  const s=(c)=>(c[0]-root[0])*pv[0]+(c[1]-root[1])*pv[1];
  const j = s(c1)>=s(c2)?c1:c2;
  const jx=target[0]-j[0], jy=target[1]-j[1], jd=Math.hypot(jx,jy)||1;
  return [j, [j[0]+jx/jd*L2, j[1]+jy/jd*L2]];
}
/* point spec: [x,y] absolute | ["n",dx,dy] neck-rel | ["h",dx,dy] hip-rel | ["t",along,front] torso-local */
function htPt(s, J){
  if (typeof s[0]==="number") return s;
  if (s[0]==="n") return [J.neck[0]+s[1], J.neck[1]+s[2]];
  if (s[0]==="h") return [J.hip[0]+s[1], J.hip[1]+s[2]];
  const ax=htDir(J.t), fr=htDir(J.t+90);
  return [J.neck[0]-ax[0]*s[1]+fr[0]*s[2], J.neck[1]-ax[1]*s[1]+fr[1]*s[2]];
}
function htNorm(p){
  const q={h:0, fa:90, sw:12, hw:7, sL:1, sR:1, ...p};
  if (q.N && q.t==null) q.t = htAng([q.N[0]-q.hip[0], q.N[1]-q.hip[1]]);
  if (q.t==null) q.t=0;
  if (!q.F) q.F=[q.hip[0]+2, 158];
  if (!q.B) q.B=q.F;
  if (q.fb==null) q.fb=q.fa;
  if (!q.H) q.H=["n",2,40];
  if (!q.V) q.V=q.H;
  return q;
}
function htPose(A, B, u, view){
  const t=htLerpAng(A.t,B.t,u), hip=[htLerp(A.hip[0],B.hip[0],u), htLerp(A.hip[1],B.hip[1],u)];
  const J={t, hip, neck:htAdd(hip, htDir(t), HTK.TO)};
  J.head = htAdd(J.neck, htDir(t+htLerpAng(A.h,B.h,u)), HTK.HD);
  const P=(k)=>{ const a=htPt(A[k],J), b=htPt(B[k],J); return [htLerp(a[0],b[0],u), htLerp(a[1],b[1],u)]; };
  const n=(k)=>htLerp(A[k],B[k],u);
  const pr=(k,def)=>(u<.5?A[k]:B[k])||def;
  const sL=n("sL"), sR=n("sR");
  if (view==="front"){
    const pp=htDir(t+90), sw=n("sw"), hw=n("hw");
    J.hipL=htAdd(hip,pp,-hw); J.hipR=htAdd(hip,pp,hw);
    J.shL=htAdd(J.neck,pp,-sw); J.shR=htAdd(J.neck,pp,sw);
    [J.knee,J.ank]=htIK(J.hipL,P("F"),HTK.TH*sL,HTK.SH*sL,pr("kp","b"));
    [J.knee2,J.ank2]=htIK(J.hipR,P("B"),HTK.TH*sR,HTK.SH*sR,pr("kp2","f"));
    [J.elb,J.wri]=htIK(J.shL,P("H"),HTK.UA,HTK.FA,pr("ep","bd"));
    [J.elb2,J.wri2]=htIK(J.shR,P("V"),HTK.UA,HTK.FA,pr("ep2","fd"));
    J.toe=htAdd(J.ank,htDir(htLerpAng(A.fa,B.fa,u)),HTK.FT-2);
    J.toe2=htAdd(J.ank2,htDir(htLerpAng(A.fb,B.fb,u)),HTK.FT-2);
  } else {
    J.shL=J.shR=J.neck; J.hipL=J.hipR=hip;
    [J.knee,J.ank]=htIK(hip,P("F"),HTK.TH*sL,HTK.SH*sL,pr("kp","f"));
    [J.knee2,J.ank2]=htIK(hip,P("B"),HTK.TH*sR,HTK.SH*sR,pr("kp2",pr("kp","f")));
    [J.elb,J.wri]=htIK(J.neck,P("H"),HTK.UA,HTK.FA,pr("ep","d"));
    [J.elb2,J.wri2]=htIK(J.neck,P("V"),HTK.UA,HTK.FA,pr("ep2",pr("ep","d")));
    J.toe=htAdd(J.ank,htDir(htLerpAng(A.fa,B.fa,u)),HTK.FT);
    J.toe2=htAdd(J.ank2,htDir(htLerpAng(A.fb,B.fb,u)),HTK.FT);
  }
  return J;
}
const htF=(v)=>Math.round(v*10)/10;
const htPl=(pts,cls)=>`<polyline class="${cls}" points="${pts.map(p=>htF(p[0])+","+htF(p[1])).join(" ")}"/>`;
function htAt(J, at, d){ const p=J[at]||J.wri; return d?[p[0]+d[0],p[1]+d[1]]:p; }
function htProp(pr, J, layer){
  const back = pr.k==="bench"||pr.k==="box"||pr.k==="wall"||pr.k==="line"||pr.k==="bar"||pr.k==="post"||pr.k==="cable";
  if ((layer==="back")!==back) return "";
  const c=(p)=>`${htF(p[0])},${htF(p[1])}`;
  switch(pr.k){
    case "bench": return `<rect class="hq" x="${pr.x}" y="${pr.y}" width="${pr.w}" height="${pr.h||6}" rx="2"/>`+(pr.legs===false?"":`<line class="hql" x1="${pr.x+6}" y1="${pr.y+(pr.h||6)}" x2="${pr.x+6}" y2="${HTK.FLOOR}"/><line class="hql" x1="${pr.x+pr.w-6}" y1="${pr.y+(pr.h||6)}" x2="${pr.x+pr.w-6}" y2="${HTK.FLOOR}"/>`);
    case "box": return `<rect class="hq" x="${pr.x}" y="${pr.y}" width="${pr.w}" height="${HTK.FLOOR-pr.y}" rx="2"/>`;
    case "wall": return `<line class="hql" x1="${pr.x}" y1="${pr.y||20}" x2="${pr.x}" y2="${HTK.FLOOR}" style="stroke-width:4"/>`;
    case "post": return `<line class="hql" x1="${pr.x}" y1="${pr.y}" x2="${pr.x}" y2="${HTK.FLOOR}" style="stroke-width:4"/>`;
    case "line": return htPl(pr.pts,"hql").replace("<polyline", `<polyline style="stroke-width:${pr.w||4}"`);
    case "bar": return `<line class="hql" x1="${pr.x-30}" y1="${pr.y-8}" x2="${pr.x+30}" y2="${pr.y-8}" style="stroke-width:3"/><line class="hql" x1="${pr.x}" y1="${pr.y-8}" x2="${pr.x}" y2="${pr.y}" style="stroke-width:2"/><circle class="hi" cx="${pr.x}" cy="${pr.y}" r="3.2"/>`;
    case "cable": { const p=htAt(J,pr.at,pr.d); return `<line class="hcab" x1="${pr.to[0]}" y1="${pr.to[1]}" x2="${c(p).split(",")[0]}" y2="${c(p).split(",")[1]}"/>`; }
    case "plate": { const p=htAt(J,pr.at,pr.d); return `<circle class="hp" cx="${htF(p[0])}" cy="${htF(p[1])}" r="${pr.r||11}"/><circle class="hi" cx="${htF(p[0])}" cy="${htF(p[1])}" r="2.2"/>`; }
    case "db": { const p=htAt(J,pr.at,pr.d); return `<circle class="hp" cx="${htF(p[0])}" cy="${htF(p[1])}" r="${pr.r||5}" style="stroke-width:2.5"/>`; }
    case "kb": { const p=htAt(J,pr.at,pr.d); return `<circle class="hi" cx="${htF(p[0])}" cy="${htF(p[1]+7)}" r="6.5"/><circle class="hp" cx="${htF(p[0])}" cy="${htF(p[1]+1)}" r="3.2" style="stroke-width:2"/>`; }
    case "hbar": { const a=htAt(J,"wri"), b=htAt(J,"wri2"); const dx=b[0]-a[0], dy=b[1]-a[1], L=Math.hypot(dx,dy)||1, e=pr.ext||16; return `<line class="hbarl" x1="${htF(a[0]-dx/L*e)}" y1="${htF(a[1]-dy/L*e)}" x2="${htF(b[0]+dx/L*e)}" y2="${htF(b[1]+dy/L*e)}"/>`; }
    case "landmine": { const p=htAt(J,pr.at,pr.d), f=pr.from; const dx=p[0]-f[0], dy=p[1]-f[1], L=Math.hypot(dx,dy)||1, e=pr.ext||12; const q=[p[0]+dx/L*e, p[1]+dy/L*e]; return `<line class="hbarl" x1="${f[0]}" y1="${f[1]}" x2="${htF(q[0])}" y2="${htF(q[1])}"/><circle class="hp" cx="${htF(q[0])}" cy="${htF(q[1])}" r="7"/>`; }
    case "rot": { const p=htAt(J,pr.at||"head",pr.d||[0,-14]); return `<path class="hrot" d="M${htF(p[0]-11)},${htF(p[1]+2)} a11,4 0 1,0 22,0"/><path class="hrot" d="M${htF(p[0]+11)},${htF(p[1]+2)} l-1,-5 m1,5 l4,-3"/>`; }
  }
  return "";
}
function htSVG(A, B, u, def){
  const J=htPose(A,B,u,def.view);
  const front = def.view==="front";
  let s = `<line class="hfloor" x1="-200" y1="${HTK.FLOOR+2}" x2="440" y2="${HTK.FLOOR+2}"/>`;
  s += (def.props||[]).map(p=>htProp(p,J,"back")).join("");
  const bk = front?"hl":"hl hb";
  s += htPl([J.hipR,J.knee2,J.ank2,J.toe2], bk) + htPl([J.shR,J.elb2,J.wri2], bk);
  if (front) s += htPl([J.hipL,J.hipR],"hl ht") + htPl([J.shL,J.shR],"hl ht");
  s += htPl([J.hip,J.neck],"hl ht");
  s += `<circle class="hh" cx="${htF(J.head[0])}" cy="${htF(J.head[1])}" r="${HTK.HR}"/>`;
  s += htPl([J.hipL||J.hip,J.knee,J.ank,J.toe],"hl") + htPl([J.shL,J.elb,J.wri],"hl");
  s += (def.props||[]).map(p=>htProp(p,J,"front")).join("");
  return s;
}
function htEase(u){ return 0.5-0.5*Math.cos(Math.PI*u); }
function htFrame(def, ms){
  const seq=def.seq||[0,1], dur=def.dur||1000, hold=def.hold??220, seg=dur+hold;
  const total=seq.length*seg, tt=Math.max(0,ms)%total, i=Math.floor(tt/seg), w=tt-i*seg;
  const A=def._p[seq[i]], B=def._p[seq[(i+1)%seq.length]];
  return htSVG(A,B, w<hold?0:htEase((w-hold)/dur), def);
}
function htBox(def){
  if (def._box) return def._box;
  let x0=1e9,y0=1e9,x1=-1e9,y1=HTK.FLOOR+9;
  const add=(p,r=0)=>{ if(!p) return; x0=Math.min(x0,p[0]-r); x1=Math.max(x1,p[0]+r); y0=Math.min(y0,p[1]-r); y1=Math.max(y1,p[1]+r); };
  const P=def._p;
  for (let a=0;a<P.length;a++) for (let b=0;b<P.length;b++) for (let k=0;k<=4;k++){
    const J=htPose(P[a],P[b],k/4,def.view);
    ["hip","neck","knee","ank","toe","knee2","ank2","toe2","elb","wri","elb2","wri2","hipL","hipR","shL","shR"].forEach(n=>add(J[n],4));
    add(J.head,HTK.HR+2);
    for (const pr of def.props||[]) if (pr.k==="plate"||pr.k==="db"||pr.k==="kb"||pr.k==="landmine") add(htAt(J,pr.at,pr.d),(pr.r||11)+2);
  }
  for (const pr of def.props||[]){
    if (pr.k==="bench"||pr.k==="box") { add([pr.x,pr.y]); add([pr.x+pr.w,pr.y]); }
    if (pr.k==="bar") { add([pr.x-30,pr.y-10]); add([pr.x+30,pr.y]); }
    if (pr.k==="line") pr.pts.forEach(p=>add(p));
    if (pr.k==="wall"||pr.k==="post") add([pr.x,pr.y||20]);
    if (pr.k==="cable") add(pr.to);
  }
  x0-=12; x1+=12; y0-=10;
  let w=x1-x0, h=y1-y0; const R=1.6;
  if (w/h<R){ const nw=h*R; x0-=(nw-w)/2; w=nw; } else { const nh=w/R; y0-=(nh-h); h=nh; }
  return def._box=`${htF(x0)} ${htF(y0)} ${htF(w)} ${htF(h)}`;
}
/* Poses: hip [x,y], t torso angle (0 up, 90 forward) or N neck point, F/B feet, H/V hands, kp/ep knee/elbow bend pref. Floor y=162, ankle y≈158. */
const HT_BENCH = {k:"bench", x:44, y:120, w:92};
const HT_ANIMS = {
  stand: { poses:[ {hip:[118,102]}, {hip:[118,101]} ], dur:1400 },
  squat: { props:[{k:"plate",at:"neck",d:[-6,3],r:10}], poses:[
    {hip:[115,102], t:4, F:[120,158], H:["n",-9,3], ep:"d"},
    {hip:[95,128], t:42, F:[120,158], H:["n",-9,3], ep:"d"} ], dur:1100 },
  frontsquat: { props:[{k:"plate",at:"neck",d:[7,1]}], poses:[
    {hip:[116,102], t:2, F:[120,158], H:["n",9,3], ep:"d"},
    {hip:[100,130], t:24, F:[120,158], H:["n",9,3], ep:"d"} ], dur:1100 },
  goblet: { props:[{k:"kb",at:"wri"}], poses:[
    {hip:[116,102], t:2, F:[120,158], H:["n",10,8], ep:"d"},
    {hip:[100,130], t:22, F:[120,158], H:["n",10,8], ep:"d"} ], dur:1100 },
  rdl: { props:[{k:"plate",at:"wri"}], poses:[
    {hip:[116,102], t:2, F:[120,158], H:["n",3,40], ep:"b"},
    {hip:[100,114], t:64, F:[120,158], H:["n",-4,40], ep:"b"} ], dur:1200 },
  rdlplates: { props:[{k:"plate",at:"wri",r:6}], poses:[
    {hip:[116,102], t:2, F:[120,158], H:["n",3,40], ep:"b"},
    {hip:[100,114], t:64, F:[120,158], H:["n",-4,40], ep:"b"} ], dur:1200 },
  rdldb: { props:[{k:"db",at:"wri"}], poses:[
    {hip:[116,102], t:2, F:[120,158], H:["n",3,40], ep:"b"},
    {hip:[100,114], t:64, F:[120,158], H:["n",-4,40], ep:"b"} ], dur:1200 },
  deadlift: { props:[{k:"plate",at:"wri"}], poses:[
    {hip:[93,127], t:60, F:[120,158], H:[124,151], ep:"b"},
    {hip:[116,102], t:0, F:[120,158], H:[119,107], ep:"b"} ], dur:1100 },
  goodmorning: { props:[{k:"plate",at:"neck",d:[-6,3],r:10}], poses:[
    {hip:[116,102], t:2, F:[120,158], H:["n",-9,3], ep:"d"},
    {hip:[101,106], t:76, F:[120,158], H:["n",-9,3], ep:"d"} ], dur:1200 },
  slrdl: { props:[{k:"db",at:"wri"}], poses:[
    {hip:[117,102], t:1, F:[120,158], B:[112,152], fb:150, H:["n",2,40]},
    {hip:[110,105], t:80, F:[120,158], B:["h",-55,9], fb:-170, H:["n",0,40], kp2:"d"} ], dur:1300 },
  sgm: { props:[{k:"bench",x:66,y:118,w:52},{k:"plate",at:"neck",d:[-6,3],r:10}], poses:[
    {hip:[104,114], t:0, F:[136,158], H:["n",-9,3], ep:"d", kp:"u"},
    {hip:[104,114], t:70, F:[136,158], H:["n",-9,3], ep:"d", kp:"u"} ], dur:1200 },
  bext: { props:[{k:"line",pts:[[96,130],[116,110]],w:7},{k:"line",pts:[[106,121],[106,162]],w:3},{k:"line",pts:[[60,150],[70,160]],w:4},{k:"line",pts:[[64,155],[64,162]],w:3},{k:"rot",at:"head",d:[0,-12]}],
    seq:[0,1,2,1,0,1,3,1], dur:900, hold:160, poses:[
    {hip:[108,112], t:150, F:[68,151], h:0, fa:-10, H:["t",11,5], ep:"f", kp:"u"},
    {hip:[108,112], t:45, F:[68,151], fa:-10, H:["t",11,5], ep:"f", kp:"u"},
    {hip:[108,112], t:45, F:[68,151], fa:-10, H:["t",4,9], V:["t",15,1], ep:"u", ep2:"d", kp:"u"},
    {hip:[108,112], t:45, F:[68,151], fa:-10, H:["t",15,1], V:["t",4,9], ep:"d", ep2:"u", kp:"u"} ] },
  bench: { props:[HT_BENCH,{k:"plate",at:"wri"}], poses:[
    {hip:[118,117], t:-90, F:[150,158], kp:"u", H:[84,76], ep:"d", h:-5},
    {hip:[118,117], t:-90, F:[150,158], kp:"u", H:[89,106], ep:"d", h:-5} ], dur:1100 },
  benchplate: { props:[HT_BENCH,{k:"db",at:"wri",r:6}], poses:[
    {hip:[118,117], t:-90, F:[150,158], kp:"u", H:[84,76], ep:"d", h:-5},
    {hip:[118,117], t:-90, F:[150,158], kp:"u", H:[89,106], ep:"d", h:-5} ], dur:1100 },
  dbbench: { props:[HT_BENCH,{k:"db",at:"wri"}], poses:[
    {hip:[118,117], t:-90, F:[150,158], kp:"u", H:[84,76], ep:"d", h:-5},
    {hip:[118,117], t:-90, F:[150,158], kp:"u", H:[88,108], ep:"d", h:-5} ], dur:1100 },
  incline: { props:[{k:"line",pts:[[126,121],[66,86]],w:6},{k:"line",pts:[[108,122],[108,162]],w:3},{k:"plate",at:"wri"}], poses:[
    {hip:[118,116], t:-62, F:[150,158], kp:"u", H:[88,57], ep:"d"},
    {hip:[118,116], t:-62, F:[150,158], kp:"u", H:[95,91], ep:"d"} ], dur:1100 },
  floorpress: { props:[{k:"plate",at:"wri"}], poses:[
    {hip:[120,154], t:-90, F:[150,158], kp:"u", H:[86,113], ep:"d", h:-5},
    {hip:[120,154], t:-90, F:[150,158], kp:"u", H:[93,136], ep:"f", h:-5} ], dur:1100 },
  ohp: { props:[{k:"plate",at:"wri"}], poses:[
    {hip:[118,102], t:0, F:[120,158], H:[127,63], ep:"d"},
    {hip:[118,102], t:0, F:[120,158], H:[120,25], ep:"d"} ], dur:1000 },
  ohpplates: { props:[{k:"plate",at:"wri",r:6}], poses:[
    {hip:[118,102], t:0, F:[120,158], H:[127,63], ep:"d"},
    {hip:[118,102], t:0, F:[120,158], H:[120,25], ep:"d"} ], dur:1000 },
  dbohp: { props:[{k:"db",at:"wri"}], poses:[
    {hip:[118,102], t:0, F:[120,158], H:[126,62], ep:"d"},
    {hip:[118,102], t:0, F:[120,158], H:[120,25], ep:"d"} ], dur:1000 },
  row: { props:[{k:"plate",at:"wri"}], poses:[
    {hip:[102,106], t:68, F:[120,158], H:["n",-2,40], ep:"b"},
    {hip:[102,106], t:68, F:[120,158], H:[119,106], ep:"u"} ], dur:900 },
  rowplates: { props:[{k:"plate",at:"wri",r:6}], poses:[
    {hip:[102,106], t:68, F:[120,158], H:["n",-2,40], ep:"b"},
    {hip:[102,106], t:68, F:[120,158], H:[119,106], ep:"u"} ], dur:900 },
  dbrow: { props:[{k:"bench",x:132,y:118,w:70},{k:"db",at:"wri"}], poses:[
    {hip:[102,106], t:72, F:[118,158], H:["n",-2,40], V:[160,118], ep:"b", ep2:"f"},
    {hip:[102,106], t:72, F:[118,158], H:[121,103], V:[160,118], ep:"u", ep2:"f"} ], dur:900 },
  invrow: { props:[{k:"bar",x:146,y:84}], poses:[
    {hip:[100,136], N:[132,124], F:[48,154], fa:0, kp:"u", H:[146,84], ep:"d"},
    {hip:[104,118], N:[138,102], F:[48,154], fa:0, kp:"u", H:[146,84], ep:"bd"} ], dur:1000 },
  pullup: { props:[{k:"bar",x:124,y:16}], poses:[
    {hip:[118,93], t:-3, F:[106,142], kp:"f", H:[124,16], ep:"f", h:-8},
    {hip:[112,59], t:-3, F:[100,108], kp:"f", H:[124,16], ep:"fd", h:-8} ], dur:1100 },
  hang: { props:[{k:"bar",x:124,y:16}], poses:[
    {hip:[119,95], t:-2, F:[108,146], kp:"f", H:[124,16], ep:"f"},
    {hip:[119,91], t:-2, F:[108,142], kp:"f", H:[124,16], ep:"f"} ], dur:1500, hold:500 },
  kneeraise: { props:[{k:"bar",x:124,y:16}], poses:[
    {hip:[119,93], t:-2, F:[110,146], kp:"f", H:[124,16], ep:"f"},
    {hip:[117,92], t:-8, F:[136,118], kp:"u", H:[124,16], ep:"f"} ], dur:1000 },
  pulldown: { props:[{k:"box",x:92,y:132,w:34},{k:"cable",at:"wri",to:[118,2]}], poses:[
    {hip:[110,126], t:-6, F:[148,158], kp:"u", H:[116,48], ep:"f"},
    {hip:[110,126], t:-12, F:[148,158], kp:"u", H:[120,86], ep:"bd"} ], dur:1000 },
  dips: { props:[{k:"line",pts:[[100,96],[146,96]],w:4},{k:"post",x:140,y:96}], poses:[
    {hip:[115,87], t:5, F:["h",-14,44], kp:"f", H:[120,93], ep:"b"},
    {hip:[100,106], t:24, F:["h",-14,44], kp:"f", H:[120,93], ep:"b"} ], dur:1000 },
  pushup: { poses:[
    {hip:[114,131], N:[147,118], F:[62,152], fa:175, H:[150,158], ep:"b"},
    {hip:[118,149], N:[144,145], F:[62,152], fa:175, H:[150,158], ep:"b"} ], dur:1000 },
  pike: { poses:[
    {hip:[108,103], N:[140,120], F:[84,152], fa:175, H:[146,158], ep:"b", kp:"u"},
    {hip:[113,110], N:[139,140], F:[84,152], fa:175, H:[146,158], ep:"b", kp:"u"} ], dur:1000 },
  plank: { poses:[
    {hip:[100,142], N:[138,135], F:[46,153], fa:175, H:[160,158], ep:"d"},
    {hip:[100,140], N:[138,134], F:[46,153], fa:175, H:[160,158], ep:"d"} ], dur:1600, hold:400 },
  deadbug: { seq:[0,1,0,2], poses:[
    {hip:[134,153], t:-90, F:[162,124], kp:"u", H:[100,112], ep:"u"},
    {hip:[134,153], t:-90, F:[162,124], B:[188,148], kp:"u", kp2:"u", H:[60,140], V:[100,112], ep:"u"},
    {hip:[134,153], t:-90, F:[188,148], B:[162,124], kp:"u", kp2:"u", H:[100,112], V:[60,140], ep:"u"} ], dur:1000 },
  psoas: { seq:[0,1,0,2], poses:[
    {hip:[124,153], t:-90, F:[178,156], fa:0, H:[146,157], ep:"u"},
    {hip:[124,153], t:-90, F:[146,126], B:[178,156], fa:20, fb:0, kp:"u", H:[146,157], ep:"u"},
    {hip:[124,153], t:-90, F:[178,156], B:[146,126], fa:0, fb:20, kp2:"u", H:[146,157], ep:"u"} ], dur:900 },
  bridge: { poses:[
    {hip:[124,152], N:[90,153], F:[150,158], kp:"u", H:[128,158], ep:"u"},
    {hip:[124,127], N:[92,152], F:[150,158], kp:"u", H:[128,158], ep:"u"} ], dur:1000, hold:350 },
  hipthrust: { props:[{k:"bench",x:44,y:124,w:44},{k:"plate",at:"hip",d:[2,-9]}], poses:[
    {hip:[110,148], N:[86,124], F:[150,158], kp:"u", H:["h",0,-7], ep:"f"},
    {hip:[120,122], N:[86,120], F:[150,158], kp:"u", H:["h",0,-7], ep:"f"} ], dur:1000, hold:350 },
  swing: { props:[{k:"kb",at:"wri"}], poses:[
    {hip:[99,108], t:60, F:[120,158], H:[118,130], ep:"b"},
    {hip:[117,102], t:-4, F:[120,158], H:[154,70], ep:"d"} ], dur:700, hold:120 },
  calf: { poses:[
    {hip:[118,102], t:0, F:[120,158], H:["n",2,40]},
    {hip:[118,95], t:0, F:[120,151], fa:138, H:["n",2,40]} ], dur:800, hold:300 },
  curl: { props:[{k:"db",at:"wri"}], poses:[
    {hip:[118,102], t:0, F:[120,158], H:["n",3,41], ep:"b"},
    {hip:[118,102], t:-2, F:[120,158], H:["n",12,4], ep:"d"} ], dur:900 },
  bss: { props:[{k:"bench",x:44,y:110,w:40}], poses:[
    {hip:[112,99], t:6, F:[132,158], B:[66,104], fb:-120, kp2:"d"},
    {hip:[103,124], t:14, F:[132,158], B:[66,104], fb:-120, kp2:"d"} ], dur:1100 },
  revlunge: { poses:[
    {hip:[118,102], t:0, F:[122,158], B:[118,158]},
    {hip:[110,126], t:6, F:[132,158], B:[74,154], fb:150, kp2:"d"} ], dur:1100 },
  stepup: { props:[{k:"box",x:126,y:130,w:46}], poses:[
    {hip:[114,110], t:14, F:[142,126], B:[104,158], kp:"f", kp2:"f"},
    {hip:[140,72], t:2, F:[142,126], B:[154,104], kp:"f", kp2:"f", fb:120} ], dur:1100 },
  wallsit: { props:[{k:"wall",x:88,y:40}], poses:[
    {hip:[96,126], t:0, F:[126,158], kp:"u", H:["t",12,6], ep:"f"},
    {hip:[96,125], t:0, F:[126,158], kp:"u", H:["t",12,6], ep:"f"} ], dur:1600, hold:400 },
  situp: { poses:[
    {hip:[122,154], t:-90, F:[150,158], kp:"u", H:["t",10,6], ep:"f", h:-5},
    {hip:[122,153], t:8, F:[150,158], kp:"u", H:["t",10,6], ep:"f"} ], dur:1000, hold:300 },
  abd: { poses:[
    {hip:[124,152], t:-90, F:[180,154], B:[180,156], fa:0, fb:0, H:[104,158], V:[80,140], ep:"d", h:-10},
    {hip:[124,152], t:-90, F:[176,128], B:[180,156], fa:-10, fb:0, H:[104,158], V:[80,140], ep:"d", h:-10} ], dur:1000, hold:300 },
  farmer: { props:[{k:"db",at:"wri"}], seq:[0,1,0,2], poses:[
    {hip:[118,101], t:0, F:[120,158], H:["n",2,41]},
    {hip:[118,100], t:2, F:[134,158], B:[106,156], fb:130, H:["n",2,41], kp2:"f"},
    {hip:[118,100], t:2, F:[106,156], B:[134,158], fa:130, H:["n",2,41]} ], dur:600, hold:60 },
  /* front-view */
  cossack: { view:"front", seq:[0,1,0,2], poses:[
    {hip:[120,108], t:0, F:[88,158], B:[152,158], fa:-110, fb:110, H:[116,86], V:[124,86], kp:"b", kp2:"f", ep:"d", ep2:"d"},
    {hip:[95,137], t:6, F:[88,158], B:[152,158], fa:-110, fb:20, sL:.66, H:[96,113], V:[104,113], kp:"b", kp2:"u", ep:"d", ep2:"d"},
    {hip:[145,137], t:-6, F:[88,158], B:[152,158], fa:-20, fb:110, sR:.66, H:[136,113], V:[144,113], kp:"b", kp2:"f", ep:"d", ep2:"d"} ], dur:1100 },
  lmr: { view:"front", props:[{k:"landmine",from:[120,162],at:"wri"}], seq:[0,1,2,1], poses:[
    {hip:[119,104], t:-12, sw:6, F:[104,158], B:[136,158], fa:-110, fb:110, H:[86,90], V:[88,92], kp:"b", kp2:"b", ep:"d", ep2:"d"},
    {hip:[120,103], t:0, sw:12, F:[104,158], B:[136,158], fa:-110, fb:110, H:[119,30], V:[121,30], kp:"b", kp2:"f", ep:"b", ep2:"f"},
    {hip:[121,104], t:12, sw:6, F:[104,158], B:[136,158], fa:-110, fb:110, H:[152,92], V:[154,90], kp:"f", kp2:"f", ep:"d", ep2:"d"} ], dur:1000, hold:150 },
  lateral: { view:"front", props:[{k:"db",at:"wri"},{k:"db",at:"wri2"}], poses:[
    {hip:[120,102], t:0, F:[110,158], B:[130,158], fa:-110, fb:110, H:[103,106], V:[137,106], ep:"b", ep2:"f"},
    {hip:[120,102], t:0, F:[110,158], B:[130,158], fa:-110, fb:110, H:[69,72], V:[171,72], ep:"d", ep2:"d"} ], dur:1000 },
  bandpull: { view:"front", props:[{k:"hbar",ext:0}], poses:[
    {hip:[120,102], t:0, F:[110,158], B:[130,158], fa:-110, fb:110, H:[104,74], V:[136,74], ep:"d", ep2:"d"},
    {hip:[120,102], t:0, F:[110,158], B:[130,158], fa:-110, fb:110, H:[70,68], V:[170,68], ep:"d", ep2:"d"} ], dur:900 },
};
for (const d of Object.values(HT_ANIMS)) d._p = d.poses.map(htNorm);
/* How-to guide content, keyed by exercise id. Add a lift: give it an entry (or an alias below). */
const HOWTO = {
  squat: { anim:"squat",
    cues:["Feet shoulder-width, toes slightly out","Brace your belly, then sit hips down and back","Knees track over your toes","Drive up through mid-foot, chest proud"],
    mistakes:["Knees caving inward","Heels lifting off the floor","Lower back rounding at the bottom"],
    easier:["Box squat to a chair","Goblet squat"], harder:["Pause squat (2 s at the bottom)","Front squat"] },
  "front-squat": { anim:"frontsquat",
    cues:["Bar on the front of the shoulders, elbows high","Sit straight down between your heels","Stay tall — torso more upright than a back squat","Drive up leading with the elbows"],
    mistakes:["Elbows dropping so the bar rolls forward","Heels lifting","Rounding the upper back"],
    easier:["Goblet squat","Box front squat"], harder:["Pause front squat","Slow 3 s lowering"] },
  goblet: { anim:"goblet",
    cues:["Hold the weight at your chest, elbows down","Sit between your knees, chest up","Knees track over toes","Stand tall and squeeze glutes at the top"],
    mistakes:["Letting the weight pull you forward","Heels lifting","Half reps"],
    easier:["Squat to a box","Lighter weight"], harder:["Pause at the bottom","Front squat"] },
  bench: { anim:"bench",
    cues:["Eyes under the bar, feet planted","Squeeze shoulder blades together and down","Lower to mid-chest, elbows about 45°","Press up and slightly back to lockout"],
    mistakes:["Bouncing the bar off the chest","Elbows flared out to 90°","Hips lifting off the bench"],
    easier:["Plate or dumbbell press","Floor press"], harder:["Paused bench (1 s on the chest)","Close-grip bench"] },
  incline: { anim:"incline",
    cues:["Bench at about 30–45°","Shoulder blades back and down","Lower to the upper chest","Press straight up over the shoulders"],
    mistakes:["Bench too steep (turns into a shoulder press)","Bouncing at the bottom","Flaring elbows wide"],
    easier:["Incline dumbbell press","Lower incline"], harder:["Pause at the chest","Slow 3 s lowering"] },
  "floor-press": { anim:"floorpress",
    cues:["Lie on the floor, knees bent, feet flat","Lower until the upper arms touch the floor","Pause softly, then press","Shoulder blades pulled back"],
    mistakes:["Slamming the elbows down","Flaring elbows to 90°","Losing tightness at the bottom"],
    easier:["Dumbbell floor press","Lighter load"], harder:["Longer pause on the floor","Bench press"] },
  "db-bench": { anim:"dbbench",
    cues:["Dumbbells over the chest, palms forward or angled","Lower slowly to chest level","Elbows about 45° from the body","Press up and slightly together"],
    mistakes:["Dropping the weights too low","Elbows flared wide","Arching hips off the bench"],
    easier:["Floor press","Lighter dumbbells"], harder:["Pause at the bottom","Single-arm press"] },
  row: { anim:"row",
    cues:["Hinge to about 45°, flat back, soft knees","Pull to your lower ribs","Lead with the elbows, squeeze shoulder blades","Lower under control"],
    mistakes:["Standing up as you pull","Jerking with the hips","Shrugging toward the ears"],
    easier:["Chest-supported dumbbell row","Inverted row"], harder:["Pendlay row (dead stop each rep)","1 s squeeze at the ribs"] },
  "db-row": { anim:"dbrow",
    cues:["Hand and knee on the bench, back flat","Pull the dumbbell to your hip pocket","Elbow close to the body","Full stretch at the bottom"],
    mistakes:["Twisting the torso to lift","Pulling to the shoulder","Rushing the lowering"],
    easier:["Lighter dumbbell","Chest-supported row"], harder:["Pause at the top","Slow 3 s lowering"] },
  "inverted-row": { anim:"invrow",
    cues:["Body straight from heels to head","Pull your chest to the bar","Squeeze shoulder blades at the top","Lower all the way"],
    mistakes:["Hips sagging","Reaching with the chin","Half reps"],
    easier:["Bend the knees","Higher bar (more upright)"], harder:["Feet elevated","Pause at the top"] },
  slrdl: { anim:"slrdl",
    cues:["Soft knee on the standing leg","Hinge forward as the back leg reaches behind","Keep hips square to the floor","Stand tall by squeezing the glute"],
    mistakes:["Hip opening up / rotating","Rounding the back to reach lower","Rushing and losing balance"],
    easier:["Kickstand RDL (back toe touches down)","Hold a wall or rack"], harder:["Heavier dumbbell in the opposite hand","2 s pause at the bottom"] },
  cossack: { anim:"cossack", ladder:"cossack",
    cues:["Wide stance, toes slightly out","Sit into one hip; other leg straight, toes up","Heel of the bent leg stays down","Chest up, push back through the middle"],
    mistakes:["Heel lifting off the floor","Rounding forward to get deeper","Bouncing at the bottom"],
    easier:["Hold a rack or bench","Shorter range"], harder:["Full depth","Goblet Cossack (weight at chest)"] },
  sgm: { anim:"sgm",
    cues:["Sit tall on the bench, bar on the upper back","Brace, then hinge forward from the hips","Spine long — only go as low as you stay flat","Squeeze glutes to sit back up"],
    mistakes:["Rounding the upper or lower back","Going too deep too soon","Bar rolling up onto the neck"],
    easier:["Bodyweight, hands across chest","Broomstick instead of a bar"], harder:["2 s pause at the bottom","Standing good morning"] },
  "good-morning": { anim:"goodmorning",
    cues:["Bar on the upper back, soft knees","Push hips back, chest forward","Stop when hamstrings stretch, back flat","Drive hips forward to stand"],
    mistakes:["Rounding the back","Bending the knees into a squat","Going too heavy"],
    easier:["Seated good morning","Broomstick"], harder:["Pause at the bottom","Slow 3 s lowering"] },
  bext: { anim:"bext",
    cues:["Hips on the pad edge, feet locked in","Lower slowly by hinging at the hips","Rise to a straight line — not past it","Twist: rotate your chest to one side at the top, alternate sides"],
    mistakes:["Over-arching at the top","Swinging for momentum","Twisting before you reach the top"],
    easier:["No twist, smaller range","Floor superman or bird dog"], harder:["2 s pause at the top","Hold a light plate at the chest"] },
  rdl: { anim:"rdl",
    cues:["Bar close to the legs the whole way","Soft knees, push hips back","Lower until the hamstrings stretch, back flat","Drive hips forward to stand"],
    mistakes:["Squatting it down (too much knee)","Bar drifting away from the legs","Rounding the back"],
    easier:["Dumbbell or plate RDL","Shorter range (to the knees)"], harder:["1 s pause below the knee","Single-leg RDL"] },
  "db-rdl": { anim:"rdldb",
    cues:["Dumbbells against the thighs","Soft knees, push hips back","Lower until hamstrings stretch, back flat","Squeeze glutes to stand"],
    mistakes:["Rounding the back","Dumbbells swinging forward","Too much knee bend"],
    easier:["Lighter dumbbells","Shorter range"], harder:["Pause at the bottom","Single-leg RDL"] },
  dl: { anim:"deadlift",
    cues:["Bar over mid-foot, shins close","Hinge down, grip, flat back","Push the floor away, bar slides up the legs","Stand tall — hips and shoulders finish together"],
    mistakes:["Rounding the back off the floor","Hips shooting up first","Leaning back at the top"],
    easier:["Raised-bar (block) deadlift","Kettlebell deadlift"], harder:["Pause just off the floor","Deficit deadlift"] },
  "kb-swing": { anim:"swing",
    cues:["Hike the bell back between the thighs","Snap hips forward — arms just guide","Bell floats to chest height","Plank tall at the top, then hinge again"],
    mistakes:["Squatting instead of hinging","Lifting with the arms","Leaning back at the top"],
    easier:["Kettlebell deadlift","Lighter bell"], harder:["Heavier bell","Single-arm swing"] },
  "hip-thrust": { anim:"hipthrust",
    cues:["Upper back on the bench edge, feet flat","Bar or weight over the hips","Drive hips up to a flat table","Chin tucked, squeeze glutes at the top"],
    mistakes:["Arching the low back at the top","Feet too far out (hamstrings take over)","Rushing the top squeeze"],
    easier:["Glute bridge on the floor","Bodyweight"], harder:["2 s pause at the top","Single-leg hip thrust"] },
  "glute-bridge": { anim:"bridge",
    cues:["Lie on your back, knees bent, feet flat","Press through the heels","Lift hips to a straight line knees–shoulders","Squeeze glutes, lower slowly"],
    mistakes:["Arching the low back","Pushing through the toes","Bouncing reps"],
    easier:["Smaller range","Hold the top instead of reps"], harder:["Single-leg bridge","Hip thrust"] },
  ohp: { anim:"ohp",
    cues:["Grip just outside the shoulders, elbows slightly forward","Squeeze glutes and brace — no leaning back","Press straight up; move your head back, then through","Lock out over mid-foot"],
    mistakes:["Leaning back to press","Pressing forward instead of up","Ribs flaring / shrugging early"],
    easier:["Seated dumbbell press","Landmine press"], harder:["Push press (small knee dip)","Pause at forehead height"] },
  "db-ohp": { anim:"dbohp",
    cues:["Dumbbells at the shoulders, palms forward or in","Brace and squeeze glutes","Press up until arms are straight","Lower with control to the shoulders"],
    mistakes:["Leaning back","Clashing weights at the top","Half reps"],
    easier:["Seated, back supported","Lighter dumbbells"], harder:["Single-arm press","Standing, slow 3 s lowering"] },
  "lateral-raise": { anim:"lateral",
    cues:["Slight bend in the elbows","Lift out to the sides to shoulder height","Lead with the elbows, little fingers slightly up","Lower slowly"],
    mistakes:["Swinging the body","Shrugging the shoulders","Lifting above shoulder height"],
    easier:["Lighter dumbbells","One arm at a time"], harder:["Pause at the top","Slow 3 s lowering"] },
  pu: { anim:"pushup",
    cues:["Hands just wider than shoulders","Straight line head to heels","Lower chest to fist-height off the floor","Elbows about 45°, push the floor away"],
    mistakes:["Hips sagging","Elbows flaring to 90°","Head dropping first"],
    easier:["Hands on a bench or table","From the knees"], harder:["Feet elevated","Slow 3 s lowering"] },
  "close-pu": { anim:"pushup",
    cues:["Hands under the shoulders","Elbows brush the ribs","Straight line head to heels","Press to full lockout"],
    mistakes:["Elbows flaring out","Hips sagging","Half reps"],
    easier:["Hands elevated","From the knees"], harder:["Feet elevated","Pause at the bottom"] },
  "pike-pu": { anim:"pike",
    cues:["Hips high, body like an upside-down V","Lower your head between your hands","Elbows track back, not out","Press back up to the V"],
    mistakes:["Hips dropping into a push-up","Elbows flaring wide","Crashing the head down"],
    easier:["Hands on a bench","Smaller range"], harder:["Feet on a box","Wall handstand push-up"] },
  dip: { anim:"dips",
    cues:["Start locked out, shoulders down","Lean slightly forward","Lower until the shoulders are just below the elbows","Press back to lockout"],
    mistakes:["Going too deep","Shrugging up to the ears","Swinging the legs"],
    easier:["Bench dips, feet on the floor","Band-assisted dips"], harder:["Pause at the bottom","Weighted dips"] },
  heaves: { anim:"pullup", ladder:"heave", stageAnim:["hang"],
    cues:["Grip just outside the shoulders, start from a dead hang","Pull elbows down to the ribs","Chin over the bar","Lower all the way with control"],
    mistakes:["Kipping or swinging","Half reps","Shrugging at the top"],
    easier:["Feet-assisted or band-assisted","Negatives (slow lowering)"], harder:["2 s pause at the top","Weighted"] },
  pullup: { anim:"pullup",
    cues:["Palms away, grip just outside the shoulders","Start from a dead hang","Pull elbows down to the ribs, chin over the bar","Lower all the way"],
    mistakes:["Kipping or swinging","Half reps","Craning the neck to reach"],
    easier:["Band or feet-assisted","Negatives"], harder:["Pause at the top","Weighted"] },
  chin: { anim:"pullup",
    cues:["Palms facing you, shoulder-width grip","Start from a dead hang","Pull chest to the bar","Lower with control"],
    mistakes:["Swinging","Half reps","Shrugging at the top"],
    easier:["Band or feet-assisted","Negatives"], harder:["Pause at the top","Weighted"] },
  pulldown: { anim:"pulldown",
    cues:["Sit tall, thighs locked under the pad","Pull the bar to the upper chest","Elbows down and back","Let the arms straighten fully on the way up"],
    mistakes:["Leaning way back","Pulling behind the neck","Using momentum"],
    easier:["Lighter stack","Band pulldown"], harder:["Pause at the chest","Pull-ups"] },
  "band-pull": { anim:"bandpull",
    cues:["Arms straight out at chest height","Pull the band apart to your chest","Squeeze shoulder blades together","Return slowly"],
    mistakes:["Shrugging","Bending the elbows a lot","Arching the low back"],
    easier:["Lighter band","Wider grip"], harder:["Narrower grip","Pause 2 s at the chest"] },
  facepull: { anim:null,
    cues:["Rope at face height, thumbs back","Pull toward your forehead, elbows high","Rotate so hands finish beside the ears","Return slowly"],
    mistakes:["Pulling to the chest","Leaning back","Going too heavy"],
    easier:["Lighter weight","Band face pull"], harder:["Pause at the face","Half-kneeling"] },
  curl: { anim:"curl",
    cues:["Elbows pinned at your sides","Curl up without swinging","Squeeze at the top","Lower slowly all the way"],
    mistakes:["Swinging the body","Elbows drifting forward","Half reps"],
    easier:["Lighter dumbbells","Seated curl"], harder:["Slow 3 s lowering","Pause halfway"] },
  hammer: { anim:"curl",
    cues:["Palms facing each other","Elbows pinned at your sides","Curl up without swinging","Lower slowly"],
    mistakes:["Swinging","Elbows drifting forward","Rushing the lowering"],
    easier:["Lighter dumbbells","Alternate arms"], harder:["Slow 3 s lowering","Pause at the top"] },
  lunge: { anim:"bss",
    cues:["Back foot laces-down on the bench","Front foot far enough out that the knee stays over mid-foot","Lower straight down, slight forward lean","Drive up through the front heel"],
    mistakes:["Front heel lifting","Pushing off the back foot","Front knee caving in"],
    easier:["Split squat, back foot on the floor","Hold a support"], harder:["Hold dumbbells","3 s lowering"] },
  "walking-lunge": { anim:"revlunge",
    cues:["Long step forward, torso tall","Lower until both knees are about 90°","Front knee over mid-foot","Push through the front heel and step through"],
    mistakes:["Short steps (knee shoots past toes)","Back knee slamming down","Leaning forward"],
    easier:["Reverse lunge in place","Hold a support"], harder:["Hold dumbbells","Pause at the bottom"] },
  "reverse-lunge": { anim:"revlunge",
    cues:["Step back long, torso tall","Lower until both knees are about 90°","Front knee stays over mid-foot","Drive through the front heel to stand"],
    mistakes:["Short step back","Front knee caving in","Pushing off the back foot"],
    easier:["Hold a wall or chair","Smaller range"], harder:["Hold dumbbells","Deficit (front foot on a plate)"] },
  "step-up": { anim:"stepup",
    cues:["Whole foot on the box","Drive through the top heel","Stand fully tall, then step down slowly","Keep the knee in line with the toes"],
    mistakes:["Pushing off the bottom foot","Knee caving in","Box too high"],
    easier:["Lower box","Hold a support"], harder:["Higher box","Hold dumbbells"] },
  "wall-sit": { anim:"wallsit",
    cues:["Back flat on the wall","Slide down until thighs are about parallel","Knees over the ankles","Breathe steadily, hold"],
    mistakes:["Knees past the toes","Hands pushing on the thighs","Holding your breath"],
    easier:["Higher sit (less knee bend)","Shorter holds"], harder:["Longer holds","Hold a plate on the thighs"] },
  calf: { anim:"calf",
    cues:["Balls of the feet on the floor or a step","Rise up as high as you can","Pause 1 s at the top","Lower slowly all the way"],
    mistakes:["Bouncing","Half reps","Bending the knees to help"],
    easier:["Hold a wall","Both feet on the floor"], harder:["Single-leg","Off a step with a weight"] },
  plank: { anim:"plank",
    cues:["Elbows under the shoulders","Straight line ear to ankle","Squeeze glutes and brace","Breathe steadily"],
    mistakes:["Hips sagging","Hips piked high","Craning the neck up"],
    easier:["Knees down","Hands on a bench"], harder:["Longer holds","Shoulder taps"] },
  "dead-bug": { anim:"deadbug",
    cues:["Low back gently pressed into the floor","Arms up, knees over hips","Reach opposite arm and leg out slowly","Breathe out as you reach, then swap"],
    mistakes:["Low back lifting off the floor","Moving too fast","Holding your breath"],
    easier:["Move only the legs","Heel taps"], harder:["Hold a light weight","3 s reach"] },
  situp: { anim:"situp",
    cues:["Knees bent, feet flat","Arms across the chest","Curl up one vertebra at a time","Lower slowly"],
    mistakes:["Yanking the neck","Feet lifting","Dropping back down"],
    easier:["Crunch (shoulders only)","Feet anchored"], harder:["Hold a plate","Slow 3 s lowering"] },
  "knee-raise": { anim:"kneeraise",
    cues:["Dead hang, shoulders active","Lift knees to hip height or higher","Tilt the pelvis up at the top","Lower without swinging"],
    mistakes:["Swinging","Dropping the legs","Shrugging"],
    easier:["Captain's chair","Lying knee raise"], harder:["Straight-leg raise","Pause at the top"] },
  psoas: { anim:"psoas",
    cues:["Lie on your back, low back gently flat","Drive one knee toward the chest, other leg long","Slow and controlled, alternate legs","Optional: band around the feet"],
    mistakes:["Low back arching off the floor","Swinging the legs","Holding your breath"],
    easier:["Smaller range, no band","Single-leg holds"], harder:["Heavier band","Hanging psoas march"] },
  lmr: { anim:"lmr",
    cues:["Feet wide, both hands on the bar end, arms long","Arc the bar from one hip to the other","Pivot the back foot as you turn","Turn from the hips and ribs, not just the arms"],
    mistakes:["Bending the arms to muscle it","Feet glued so the low back twists","Going too fast"],
    easier:["Shorter arc (shoulder to shoulder)","Empty bar"], harder:["Add a small plate","Half-kneeling"] },
  abd: { anim:"abd",
    cues:["Lie on your side, bottom knee bent for balance","Top leg straight, toes forward","Lift the leg up and slightly back","Lower slowly"],
    mistakes:["Rolling the hips back","Toes turning up to the ceiling","Swinging"],
    easier:["Smaller range","Bent-knee clamshell"], harder:["Ankle weight or band","2 s pause at the top"] },
  farmer: { anim:"farmer",
    cues:["Pick up the weights with a flat back","Stand tall, shoulders down","Short, quick, steady steps","Set down with a hinge"],
    mistakes:["Leaning to one side","Shrugging","Rounding on the pick-up"],
    easier:["Lighter weights","Shorter distance"], harder:["Heavier","Single-arm (suitcase) carry"] },
};
/* Program-specific ids and name-matched aliases */
const HOWTO_ALIAS = {
  "em-squat":"squat","tp-squat":"squat","em-bench":"bench","tp-bench":"bench","em-row":"row","tp-row":"row",
  "em-rdl":"rdl","tp-rdl":"rdl","em-press":"ohp","tp-press":"ohp","tp-lunge":"reverse-lunge","split-squat":"lunge",
  "em-heaves":"heaves","tp-heaves":"heaves","em-plank":"plank","tp-plank":"plank",
  "em-deadbug":"dead-bug","tp-deadbug":"dead-bug","single-rdl":"slrdl",
};
const HOWTO_ANIM_OVERRIDE = { "em-rdl":"rdlplates","tp-rdl":"rdlplates","em-press":"ohpplates","tp-press":"ohpplates","em-row":"rowplates","tp-row":"rowplates" };
const HOWTO_LADDERS = {
  cossack: () => COSSACK_STAGES.map(s=>({name:s.name, note:s.note})),
  heave: () => HEAVE_STAGES.map(s=>({name:s.name, note:s.note})),
  bench: () => BENCH_STAGES.map(s=>({name:s.name, note:s.note})),
};
/* How-to sheet UI (lives outside #app so re-renders don't touch it) */
let htOpen = null; /* {ex, def, raf, t0} */
function howtoKey(ex){
  if (!ex) return null;
  if (ex.id === "lunge" && /walking/i.test(ex.name||"")) return "walking-lunge";
  if (HOWTO[ex.id]) return ex.id;
  return HOWTO_ALIAS[ex.id] || null;
}
function howtoAnimFor(ex, g){
  if (!g) return null;
  const li = ex.levelIndex ?? 0;
  if (ex.benchLadder && li === 0) return "benchplate";
  if (g.stageAnim && g.stageAnim[li]) return g.stageAnim[li];
  return HOWTO_ANIM_OVERRIDE[ex.id] || g.anim;
}
function htReduced(){ try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } }
function htList(items, cls){ return `<ul class="ht-list ${cls}">${items.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`; }
function openHowto(ei){
  const ex = state.exercises?.[ei];
  if (!ex) return;
  const key = howtoKey(ex), g = key ? HOWTO[key] : null;
  const animKey = howtoAnimFor(ex, g);
  const def = HT_ANIMS[animKey] || HT_ANIMS.stand;
  const custom = !!HT_ANIMS[animKey];
  const reduced = htReduced();
  const fig = (inner)=>`<svg class="ht-fig" viewBox="${htBox(def)}" role="img" aria-label="${esc(ex.name)} demo">${inner}</svg>`;
  let figHtml;
  if (reduced) {
    const P = def._p, end = P.length>1 ? 1 : 0;
    figHtml = `<div class="ht-static"><div>${fig(htSVG(P[0],P[0],0,def))}<span>Start</span></div><div>${fig(htSVG(P[end],P[end],0,def))}<span>${custom?"End":"Hold"}</span></div></div>`;
  } else figHtml = fig(htFrame(def, 0));
  const ladderKind = g?.ladder || (ex.benchLadder ? "bench" : ex.cossackLadder ? "cossack" : ex.heaveLadder ? "heave" : null);
  let ladder = "";
  if (ladderKind && HOWTO_LADDERS[ladderKind] && (ex.cossackLadder || ex.heaveLadder || ex.benchLadder)) {
    const li = ex.levelIndex ?? 0;
    ladder = `<h3 class="ht-h">Ladder</h3><ol class="ht-ladder">${HOWTO_LADDERS[ladderKind]().map((s,i)=>`<li class="${i===li?"on":i<li?"done":""}"><span class="ht-step">${i<li?"✓":i+1}</span><span><b>${esc(s.name)}</b>${i===li?` <em>Now</em>`:""}<br><small>${esc(s.note)}</small></span></li>`).join("")}</ol>`;
  } else if (ex.levels?.length) {
    const li = ex.levelIndex ?? 0;
    ladder = `<h3 class="ht-h">Levels</h3><ol class="ht-ladder">${ex.levels.map((n,i)=>`<li class="${i===li?"on":i<li?"done":""}"><span class="ht-step">${i<li?"✓":i+1}</span><span><b>${esc(n)}</b>${i===li?` <em>Now</em>`:""}</span></li>`).join("")}</ol>`;
  }
  const body = g ? `
      <h3 class="ht-h">Form cues</h3>${htList(g.cues,"cues")}
      <h3 class="ht-h">Common mistakes</h3>${htList(g.mistakes,"miss")}
      <div class="ht-two"><div><h3 class="ht-h">Easier</h3>${htList(g.easier,"vari")}</div><div><h3 class="ht-h">Harder</h3>${htList(g.harder,"vari")}</div></div>`
    : `<p class="note" style="margin-top:.75rem">No detailed guide for this lift yet.</p>`;
  const root = document.getElementById("howto");
  root.innerHTML = `<div class="ht-back" data-ht="close"></div>
    <section class="ht-sheet" role="dialog" aria-modal="true" aria-labelledby="ht-title">
      <div class="ht-grab" aria-hidden="true"></div>
      <div class="ht-head"><h2 id="ht-title">${esc(ex.name)}</h2><button type="button" class="icon-btn" data-ht="close" aria-label="Close guide">✕</button></div>
      ${ex.note?`<p class="note">${esc(ex.note)}</p>`:""}
      <div class="ht-anim">${figHtml}${custom?"":`<span class="ht-tag">General guide</span>`}</div>
      ${ladder}${body}
    </section>`;
  root.classList.add("on");
  document.body.style.overflow = "hidden";
  htOpen = { def, raf:0, t0:performance.now(), reduced, svg: root.querySelector(".ht-anim svg") };
  if (!reduced && custom) {
    const tick = (now) => { if (!htOpen) return; htOpen.svg.innerHTML = htFrame(htOpen.def, now - htOpen.t0); htOpen.raf = requestAnimationFrame(tick); };
    htOpen.raf = requestAnimationFrame(tick);
  }
  try { history.pushState({howto:1}, ""); htOpen.pushed = true; } catch {}
  root.querySelector(".ht-head .icon-btn")?.focus({preventScroll:true});
}
function closeHowto(fromPop){
  if (!htOpen) return;
  cancelAnimationFrame(htOpen.raf);
  const pushed = htOpen.pushed;
  htOpen = null;
  const root = document.getElementById("howto");
  root.classList.remove("on");
  root.innerHTML = "";
  document.body.style.overflow = "";
  if (pushed && !fromPop && history.state?.howto) { try { history.back(); } catch {} }
}
