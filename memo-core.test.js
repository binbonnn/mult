const C=require('./memo-core.js');
let fails=0,count=0;const kindsSeen={};
const cat={};function bad(m,r){fails++;cat[m.split(' ').slice(0,2).join(' ')+' '+(r?r.mode+':'+r.kind:'')]=(cat[m.split(' ').slice(0,2).join(' ')+' '+(r?r.mode+':'+r.kind:'')]||0)+1; if(fails<15)console.log('FAIL',m,r&&[r.mode,r.diff,r.kind,r.mods.join('+'),r.seed,r.index].join('|'));}
const modsets=['auto',[],['reverse'],['doubleRecall'],['distraction'],['falseFamiliarity'],['interference'],['reverse','distraction'],['falseFamiliarity','interference'],['doubleRecall','interference']];
for(const mode of C.MODES)for(const diff of C.DIFFS)for(const ms of modsets)for(let s=0;s<120;s++){
  const recent=[];
  for(let i=0;i<3;i++){
  let r;try{r=C.generateRound({mode,diff,seed:'t'+s,index:i,mods:ms,recent});}catch(e){bad('throw '+e.message+e.stack.split('\n')[1],{mode,diff,kind:'?',mods:[],seed:s,index:i});continue}
  count++;recent.push(r.kind);kindsSeen[mode+':'+r.kind]=(kindsSeen[mode+':'+r.kind]||0)+1;
  const rc=r.recall;
  if(!C.validate(r,C.solve(r)).correct)bad('solve not correct',r);
  if(rc.type==='choice'){
    const keys=rc.options.map(o=>o.key);
    if(new Set(keys).size!==keys.length)bad('dup option keys',r);
    if(rc.options.length<2||rc.options.length>8)bad('opt count '+rc.options.length,r);
    rc.options.forEach((o,k)=>{ if(k!==r.answer){ if(C.validate(r,k).correct)bad('wrong opt validates',r); if(!o.reason)bad('no reason '+r.kind,r);} });
    if(mode==='snapshot'&&rc.options.length!==4)bad('snap opts '+rc.options.length+' '+r.kind,r);
    if(mode==='mindtrap'&&rc.options.length<3)bad('mt opts '+rc.options.length,r);
  }
  if(rc.type==='seq'){
    const ids=new Set(rc.pool.map(p=>p.id));
    if(!r.answer.every(a=>ids.has(a)))bad('answer not in pool',r);
    if(r.answer.length!==rc.need)bad('need mismatch',r);
    if(C.validate(r,r.answer.slice().reverse()).correct && new Set(r.answer).size>1 && r.answer.join()===r.answer.slice().reverse().join()===false)bad('reverse also correct',r);
    if(rc.slots&&rc.slots.filter(x=>!x).length!==1)bad('slots',r);
  }
  if(rc.type==='cells'){
    if(!r.answer.length||r.answer.length!==rc.pick)bad('cells pick',r);
    if(r.answer.some(c=>c<0||c>=rc.cols*rc.rows))bad('cell range',r);
    if(mode==='glitch'){const {A,B}=r.scene;let d=0;for(let c=0;c<A.length;c++){const a=A[c],b=B[c];if((!a)!==(!b)||(a&&(a.shape!==b.shape||a.color!==b.color)))d++;} if(d!==r.answer.length||d<C.P.glitch.k[C.DIFF_INFO[diff].idx])bad('glitch diff '+d,r);}
  }
  if(r.observeMs<1500||r.recallMs<8000||!isFinite(r.recallMs))bad('timing',r);
  if(r.mods.length>2||!C.compatible(r.mods))bad('mods',r);
  if(Array.isArray(ms)&&ms.length===0&&r.mods.length)bad('mods should be empty',r);
  if(r.mods.includes('doubleRecall')&&(!r.mini||r.mini.options.indexOf(r.mini.options[r.mini.answer])<0||new Set(r.mini.options).size!==4))bad('mini',r);
  // determinism
  const r2=C.generateRound({mode,diff,seed:'t'+s,index:i,mods:ms,recent:recent.slice(0,-1)});
  if(JSON.stringify(r2)!==JSON.stringify(r))bad('nondeterministic',r);
  }
}
// rhythm validate tolerance
console.log('rounds',count,'fails',fails,JSON.stringify(cat));console.log(JSON.stringify(kindsSeen));
// score sanity
console.log(C.scoreRound({diff:'expert',prevCombo:12,correct:true,elapsedMs:0,recallMs:10000,hints:0,corrections:0}));
console.log(C.scoreRound({diff:'easy',prevCombo:0,correct:true,elapsedMs:5000,recallMs:10000,hints:1,corrections:1}));
