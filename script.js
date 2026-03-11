// ═══════════════════════════════════════════════
// DB
// ═══════════════════════════════════════════════
const DB={
  users:()=>JSON.parse(localStorage.getItem('ep_users')||'[]'),
  setUsers:u=>localStorage.setItem('ep_users',JSON.stringify(u)),
  session:()=>JSON.parse(localStorage.getItem('ep_session')||'null'),
  setSession:u=>localStorage.setItem('ep_session',JSON.stringify(u)),
  clearSession:()=>localStorage.removeItem('ep_session'),
  get:un=>JSON.parse(localStorage.getItem('ep_d_'+un)||'null')||newUD(),
  set:(un,d)=>localStorage.setItem('ep_d_'+un,JSON.stringify(d)),
};
function newUD(){
  return{staff:null,attendance:{},syllabuses:[],studyLog:[],postpones:{},lastCompletedAt:null,
    pomodoroSessions:0,gpa:{semesters:[]},notifications:{morning:'08:00',evening:'20:00',enabled:false}};
}
// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════
const uid=()=>Math.random().toString(36).slice(2,10);
const fmt=d=>(d instanceof Date?d:new Date(d)).toISOString().split('T')[0];
const today=()=>fmt(new Date());
const addDays=(ds,n)=>{const d=new Date(ds);d.setDate(d.getDate()+n);return fmt(d);};
const mk=()=>today().slice(0,7);
const td2=n=>String(n).padStart(2,'0');
const esc=s=>{const d=document.createElement('div');d.textContent=s||'';return d.innerHTML;};
const GRADE_PTS={O:10,'A+':9,A:8,'B+':7,B:6,C:5,F:0};
function calcCGPA(sems){let tc=0,tp=0;sems.forEach(s=>(s.courses||[]).forEach(c=>{tc+=+c.credits;tp+=(GRADE_PTS[c.grade]||0)*+c.credits;}));return tc?(tp/tc).toFixed(2):null;}
function semGPA(cs){const tc=cs.reduce((s,c)=>s+(+c.credits),0);const tp=cs.reduce((s,c)=>s+(GRADE_PTS[c.grade]||0)*+c.credits,0);return tc?(tp/tc).toFixed(2):'0';}

// Schedule gen
function genSchedule(sid,subject,units,start,end){
  const sched=[];
  const totalDays=Math.max(1,(new Date(end)-new Date(start))/86400000+1);
  const totalTopics=units.reduce((s,u)=>s+u.topics.length,0);
  const uExtras=units.length*2;
  const spacing=Math.max(1,Math.floor((totalDays-uExtras-1)/Math.max(1,totalTopics)));
  let cur=new Date(start+'T00:00:00');
  const push=it=>sched.push({id:uid(),syllabusId:sid,subject,...it});
  for(let ui=0;ui<units.length;ui++){
    const unit=units[ui];
    for(let ti=0;ti<unit.topics.length;ti++){
      push({date:fmt(cur),unitIndex:ui,unitName:unit.name,type:'study',topic:unit.topics[ti],status:'pending',score:null,studyDuration:0,isCatchup:false});
      for(let s=0;s<spacing;s++) cur.setDate(cur.getDate()+1);
    }
    cur.setDate(cur.getDate()+1);
    push({date:fmt(cur),unitIndex:ui,unitName:unit.name,type:'unit_test',topic:unit.name+' – Unit Test (100 Qs)',status:'pending',score:null,studyDuration:0,isCatchup:false});
    cur.setDate(cur.getDate()+1);
  }
  push({date:fmt(cur),unitIndex:-1,unitName:'All Units',type:'grand_test',topic:'Grand Final Test – All Units (100 Qs)',status:'pending',score:null,studyDuration:0,isCatchup:false});
  return sched;
}
function getTodayItems(syls){
  const td=today(),items=[];
  syls.forEach(s=>(s.schedule||[]).forEach(i=>{if(i.date===td)items.push({...i,syllabusSubject:s.subject,syllabusId:s.id});}));
  return items.sort((a,b)=>(a.isCatchup?1:0)-(b.isCatchup?1:0));
}
function getPostpones(ud){return(ud.postpones||{})[mk()]||0;}
function canPostpone(ud){return getPostpones(ud)<2;}
function doPostponeItem(syls,posts,sylId,itemId,newDate){
  const m=mk();
  const np={...posts,[m]:((posts||{})[m]||0)+1};
  const ns=syls.map(s=>{
    if(s.id!==sylId)return s;
    return{...s,schedule:s.schedule.map(i=>i.id!==itemId?i:{...i,status:'postponed',date:newDate,isCatchup:true,postponedOriginalDate:i.date})};
  });
  return{ns,np};
}
function patchItem(syls,sylId,itemId,patch){
  return syls.map(s=>s.id!==sylId?s:{...s,schedule:s.schedule.map(i=>i.id===itemId?{...i,...patch}:i)});
}

// AI questions
async function fetchQs(topic,count=10){
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:count>20?8000:1500,
        messages:[{role:'user',content:`Generate exactly ${count} multiple choice questions about "${topic}". Return ONLY a valid JSON array, no markdown:\n[{"q":"...","options":["A","B","C","D"],"answer":0}]\n"answer" is 0-based index of correct option. Vary difficulty.`}]})});
    const d=await r.json();
    const bt='`';const re=new RegExp(bt+bt+bt+'json|'+bt+bt+bt,'g');
    const t=(d.content||[]).map(b=>b.text||'').join('').replace(re,'').trim();
    return JSON.parse(t);
  }catch{
    return Array.from({length:count},(_,i)=>({q:`Sample Q${i+1} about "${topic}"?`,options:['Option A','Option B','Option C','Option D'],answer:i%4}));
  }
}

// ═══════════════════════════════════════════════
// APP STATE
// ═══════════════════════════════════════════════
let CU=null,UD=null,sbCol=false;
let activeItem=null,studyElapsed=0,studyRunning=false,studyIv=null,breakIv=null,breakLeft=0;
let testQs=[],testAns={},postAfter=null,postponeTarget=null;
// Pomodoro state
let pomTime=25*60,pomRunning=false,pomIv=null,pomDone=false;
// AI Test Zone state (standalone, not study flow)
let aiQs=null,aiAns={},aiSubmitted=false,aiBreakOn=false,aiBreakSec=600,aiBreakIv=null;
// GPA state
let gpaNewCourses=[],gpaNewCourse={name:'',grade:'',credits:''};

// ═══════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════
function authTab(t){
  ['l','s'].forEach(m=>{
    el('form-'+m).style.display=m===t?'block':'none';
    const b=el('tab-'+m);
    b.style.background=m===t?'linear-gradient(135deg,var(--c),var(--p))':'transparent';
    b.style.color=m===t?'#fff':'rgba(255,255,255,.45)';
  });
}
function doLogin(){
  const u=gv('l-u').trim(),p=gv('l-p');
  const e=el('a-err');e.style.display='none';el('a-ok').style.display='none';
  if(!u||!p){showE(e,'Please fill all fields');return;}
  const f=DB.users().find(x=>(x.username===u||x.email===u)&&x.password===p);
  if(!f){showE(e,'Invalid credentials');return;}
  el('a-ok').style.display='block';
  setTimeout(()=>{DB.setSession(f);initApp(f);},1200);
}
function doSignup(){
  const n=gv('s-n').trim(),u=gv('s-u').trim(),em=gv('s-e').trim(),p=gv('s-p');
  const e=el('s-err');e.style.display='none';
  if(!n||!u||!em||!p){showE(e,'All fields required');return;}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)){showE(e,'Enter a valid email');return;}
  if(p.length<4){showE(e,'Password min 4 chars');return;}
  if(DB.users().find(x=>x.username===u)){showE(e,'Username already taken');return;}
  if(DB.users().find(x=>x.email===em)){showE(e,'Email already registered');return;}
  const nu={username:u,password:p,name:n,email:em};
  DB.setUsers([...DB.users(),nu]);
  DB.set(nu.username,newUD());
  // Show success, clear form, switch to login
  el('s-n').value='';el('s-u').value='';el('s-e').value='';el('s-p').value='';
  const ok=el('s-ok');ok.style.display='block';
}
function doLogout(){
  DB.clearSession();CU=null;UD=null;activeItem=null;
  clearAllTimers();
  el('s-auth').classList.add('active');el('s-app').classList.remove('active');
}
function showE(domEl,msg){domEl.textContent=msg;domEl.style.display='block';}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
function initApp(user){
  CU=user;UD=DB.get(user.username);
  el('s-auth').classList.remove('active');el('s-app').classList.add('active');
  el('sb-nm').textContent=user.name;el('sb-un').textContent='@'+user.username;
  if(!UD.staff){openOv('m-staff');return;}
  go('home');
}
function saveStaff(){
  const n=gv('st-n').trim(),p=gv('st-ph').trim();
  if(!n||!p){alert('Both fields required');return;}
  UD.staff={name:n,number:p};save();closeOv('m-staff');go('home');
}
function save(){if(CU&&UD)DB.set(CU.username,UD);}

// ═══════════════════════════════════════════════
// NAV
// ═══════════════════════════════════════════════
const PAGES=['home','attendance','syllabus','studytest','pomodoro','aitest','gpa','notif','results','settings'];
function go(pg){
  PAGES.forEach(p=>{const e=el('pg-'+p);if(e)e.style.display=p===pg?'block':'none';});
  document.querySelectorAll('.nb').forEach(b=>b.classList.toggle('act',b.dataset.p===pg));
  el('sidebar').classList.remove('mob');
  if(pg==='home')renderHome();
  else if(pg==='attendance')renderAtt();
  else if(pg==='syllabus')renderSyl();
  else if(pg==='studytest')renderStudyTestPlaceholder();
  else if(pg==='pomodoro')renderPomodoro();
  else if(pg==='aitest')renderAITest();
  else if(pg==='gpa')renderGPA();
  else if(pg==='notif')renderNotif();
  else if(pg==='results')renderResults();
  else if(pg==='settings')renderSettings();
}
function toggleSB(){
  sbCol=!sbCol;
  el('sidebar').classList.toggle('col',sbCol);el('mc').classList.toggle('col',sbCol);
  document.querySelectorAll('.nl,.sb-title,.sb-uinfo').forEach(e=>e.style.display=sbCol?'none':'');
}

// ═══════════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════════
function renderHome(){
  const td=today(),att=UD.attendance||{},rec=att[td];
  const syls=UD.syllabuses||[];
  const todayItems=getTodayItems(syls);
  const allReg=todayItems.filter(i=>!i.isCatchup);
  const regDone=allReg.filter(i=>i.status==='completed').length;
  const allRegDone=allReg.length>0&&regDone===allReg.length;
  const lca=UD.lastCompletedAt||null;
  const tenPassed=lca?(Date.now()-lca)>=600000:false;
  const cuUnlocked=allRegDone&&tenPassed;
  let cuCd=0;if(allRegDone&&lca&&!tenPassed)cuCd=Math.max(0,600-Math.floor((Date.now()-lca)/1000));
  const allDays=Object.values(att);
  const pres=allDays.filter(d=>d.status==='present').length;
  const pct=allDays.length?Math.round(pres/allDays.length*100):0;
  const doneTopic=syls.reduce((s,sy)=>s+sy.schedule.filter(i=>i.status==='completed').length,0);
  const totalTopic=syls.reduce((s,sy)=>s+sy.schedule.filter(i=>i.type==='study').length,0);
  const activeTopic=syls.flatMap(sy=>sy.schedule).filter(i=>i.type==='study'&&i.status==='pending')[0];
  const cgpa=calcCGPA((UD.gpa||{}).semesters||[]);

  const typeC={study:'var(--c)',unit_test:'var(--p)',grand_test:'var(--a)'};
  const typeI={study:'📖',unit_test:'📝',grand_test:'🏆'};

  let attHTML=`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
    <div><p style="font-weight:600;margin:0 0 2px">📅 Today's Attendance</p><p style="color:rgba(255,255,255,.4);margin:0;font-size:13px">One mark per day</p></div>`;
  if(rec){
    const col=rec.status==='present'?'var(--g)':'var(--r)';
    const bg=rec.status==='present'?'rgba(16,185,129,.2)':'rgba(248,113,113,.2)';
    attHTML+=`<span style="padding:6px 16px;border-radius:20px;background:${bg};color:${col};font-weight:700;font-size:13px">${rec.status==='present'?'✅ Present':'❌ Absent'}</span>`;
    if(rec.status==='absent'&&rec.reason)attHTML+=`</div><p style="color:rgba(255,255,255,.4);font-size:12px;margin:8px 0 0">Reason: ${esc(rec.reason)}</p>`;
  } else {
    attHTML+=`<div style="display:flex;gap:8px">
      <button class="btn bgreen bsm" onclick="markAtt('present')">✅ Present</button>
      <button class="btn bred bsm" onclick="showAbsentPanel()">❌ Absent</button>
    </div>`;
  }
  attHTML+='</div>';
  if(!rec){
    attHTML+=`<div id="absent-panel" style="display:none;margin-top:14px;padding:14px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:10px">
      <select class="inp" id="abs-reason" style="margin-bottom:10px">
        <option value="">— Choose Reason —</option>
        <option>Sick / Medical Emergency</option>
        <option>Family Emergency</option>
        <option>Transport Issue</option>
        <option>Personal Work</option>
        <option>Exam / External Test</option>
        <option>Other</option>
      </select>
      <button class="btn bred bbl" onclick="confirmAbsent()">Confirm Absent</button>
    </div>`;
  }

  let schedHTML='';
  if(!todayItems.length){schedHTML='<p style="color:rgba(255,255,255,.35);text-align:center;padding:30px;margin:0">No items today 🎉</p>';}
  else{
    todayItems.forEach(item=>{
      const locked=item.isCatchup&&!cuUnlocked;
      const isDone=item.status==='completed';
      schedHTML+=`<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:10px;background:${isDone?'rgba(16,185,129,.05)':locked?'rgba(255,255,255,.02)':'rgba(255,255,255,.04)'};border:1px solid ${isDone?'rgba(16,185,129,.25)':locked?'rgba(255,255,255,.05)':'rgba(255,255,255,.08)'};margin-bottom:8px;opacity:${locked?.5:1}">
        <span style="font-size:18px;flex-shrink:0">${typeI[item.type]||'📖'}</span>
        <div style="flex:1;min-width:0">
          <p style="color:#fff;margin:0 0 2px;font-size:13px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(item.topic)}</p>
          <p style="color:rgba(255,255,255,.35);margin:0;font-size:11px">${esc(item.syllabusSubject||'')} · ${esc(item.unitName||'')} ${item.isCatchup?'· 🔄 Catch-up':''}</p>
        </div>`;
      if(isDone) schedHTML+=`<span style="color:var(--g);font-size:12px;font-weight:700;flex-shrink:0">✅${item.score!=null?' '+item.score+'%':''}</span>`;
      else if(locked){const cd=cuCd>0?td2(Math.floor(cuCd/60))+':'+td2(cuCd%60):'Wait';schedHTML+=`<span style="color:rgba(255,255,255,.3);font-size:12px;flex-shrink:0">🔒 ${cd}</span>`;}
      else{const enc=encodeURIComponent(JSON.stringify(item));schedHTML+=`<button class="btn bp bsm" onclick="startStudyFromDash('${enc}')">Start →</button>`;}
      schedHTML+='</div>';
    });
  }

  const cards=[
    {icon:'📅',label:'Attendance',val:pct+'%',sub:rec?'Today marked ✓':'⚠️ Not marked',col:'var(--g)',pg:'attendance'},
    {icon:'📚',label:'Syllabus',val:`${doneTopic}/${totalTopic}`,sub:activeTopic?activeTopic.topic.slice(0,28):'Setup syllabus',col:'var(--c)',pg:'syllabus'},
    {icon:'🎓',label:'CGPA',val:cgpa||'—',sub:'Click to update',col:'var(--a)',pg:'gpa'},
    {icon:'🔄',label:'Postpones Left',val:`${2-getPostpones(UD)}/2`,sub:'Resets monthly',col:'var(--p)',pg:'settings'},
  ];

  el('pg-home').innerHTML=`
    <div style="margin-bottom:24px">
      <h2 style="font-family:'Syne',sans-serif;font-size:24px;font-weight:800;margin:0 0 4px">Hey, ${esc(CU.name.split(' ')[0])}! 👋</h2>
      <p style="color:rgba(255,255,255,.4);font-size:14px;margin:0">${new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
    </div>
    <div class="g" style="padding:18px;margin-bottom:16px">${attHTML}</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:16px">
      ${cards.map(c=>`<div onclick="go('${c.pg}')" style="padding:20px;cursor:pointer;transition:all .2s;background:rgba(255,255,255,.05);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.08);border-radius:14px"
        onmouseover="this.style.borderColor='${c.col}80';this.style.background='rgba(255,255,255,.08)'" onmouseout="this.style.borderColor='rgba(255,255,255,.08)';this.style.background='rgba(255,255,255,.05)'">
        <div style="font-size:26px;margin-bottom:8px">${c.icon}</div>
        <div style="color:${c.col};font-size:24px;font-weight:800;font-family:'Syne',sans-serif">${c.val}</div>
        <div style="color:#fff;font-weight:600;font-size:14px;margin-bottom:2px">${c.label}</div>
        <div style="color:rgba(255,255,255,.38);font-size:12px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${c.sub}</div>
      </div>`).join('')}
    </div>
    ${!rec?`<div class="g" style="padding:18px;margin-bottom:16px;background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.4)">
      <p style="color:var(--a);font-weight:700;margin:0 0 4px">⚠️ Attendance not marked today!</p>
      <button class="btn bamber bsm" onclick="go('attendance')" style="margin-top:8px">Mark Attendance →</button>
    </div>`:''}
    <div class="g" style="padding:20px;margin-bottom:16px">
      <h3 style="font-size:16px;margin:0 0 16px">📋 Today's Schedule</h3>
      <div id="home-sched">${schedHTML}</div>
    </div>
    <div class="g" style="padding:20px">
      <h3 style="font-size:15px;margin:0 0 16px">⚡ Quick Actions</h3>
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        ${[{l:'📅 Attendance',p:'attendance',c:'var(--g)'},{l:'🍅 Pomodoro',p:'pomodoro',c:'var(--c)'},{l:'🧠 AI Quiz',p:'aitest',c:'var(--p)'},{l:'📚 Syllabus',p:'syllabus',c:'var(--a)'},{l:'🎓 GPA',p:'gpa',c:'var(--r)'}]
          .map(a=>`<button onclick="go('${a.p}')" style="padding:8px 16px;background:${a.c}15;border:1px solid ${a.c}40;border-radius:20px;color:${a.c};cursor:pointer;font-size:13px;font-weight:600;font-family:inherit">${a.l}</button>`).join('')}
      </div>
    </div>`;

  // restart catchup countdown display if needed
  if(cuCd>0){
    clearInterval(window._cuIv);
    window._cuIv=setInterval(()=>{
      const remaining=Math.max(0,600-Math.floor((Date.now()-(UD.lastCompletedAt||0))/1000));
      if(remaining===0){clearInterval(window._cuIv);renderHome();}
      else renderHome();
    },1000);
  }
}
function showAbsentPanel(){
  const p=el('absent-panel');if(p)p.style.display=p.style.display==='none'?'block':'none';
}
function confirmAbsent(){
  const r=gv('abs-reason');
  if(!r){alert('Please select a reason');return;}
  markAtt('absent',r);
}
function markAtt(status,reason=''){
  const td=today();if((UD.attendance||{})[td])return;
  UD.attendance=UD.attendance||{};UD.attendance[td]={status,reason,date:td};
  if(status==='absent'&&UD.staff){
    const msg=`Hello ${UD.staff.name}, I am unable to attend today's class (${td})${reason?' due to '+reason:''}. I sincerely apologize and will ensure all missed content is covered. Thank you for understanding.`;
    window.open('https://wa.me/'+UD.staff.number+'?text='+encodeURIComponent(msg),'_blank');
  }
  save();renderHome();
}
function startStudyFromDash(enc){
  try{activeItem=JSON.parse(decodeURIComponent(enc));go('studytest');startStudySession();}catch(e){console.error(e);}
}

// ═══════════════════════════════════════════════
// ATTENDANCE PAGE
// ═══════════════════════════════════════════════
function renderAtt(){
  const att=UD.attendance||{};
  const td=today();const rec=att[td];
  const allDays=Object.values(att);
  const pres=allDays.filter(d=>d.status==='present').length;
  const abs=allDays.length-pres;
  const pct=allDays.length?Math.round(pres/allDays.length*100):0;

  let markHTML='';
  if(rec){
    const col=rec.status==='present'?'var(--g)':'var(--r)';
    markHTML=`<div style="text-align:center;padding:28px 0">
      <div style="font-size:52px;margin-bottom:8px">${rec.status==='present'?'✅':'❌'}</div>
      <p style="color:${col};font-weight:700;font-size:20px;margin:0 0 6px">Marked ${rec.status.toUpperCase()}</p>
      ${rec.reason?`<p style="color:rgba(255,255,255,.45);font-size:13px">Reason: ${esc(rec.reason)}</p>`:''}
      ${rec.status==='absent'&&UD.staff?.number?`<button class="btn bsm" style="background:#25D366;color:#fff;margin-top:10px" onclick="sendWA()">💬 Send WhatsApp to Staff</button>`:''}
    </div>`;
  } else {
    markHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
      <button onclick="markAtt('present')" style="padding:16px;background:rgba(16,185,129,.15);border:2px solid var(--g);border-radius:12px;color:var(--g);font-weight:700;font-size:16px;cursor:pointer;font-family:inherit">✅ Present</button>
      <button onclick="toggleAbsPanel()" id="abs-toggle-btn" style="padding:16px;background:rgba(248,113,113,.1);border:2px solid var(--r);border-radius:12px;color:var(--r);font-weight:700;font-size:16px;cursor:pointer;font-family:inherit">❌ Absent</button>
    </div>
    <div id="att-abs-panel" style="display:none;padding:14px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:10px;animation:fadeIn .2s ease">
      <p style="color:rgba(255,255,255,.6);font-size:13px;margin:0 0 10px">Select a reason:</p>
      <select class="inp" id="att-reason" style="margin-bottom:10px;background:rgba(0,0,0,.4)">
        <option value="">— Choose Reason —</option>
        <option>Sick / Medical Emergency</option>
        <option>Family Emergency</option>
        <option>Transport Issue</option>
        <option>Personal Work</option>
        <option>Exam / External Test</option>
        <option>Other</option>
      </select>
      <button class="btn bred bbl" onclick="doMarkAbsent()">Confirm Absent</button>
    </div>`;
  }

  el('pg-attendance').innerHTML=`
    <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;margin:0 0 24px">📅 Daily Attendance</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
      ${[{l:'Present',v:pres,c:'var(--g)'},{l:'Absent',v:abs,c:'var(--r)'},{l:'Rate',v:pct+'%',c:pct>=75?'var(--g)':'var(--a)'}].map(s=>`<div class="g" style="padding:16px;text-align:center"><div style="color:${s.c};font-size:28px;font-weight:800">${s.v}</div><div style="color:rgba(255,255,255,.55);font-size:12px">${s.l}</div></div>`).join('')}
    </div>
    <div class="g" style="padding:18px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="color:rgba(255,255,255,.65);font-size:13px">Attendance Progress</span><span style="color:${pct>=75?'var(--g)':'var(--r)'};font-weight:700">${pct}%</span></div>
      <div class="pb"><div class="pbf" style="width:${pct}%"></div></div>
      ${pct<75&&allDays.length?'<p style="color:var(--a);font-size:12px;margin:8px 0 0">⚠️ Below 75% — attendance at risk!</p>':''}
    </div>
    <div class="g2" style="padding:24px;margin-bottom:20px">
      <p style="color:rgba(255,255,255,.55);font-size:13px;margin:0 0 16px">Today — <strong style="color:#fff">${td}</strong></p>
      ${markHTML}
    </div>
    <div class="tw">
      <table>
        <thead><tr><th>Date</th><th>Status</th><th>Reason</th></tr></thead>
        <tbody>${Object.entries(att).sort((a,b)=>b[0].localeCompare(a[0])).map(([d,r])=>`<tr>
          <td style="color:${d===td?'var(--c)':'rgba(255,255,255,.8)'};font-weight:${d===td?700:400}">${d}</td>
          <td><span class="badge ${r.status==='present'?'bd':''}" style="${r.status!=='present'?'background:rgba(248,113,113,.15);color:var(--r)':''}">${r.status==='present'?'✅ Present':'❌ Absent'}</span></td>
          <td style="color:rgba(255,255,255,.45);font-size:12px">${r.reason||'—'}</td>
        </tr>`).join('')||'<tr><td colspan="3" style="text-align:center;color:rgba(255,255,255,.3);padding:30px">No records yet</td></tr>'}</tbody>
      </table>
    </div>`;
}
function toggleAbsPanel(){
  const p=el('att-abs-panel');if(p)p.style.display=p.style.display==='none'?'block':'none';
  const b=el('abs-toggle-btn');if(b)b.style.background=p.style.display!=='none'?'rgba(248,113,113,.25)':'rgba(248,113,113,.1)';
}
function doMarkAbsent(){
  const r=gv('att-reason');if(!r){alert('Select a reason');return;}
  markAtt('absent',r);
}
function sendWA(){
  const td=today(),rec=(UD.attendance||{})[td];
  if(!UD.staff)return;
  const msg=`Hello ${UD.staff.name}, I am unable to attend today's class (${td})${rec?.reason?' due to '+rec.reason:''}. I sincerely apologize and will ensure all missed content is covered. Thank you for understanding.`;
  window.open('https://wa.me/'+UD.staff.number+'?text='+encodeURIComponent(msg),'_blank');
}

// ═══════════════════════════════════════════════
// SYLLABUS
// ═══════════════════════════════════════════════
let sylOpen=false,sylUnits=[{name:'Unit 1',topics:''}],viewSylId=null;
function renderSyl(){
  const syls=UD.syllabuses||[];
  let html=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:10px">
    <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;margin:0">📚 Syllabus Manager</h2>
    <button class="btn bp bsm" onclick="toggleAddSyl()">+ Add Syllabus</button>
  </div>`;

  if(sylOpen){
    html+=`<div class="g2" style="padding:24px;margin-bottom:20px;animation:fadeIn .2s ease" id="syl-form">
      <h3 style="color:#fff;margin:0 0 18px;font-size:16px">New Syllabus</h3>
      <div style="margin-bottom:12px"><input class="inp" id="syl-subj" placeholder="Subject Name"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div><label style="color:rgba(255,255,255,.5);font-size:12px;display:block;margin-bottom:5px">Start Date</label><input type="date" class="inp" id="syl-st" value="${today()}"></div>
        <div><label style="color:rgba(255,255,255,.5);font-size:12px;display:block;margin-bottom:5px">End Date</label><input type="date" class="inp" id="syl-en"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <label style="color:rgba(255,255,255,.5);font-size:12px">Units & Topics (one per line)</label>
        <button class="btn bcyan bsm" onclick="addSylUnit()">+ Unit</button>
      </div>
      <div id="syl-units">${buildSylUnits()}</div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn bg" onclick="toggleAddSyl()" style="flex:1">Cancel</button>
        <button class="btn bp" onclick="saveSyl()" style="flex:1">Generate Schedule</button>
      </div>
    </div>`;
  }

  if(!syls.length&&!sylOpen){
    html+='<div class="g" style="padding:60px;text-align:center;color:rgba(255,255,255,.3)">No syllabuses yet. Click "+ Add Syllabus".</div>';
  } else {
    const typeC={study:'var(--c)',unit_test:'var(--p)',grand_test:'var(--a)'};
    syls.forEach(syl=>{
      const done=syl.schedule.filter(i=>i.status==='completed').length;
      const pct=syl.schedule.length?Math.round(done/syl.schedule.length*100):0;
      const isV=viewSylId===syl.id;
      html+=`<div class="g" style="padding:20px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap;gap:10px">
          <div><h3 style="font-size:17px;margin:0 0 3px">${esc(syl.subject)}</h3>
          <p style="color:rgba(255,255,255,.35);margin:0;font-size:12px">${syl.startDate} → ${syl.endDate} · ${syl.units.length} units · ${syl.schedule.length} items</p></div>
          <div style="display:flex;gap:8px">
            <button class="btn bcyan bsm" onclick="toggleSylV('${syl.id}')">${isV?'Hide':'Schedule'}</button>
            <button class="btn bred bsm" onclick="delSyl('${syl.id}')">🗑</button>
          </div>
        </div>
        <div class="pb"><div class="pbf" style="width:${pct}%"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:rgba(255,255,255,.35);margin-top:4px"><span>${done}/${syl.schedule.length} done</span><span style="color:var(--c);font-weight:700">${pct}%</span></div>`;
      if(isV){
        html+=`<div style="animation:fadeIn .2s ease;margin-top:14px;overflow-x:auto"><table>
          <thead><tr><th>Date</th><th>Unit</th><th>Topic/Test</th><th>Type</th><th>Status</th><th>Score</th></tr></thead>
          <tbody>${syl.schedule.map(item=>{
            const isToday=item.date===today();
            const typeBadge=`<span class="badge" style="background:${typeC[item.type]}20;color:${typeC[item.type]}">${item.type==='study'?'Study':item.type==='unit_test'?'Unit Test':'Grand Test'}</span>`;
            const stBadge=item.status==='completed'?'<span class="badge bd">✅ Done</span>':item.status==='postponed'?'<span class="badge bpost">🔄 Rescheduled</span>':'<span class="badge bp2">⏳ Pending</span>';
            return`<tr><td style="color:${isToday?'var(--c)':'rgba(255,255,255,.65)'};font-weight:${isToday?700:400};white-space:nowrap">${item.date}</td>
              <td style="color:rgba(255,255,255,.55);white-space:nowrap">${esc(item.unitName)}</td>
              <td style="max-width:180px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600">${esc(item.topic)}</td>
              <td>${typeBadge}</td><td>${stBadge}</td>
              <td style="color:${item.score!=null?'var(--c)':'rgba(255,255,255,.25)'};font-weight:700">${item.score!=null?item.score+'%':'—'}</td></tr>`;
          }).join('')}</tbody></table></div>`;
      }
      html+='</div>';
    });
  }
  el('pg-syllabus').innerHTML=html;
}
function toggleAddSyl(){sylOpen=!sylOpen;sylUnits=[{name:'Unit 1',topics:''}];renderSyl();}
function buildSylUnits(){
  return sylUnits.map((u,i)=>`<div class="g" style="padding:14px;margin-bottom:10px">
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <input class="inp" style="flex:1" placeholder="Unit Name" value="${esc(u.name)}" oninput="sylUnits[${i}].name=this.value">
      ${sylUnits.length>1?`<button class="btn bred bsm" onclick="remSylUnit(${i})">✕</button>`:''}
    </div>
    <textarea class="inp" rows="4" placeholder="Topic 1&#10;Topic 2&#10;Topic 3" oninput="sylUnits[${i}].topics=this.value">${esc(u.topics)}</textarea>
  </div>`).join('');
}
function addSylUnit(){sylUnits.push({name:'Unit '+(sylUnits.length+1),topics:''});const c=el('syl-units');if(c)c.innerHTML=buildSylUnits();}
function remSylUnit(i){sylUnits.splice(i,1);const c=el('syl-units');if(c)c.innerHTML=buildSylUnits();}
function saveSyl(){
  const subj=gv('syl-subj').trim(),s=gv('syl-st'),e=gv('syl-en');
  if(!subj||!s||!e){alert('Subject and dates required');return;}
  if(s>e){alert('End must be after start');return;}
  const units=sylUnits.filter(u=>u.topics.trim()).map(u=>({name:u.name,topics:u.topics.split('\n').map(t=>t.trim()).filter(Boolean)}));
  if(!units.length){alert('Add at least one topic');return;}
  const id=uid();
  const syl={id,subject:subj,units,startDate:s,endDate:e,schedule:genSchedule(id,subj,units,s,e)};
  UD.syllabuses=[...(UD.syllabuses||[]),syl];save();sylOpen=false;renderSyl();
}
function toggleSylV(id){viewSylId=viewSylId===id?null:id;renderSyl();}
function delSyl(id){if(!confirm('Delete this syllabus?'))return;UD.syllabuses=(UD.syllabuses||[]).filter(s=>s.id!==id);save();renderSyl();}

// ═══════════════════════════════════════════════
// STUDY SESSION
// ═══════════════════════════════════════════════
function renderStudyTestPlaceholder(){
  if(!activeItem)el('pg-studytest').innerHTML='<div class="g" style="padding:60px;text-align:center"><p style="color:rgba(255,255,255,.4);font-size:15px;margin:0">Select an item from the Dashboard to start studying.</p></div>';
}
function startStudySession(){
  if(!activeItem)return;
  el('sov-type').textContent=(activeItem.type||'').replace('_',' ').toUpperCase()+' · '+activeItem.date;
  el('sov-type').style.color=activeItem.type==='study'?'var(--c)':activeItem.type==='unit_test'?'var(--p)':'var(--a)';
  el('sov-topic').textContent=activeItem.topic;
  el('sov-sub').textContent=(activeItem.syllabusSubject||'')+' · '+(activeItem.unitName||'');
  studyElapsed=0;studyRunning=false;
  clearInterval(studyIv);clearInterval(breakIv);
  el('sov-num').textContent='00:00';el('sov-sub2').textContent='Ready to study';
  el('sov-study-ph').style.display='block';el('sov-break-ph').style.display='none';el('sov-load-ph').style.display='none';
  el('sov-done').style.display='none';
  el('sov-ss').textContent='▶️ Start Studying';el('sov-ss').className='btn bp blg';
  openOv('sov');
}
function studyToggle(){
  studyRunning=!studyRunning;
  const ss=el('sov-ss');
  if(studyRunning){
    ss.textContent='⏸ Pause';ss.className='btn bamber blg';
    el('sov-sub2').textContent='Studying...';
    el('sov-num').style.filter='drop-shadow(0 0 15px var(--c))';
    studyIv=setInterval(()=>{
      studyElapsed++;
      el('sov-num').textContent=td2(Math.floor(studyElapsed/60))+':'+td2(studyElapsed%60);
      if(studyElapsed===1)el('sov-done').style.display='inline-flex';
    },1000);
  } else {
    ss.textContent='▶️ Resume';ss.className='btn bp blg';
    el('sov-sub2').textContent='Paused';el('sov-num').style.filter='none';
    clearInterval(studyIv);
  }
}
function studyDone(){
  studyRunning=false;clearInterval(studyIv);
  UD.studyLog=[...(UD.studyLog||[]),{scheduleId:activeItem.id,syllabusId:activeItem.syllabusId,date:today(),duration:studyElapsed}];save();
  el('sov-study-ph').style.display='none';el('sov-break-ph').style.display='block';
  breakLeft=300;updateBreakDisp();
  breakIv=setInterval(()=>{breakLeft--;updateBreakDisp();if(breakLeft<=0){clearInterval(breakIv);loadTestQs();}},1000);
}
function updateBreakDisp(){el('sov-brk').textContent=td2(Math.floor(breakLeft/60))+':'+td2(breakLeft%60);}
async function loadTestQs(){
  el('sov-break-ph').style.display='none';el('sov-load-ph').style.display='block';
  const item=activeItem;
  let topic=item.topic;
  const syl=(UD.syllabuses||[]).find(s=>s.id===item.syllabusId);
  if(item.type==='unit_test'&&syl){const u=syl.units[item.unitIndex];if(u)topic=u.name+': '+u.topics.join(', ');}
  else if(item.type==='grand_test'&&syl)topic=syl.subject+': '+syl.units.map(u=>u.name+' ('+u.topics.join(', ')+')').join('; ');
  testQs=await fetchQs(topic,item.type==='study'?10:100);testAns={};
  el('sov-load-ph').style.display='none';closeOv('sov');openTestOverlay();
}
function cancelStudy(){clearInterval(studyIv);clearInterval(breakIv);studyRunning=false;studyElapsed=0;closeOv('sov');activeItem=null;}
function openTestOverlay(){renderTestQs();el('tov').classList.add('open');document.body.style.overflow='hidden';}
function renderTestQs(){
  const qs=testQs,answered=Object.keys(testAns).length;
  el('tov-type').textContent=(activeItem.type||'').replace('_',' ').toUpperCase()+' TEST';
  el('tov-topic').textContent=activeItem.topic;
  el('tov-prog').textContent=answered+'/'+qs.length;
  el('tov-pb').style.width=(answered/qs.length*100)+'%';
  el('tov-sub').style.display=answered===qs.length?'block':'none';
  el('tov-qs').innerHTML=qs.map((q,i)=>`<div class="g" style="padding:18px;margin-bottom:12px;border-color:${testAns[i]!==undefined?'rgba(167,139,250,.4)':'rgba(255,255,255,.08)'}">
    <p style="color:#fff;font-weight:600;margin:0 0 12px;line-height:1.5;font-size:14px"><span style="color:var(--p);margin-right:6px">Q${i+1}.</span>${esc(q.q)}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${q.options.map((o,j)=>`<button onclick="selAns(${i},${j})" style="padding:9px 12px;background:${testAns[i]===j?'rgba(167,139,250,.3)':'rgba(255,255,255,.04)'};border:1px solid ${testAns[i]===j?'var(--p)':'rgba(255,255,255,.08)'};border-radius:9px;color:${testAns[i]===j?'var(--p)':'rgba(255,255,255,.65)'};cursor:pointer;text-align:left;font-size:13px;font-family:inherit;width:100%"><strong style="margin-right:4px">${String.fromCharCode(65+j)}.</strong>${esc(o)}</button>`).join('')}
    </div>
  </div>`).join('');
}
function selAns(qi,oi){
  testAns[qi]=oi;renderTestQs();
  const all=document.querySelectorAll('#tov-qs .g');
  const next=[...all].find((_,i)=>testAns[i]===undefined);
  if(next)setTimeout(()=>next.scrollIntoView({behavior:'smooth',block:'center'}),80);
}
function submitTest(){
  let correct=0;testQs.forEach((q,i)=>{if(testAns[i]===q.answer)correct++;});
  const sc=Math.round(correct/testQs.length*100);
  UD.syllabuses=patchItem(UD.syllabuses||[],activeItem.syllabusId,activeItem.id,{status:'completed',score:sc,studyDuration:studyElapsed});
  UD.lastCompletedAt=Date.now();save();
  el('tov').classList.remove('open');document.body.style.overflow='';
  const td=today();
  const catchupPending=getTodayItems(UD.syllabuses||[]).filter(i=>i.isCatchup&&i.status!=='completed');
  postAfter=catchupPending.length?catchupPending[0]:null;
  showResult(sc);
}
function showResult(sc){
  const total=testQs.length;
  const emoji=sc>=80?'🏆':sc>=60?'🎯':sc>=40?'📚':'💪';
  const grade=sc>=80?'Excellent!':sc>=60?'Good Job!':sc>=40?'Keep Studying!':'More Practice Needed';
  const gc=sc>=80?'var(--g)':sc>=60?'var(--c)':sc>=40?'var(--a)':'var(--r)';
  const mm=td2(Math.floor(studyElapsed/60)),ss=td2(studyElapsed%60);
  let html=`<div class="g2" style="padding:36px;text-align:center;background:linear-gradient(135deg,rgba(6,182,212,.12),rgba(167,139,250,.12));margin-bottom:14px">
    <div style="font-size:56px;margin-bottom:10px">${emoji}</div>
    <div style="font-size:52px;font-weight:800;font-family:'Syne',sans-serif;margin:0 0 6px">${sc}<span style="font-size:22px;color:rgba(255,255,255,.45)">%</span></div>
    <p style="color:${gc};font-size:17px;font-weight:700;margin:0 0 8px">${grade}</p>
    <p style="color:rgba(255,255,255,.4);font-size:13px;margin:0 0 24px">Study: ${mm}:${ss} · Questions: ${total}</p>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button class="btn bg" onclick="closeResult()">← Dashboard</button>
      <button class="btn bp" onclick="redoStudy()">🔄 Redo</button>
    </div>
    ${postAfter?`<div class="al al-i" style="margin-top:14px;text-align:left">📌 Catch-up test pending — unlocks in <strong>10 minutes</strong>.</div><div id="gap-cd" style="color:var(--a);font-weight:700;font-size:13px;margin-top:8px"></div>`:''}
  </div>
  <div style="font-weight:700;font-size:16px;margin-bottom:12px">Answer Review</div>
  ${testQs.map((q,i)=>`<div class="g" style="padding:12px;margin-bottom:8px;border-color:${testAns[i]===q.answer?'rgba(16,185,129,.3)':'rgba(248,113,113,.3)'}">
    <p style="font-weight:600;margin:0 0 5px;font-size:13px"><strong>Q${i+1}.</strong> ${esc(q.q)}</p>
    <p style="margin:0;font-size:12px"><span style="color:${testAns[i]===q.answer?'var(--g)':'var(--r)'}">${testAns[i]===q.answer?'✅ Correct':'❌ Wrong'}</span>
    ${testAns[i]!==q.answer?`<span style="color:rgba(255,255,255,.45);margin-left:8px">Correct: <strong style="color:var(--g)">${esc(q.options[q.answer])}</strong></span>`:''}</p>
  </div>`).join('')}`;
  el('rov-cnt').innerHTML=html;el('rov').classList.add('open');document.body.style.overflow='hidden';
  if(postAfter){
    clearInterval(window._gapIv);
    const tick=()=>{
      const rem=Math.max(0,600-Math.floor((Date.now()-(UD.lastCompletedAt||0))/1000));
      const cd=el('gap-cd');if(cd){cd.textContent=rem>0?`⏱ Catch-up in: ${td2(Math.floor(rem/60))}:${td2(rem%60)}`:'✅ Catch-up unlocked! Go to Dashboard.';}
      if(rem===0)clearInterval(window._gapIv);
    };tick();window._gapIv=setInterval(tick,1000);
  }
}
function closeResult(){clearInterval(window._gapIv);el('rov').classList.remove('open');document.body.style.overflow='';activeItem=null;postAfter=null;go('home');}
function redoStudy(){el('rov').classList.remove('open');document.body.style.overflow='';startStudySession();}

// Postpone
function openPostponeModal(enc){
  postponeTarget=JSON.parse(decodeURIComponent(enc));
  const used=getPostpones(UD);
  el('post-lbl').textContent='"'+postponeTarget.topic+'" — '+(postponeTarget.syllabusSubject||'');
  el('post-info').innerHTML=`<div class="al ${used>=2?'al-e':'al-w'}">Postpones used: ${used}/2</div>`;
  const body=el('post-body'),btn=el('post-btn');
  if(used>=2){body.style.display='none';btn.style.display='none';}
  else{body.style.display='block';btn.style.display='inline-flex';const mn=addDays(today(),1);el('post-dt').min=mn;el('post-dt').value=mn;}
  openOv('m-post');
}
function doPostpone(){
  if(!postponeTarget||!canPostpone(UD))return;
  const nd=gv('post-dt');if(!nd){alert('Select date');return;}
  const{ns,np}=doPostponeItem(UD.syllabuses||[],UD.postpones||{},postponeTarget.syllabusId,postponeTarget.id,nd);
  UD.syllabuses=ns;UD.postpones=np;save();closeOv('m-post');postponeTarget=null;go('home');
}

// ═══════════════════════════════════════════════
// POMODORO
// ═══════════════════════════════════════════════
const POM_TOTAL=25*60,POM_R=88,POM_CIRC=2*Math.PI*POM_R;
function renderPomodoro(){
  const sessions=UD.pomodoroSessions||0;
  const mm=td2(Math.floor(pomTime/60)),ss=td2(pomTime%60);
  const pct=(POM_TOTAL-pomTime)/POM_TOTAL*100;
  const ringOffset=POM_CIRC*(1-pct/100);
  const color=pomDone?'var(--g)':'var(--c)';

  el('pg-pomodoro').innerHTML=`
    <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;margin:0 0 28px">🍅 Pomodoro Timer</h2>
    <div style="display:flex;flex-direction:column;align-items:center;gap:28px">
      <div style="position:relative;width:210px;height:210px">
        <svg width="210" height="210" style="transform:rotate(-90deg)">
          <circle cx="105" cy="105" r="${POM_R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="10"/>
          <circle id="pom-ring" cx="105" cy="105" r="${POM_R}" fill="none" stroke="${color}" stroke-width="10"
            stroke-dasharray="${POM_CIRC}" stroke-dashoffset="${ringOffset}" stroke-linecap="round"
            style="transition:stroke-dashoffset 1s linear;filter:drop-shadow(0 0 10px ${color})"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <span id="pom-num" style="color:#fff;font-size:44px;font-weight:800;font-family:monospace;letter-spacing:2px">${mm}:${ss}</span>
          <span id="pom-lbl" style="color:rgba(255,255,255,.45);font-size:13px">${pomDone?'Complete! 🎉':pomRunning?'Focusing...':'Ready'}</span>
        </div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">
        ${!pomDone?`<button class="btn ${pomRunning?'bamber':'bp'} blg" onclick="pomToggle()" style="${pomRunning?'border:1px solid var(--a)':''}">
          ${pomRunning?'⏸ Pause':`▶️ ${pomTime<POM_TOTAL?'Resume':'Start'}`}
        </button>`:''}
        <button class="btn bg" onclick="pomReset()" style="border:1px solid rgba(255,255,255,.1)">↺ Reset</button>
      </div>
      ${pomDone?`<div class="g2" style="padding:24px;text-align:center;width:100%;max-width:400px;background:linear-gradient(135deg,rgba(16,185,129,.15),rgba(6,182,212,.15));border-color:rgba(16,185,129,.4)">
        <p style="font-size:14px;color:rgba(255,255,255,.6);margin:0 0 12px">Session #${sessions} complete!</p>
        <p style="color:var(--g);font-weight:700;font-size:16px;margin:0 0 16px">🎯 Ready to test your knowledge?</p>
        <button class="btn bp" style="font-size:15px;padding:12px 28px" onclick="go('aitest')">🧠 Start AI Quiz Now</button>
      </div>`:''}
      <div class="g" style="padding:20px;display:flex;gap:32px;justify-content:center;width:100%;max-width:360px">
        ${[{l:'Sessions',v:sessions},{l:'Focus Mins',v:sessions*25}].map(s=>`<div style="text-align:center"><div style="color:var(--c);font-size:30px;font-weight:800">${s.v}</div><div style="color:rgba(255,255,255,.45);font-size:13px">${s.l}</div></div>`).join('')}
      </div>
    </div>`;
}
function pomToggle(){
  pomRunning=!pomRunning;
  if(pomRunning){
    pomIv=setInterval(()=>{
      pomTime--;updatePomDisplay();
      if(pomTime<=0){clearInterval(pomIv);pomRunning=false;pomDone=true;UD.pomodoroSessions=(UD.pomodoroSessions||0)+1;save();renderPomodoro();}
    },1000);
  } else {clearInterval(pomIv);}
  renderPomodoro();
}
function pomReset(){clearInterval(pomIv);pomIv=null;pomTime=POM_TOTAL;pomRunning=false;pomDone=false;renderPomodoro();}
function updatePomDisplay(){
  const mm=td2(Math.floor(pomTime/60)),ss=td2(pomTime%60);
  const num=el('pom-num'),lbl=el('pom-lbl'),ring=el('pom-ring');
  if(num)num.textContent=mm+':'+ss;
  if(lbl)lbl.textContent='Focusing...';
  if(ring){
    const pct=(POM_TOTAL-pomTime)/POM_TOTAL*100;
    ring.style.strokeDashoffset=POM_CIRC*(1-pct/100);
  }
}

// ═══════════════════════════════════════════════
// AI TEST ZONE (standalone)
// ═══════════════════════════════════════════════
function renderAITest(){
  const syls=UD.syllabuses||[];
  const activeTopic=syls.flatMap(s=>s.schedule).find(i=>i.type==='study'&&i.status==='pending')?.topic||'General Academic Knowledge';
  let html=`<h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;margin:0 0 6px">🧠 AI Test Zone</h2>
    <p style="color:rgba(255,255,255,.45);margin-bottom:24px;font-size:14px">Topic: <span style="color:var(--c);font-weight:600">${esc(activeTopic)}</span></p>`;

  if(!aiQs&&!window._aiLoading){
    html+=`<div class="g" style="padding:52px;text-align:center">
      <div style="font-size:52px;margin-bottom:16px;filter:drop-shadow(0 0 12px var(--p))">🧠</div>
      <p style="color:rgba(255,255,255,.7);margin-bottom:8px;font-size:15px">Claude AI will generate 10 high-quality MCQs</p>
      <p style="color:rgba(255,255,255,.4);margin-bottom:24px;font-size:13px">Based on your active syllabus topic</p>
      <button class="btn bp blg" onclick="genAIQs()">✨ Generate Quiz</button>
    </div>`;
  } else if(window._aiLoading){
    html+=`<div class="g" style="padding:70px;text-align:center"><div class="spin"></div><p style="color:rgba(255,255,255,.55)">Claude AI is crafting your quiz...</p></div>`;
  } else if(aiQs&&!aiSubmitted){
    html+=`<div class="g" style="padding:16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-weight:700;font-size:15px">🧠 Quiz — ${esc(activeTopic)}</span>
      <span style="color:var(--c);font-weight:700">${Object.keys(aiAns).length}/${aiQs.length} answered</span>
    </div>`;
    html+=aiQs.map((q,i)=>`<div class="g" style="padding:18px;margin-bottom:12px;border-color:${aiAns[i]!==undefined?'rgba(167,139,250,.4)':'rgba(255,255,255,.08)'}">
      <p style="color:#fff;font-weight:600;margin:0 0 12px;line-height:1.5;font-size:14px"><span style="color:var(--p);margin-right:6px">Q${i+1}.</span>${esc(q.q)}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${q.options.map((o,j)=>`<button onclick="selAIAns(${i},${j})" style="padding:9px 12px;background:${aiAns[i]===j?'rgba(167,139,250,.3)':'rgba(255,255,255,.04)'};border:1px solid ${aiAns[i]===j?'var(--p)':'rgba(255,255,255,.08)'};border-radius:9px;color:${aiAns[i]===j?'var(--p)':'rgba(255,255,255,.65)'};cursor:pointer;text-align:left;font-size:13px;font-family:inherit;width:100%"><strong style="margin-right:4px">${String.fromCharCode(65+j)}.</strong>${esc(o)}</button>`).join('')}
      </div>
    </div>`).join('');
    html+=`<button class="btn ${Object.keys(aiAns).length<aiQs.length?'bg':'bp'} bbl blg" onclick="submitAITest()" style="margin-top:4px;opacity:${Object.keys(aiAns).length<aiQs.length?.5:1};cursor:${Object.keys(aiAns).length<aiQs.length?'not-allowed':'pointer'}" ${Object.keys(aiAns).length<aiQs.length?'disabled':''}>Submit (${Object.keys(aiAns).length}/${aiQs.length} answered)</button>`;
  } else if(aiSubmitted){
    let correct=0;aiQs.forEach((q,i)=>{if(aiAns[i]===q.answer)correct++;});
    const sc=Math.round(correct/aiQs.length*100);
    const emoji=sc>=80?'🏆':sc>=60?'🎯':sc>=40?'📚':'💪';
    const gc=sc>=80?'var(--g)':sc>=60?'var(--c)':sc>=40?'var(--a)':'var(--r)';
    const bm=td2(Math.floor(aiBreakSec/60)),bs=td2(aiBreakSec%60);
    html+=`<div class="g2" style="padding:32px;text-align:center;background:linear-gradient(135deg,rgba(6,182,212,.12),rgba(167,139,250,.12));margin-bottom:14px">
      <div style="font-size:60px;margin-bottom:8px">${emoji}</div>
      <div style="font-size:46px;font-weight:800;font-family:'Syne',sans-serif;margin:0 0 4px">${sc}<span style="font-size:22px;opacity:.5">%</span></div>
      <p style="color:${gc};font-size:18px;font-weight:700;margin:0 0 20px">${sc>=80?'Excellent!':sc>=60?'Good Work!':sc>=40?'Keep Studying!':'More Practice Needed'}</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn bp" onclick="resetAITest()">🔄 Retake Quiz</button>
        ${!aiBreakOn?`<button class="btn bamber" onclick="startAIBreak()">☕ 10-min Break</button>`:''}
      </div>
      ${aiBreakOn?('<div style="margin-top:20px;padding:14px 24px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.3);border-radius:12px">'+(aiBreakSec>0?'<p style="color:var(--a);font-weight:800;font-size:26px;margin:0;font-family:monospace">☕ '+bm+':'+bs+'</p>':'<p style="color:var(--g);font-weight:700;margin:0">Break over! Back to it! 💪</p>')+'</div>'):''}
    </div>`;
    html+=`<div style="font-weight:700;font-size:15px;margin-bottom:12px">Answer Review</div>`;
    html+=aiQs.map((q,i)=>`<div class="g" style="padding:12px;margin-bottom:8px;border-color:${aiAns[i]===q.answer?'rgba(16,185,129,.3)':'rgba(248,113,113,.3)'}">
      <p style="font-weight:600;margin:0 0 5px;font-size:13px"><strong>Q${i+1}.</strong> ${esc(q.q)}</p>
      <p style="margin:0;font-size:12px"><span style="color:${aiAns[i]===q.answer?'var(--g)':'var(--r)'}">${aiAns[i]===q.answer?'✅ Correct':'❌ Wrong'}</span>
      ${aiAns[i]!==q.answer?`<span style="color:rgba(255,255,255,.45);margin-left:8px">Correct: <strong style="color:var(--g)">${esc(q.options[q.answer])}</strong></span>`:''}</p>
    </div>`).join('');
  }
  el('pg-aitest').innerHTML=html;
}
async function genAIQs(){
  const syls=UD.syllabuses||[];
  const activeTopic=syls.flatMap(s=>s.schedule).find(i=>i.type==='study'&&i.status==='pending')?.topic||'General Academic Knowledge';
  window._aiLoading=true;aiQs=null;aiAns={};aiSubmitted=false;renderAITest();
  aiQs=await fetchQs(activeTopic,10);window._aiLoading=false;renderAITest();
}
function selAIAns(qi,oi){aiAns[qi]=oi;renderAITest();}
function submitAITest(){if(Object.keys(aiAns).length<aiQs.length)return;aiSubmitted=true;renderAITest();}
function resetAITest(){aiQs=null;aiAns={};aiSubmitted=false;aiBreakOn=false;aiBreakSec=600;clearInterval(aiBreakIv);renderAITest();}
function startAIBreak(){
  aiBreakOn=true;aiBreakSec=600;renderAITest();
  aiBreakIv=setInterval(()=>{aiBreakSec--;
    const bm=el('pg-aitest').querySelector('#ai-break-num');// just re-render
    renderAITest();if(aiBreakSec<=0)clearInterval(aiBreakIv);
  },1000);
}

// ═══════════════════════════════════════════════
// GPA
// ═══════════════════════════════════════════════
let gpaShowForm=false;
function renderGPA(){
  const sems=(UD.gpa||{}).semesters||[];
  const cgpa=calcCGPA(sems);
  let html=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:10px">
    <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;margin:0">🎓 GPA Predictor</h2>
    <button class="btn bp bsm" onclick="toggleGPAForm()">+ Add Semester</button>
  </div>
  <div class="g2" style="padding:28px;text-align:center;margin-bottom:20px;background:linear-gradient(135deg,rgba(6,182,212,.14),rgba(167,139,250,.14))">
    <p style="color:rgba(255,255,255,.5);margin:0 0 4px;font-size:13px">Cumulative GPA</p>
    <p style="color:#fff;font-size:56px;font-weight:800;margin:0 0 4px;font-family:'Syne',sans-serif">${cgpa||'—'}</p>
    <p style="color:${!cgpa?'rgba(255,255,255,.3)':+cgpa>=8.5?'var(--g)':+cgpa>=7?'var(--c)':+cgpa>=5?'var(--a)':'var(--r)'};margin:0;font-weight:600">
      ${!cgpa?'No data yet':+cgpa>=8.5?'🏆 Distinction':+cgpa>=7?'🎯 First Class':+cgpa>=5?'📚 Second Class':'⚠️ Needs Improvement'}
    </p>
  </div>`;

  sems.forEach((sem,i)=>{
    html+=`<div class="g" style="padding:18px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;margin-bottom:12px;align-items:center">
        <span style="font-weight:700">${esc(sem.name)}</span>
        <div style="display:flex;gap:10px;align-items:center">
          <span style="color:var(--c);font-weight:700">GPA: ${sem.gpa}</span>
          <button onclick="delSem(${i})" style="background:none;border:none;color:rgba(255,255,255,.3);cursor:pointer;font-size:16px">✕</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${(sem.courses||[]).map(c=>`<div style="display:flex;justify-content:space-between;color:rgba(255,255,255,.5);font-size:13px">
          <span>${esc(c.name)}</span>
          <span style="color:${GRADE_PTS[c.grade]>=9?'var(--g)':GRADE_PTS[c.grade]>=7?'var(--c)':GRADE_PTS[c.grade]>=5?'var(--a)':'var(--r)'}">${c.grade} (${c.credits} cr)</span>
        </div>`).join('')}
      </div>
    </div>`;
  });

  if(gpaShowForm){
    const preview=gpaNewCourses.length?`<div style="margin-bottom:14px;padding:12px;background:rgba(255,255,255,.04);border-radius:10px">
      ${gpaNewCourses.map(c=>`<div style="display:flex;justify-content:space-between;color:rgba(255,255,255,.65);font-size:13px;padding:3px 0"><span>${esc(c.name)}</span><span>${c.grade} — ${c.credits} cr</span></div>`).join('')}
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.05);display:flex;justify-content:space-between">
        <span style="color:rgba(255,255,255,.4);font-size:13px">Preview GPA:</span>
        <span style="color:var(--c);font-weight:700">${semGPA(gpaNewCourses)}</span>
      </div></div>`:'';
    html+=`<div class="g2" style="padding:24px">
      <h3 style="margin:0 0 16px;font-size:16px">New Semester</h3>
      <input class="inp" id="gpa-sem" placeholder="Semester Name (e.g. Sem 3 - 2024)" style="margin-bottom:14px" value="${esc(window._gpaSemName||'')}">
      ${preview}
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;margin-bottom:12px">
        <input class="inp" id="gpa-cn" placeholder="Course Name" style="padding:9px 12px" value="${esc(gpaNewCourse.name||'')}">
        <select class="inp" id="gpa-gr" style="padding:9px 10px">
          <option value="">Grade</option>
          ${Object.keys(GRADE_PTS).map(g=>`<option ${gpaNewCourse.grade===g?'selected':''}>${g}</option>`).join('')}
        </select>
        <input class="inp" id="gpa-cr" placeholder="Cr" type="number" min="1" max="6" style="padding:9px 10px" value="${gpaNewCourse.credits||''}">
        <button class="btn bcyan" style="padding:9px 14px;font-size:18px" onclick="addGPACourse()">+</button>
      </div>
      <button class="btn bp bbl" style="padding:12px" onclick="saveGPASem()">Save Semester</button>
    </div>`;
  }
  el('pg-gpa').innerHTML=html;
}
function toggleGPAForm(){gpaShowForm=!gpaShowForm;gpaNewCourses=[];gpaNewCourse={name:'',grade:'',credits:''};window._gpaSemName='';renderGPA();}
function addGPACourse(){
  const n=gv('gpa-cn').trim(),gr=gv('gpa-gr'),cr=gv('gpa-cr');
  if(!n||!gr||!cr){alert('Fill all course fields');return;}
  gpaNewCourse={name:n,grade:gr,credits:cr};
  gpaNewCourses.push({...gpaNewCourse});
  gpaNewCourse={name:'',grade:'',credits:''};
  window._gpaSemName=gv('gpa-sem');
  renderGPA();
}
function saveGPASem(){
  const nm=gv('gpa-sem').trim();
  if(!nm||!gpaNewCourses.length){alert('Enter semester name and add at least one course');return;}
  const sems=[...((UD.gpa||{}).semesters||[]),{name:nm,courses:gpaNewCourses,gpa:semGPA(gpaNewCourses)}];
  UD.gpa={semesters:sems};save();gpaShowForm=false;gpaNewCourses=[];window._gpaSemName='';renderGPA();
}
function delSem(i){const s=[...((UD.gpa||{}).semesters||[])];s.splice(i,1);UD.gpa={semesters:s};save();renderGPA();}

// ═══════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════
function renderNotif(){
  const n=UD.notifications||{morning:'08:00',evening:'20:00',enabled:false};
  el('pg-notif').innerHTML=`
    <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;margin:0 0 24px">🔔 Daily Notifications</h2>
    <div class="g2" style="padding:28px;margin-bottom:18px">
      <h3 style="margin:0 0 22px;font-size:16px">Reminder Schedule</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:22px">
        ${[{k:'morning',i:'☀️',l:'Morning Reminder'},{k:'evening',i:'🌙',l:'Evening Reminder'}].map(x=>`<div>
          <label style="color:rgba(255,255,255,.6);font-size:13px;display:block;margin-bottom:8px">${x.i} ${x.l}</label>
          <input type="time" class="inp" id="notif-${x.k}" value="${n[x.k]||''}" style="font-size:17px;padding:12px">
        </div>`).join('')}
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px">
        <div onclick="toggleNotifEnabled()" id="notif-tog" class="tog" style="background:${n.enabled?'var(--c)':'rgba(255,255,255,.15)'}">
          <div class="tog-dot" style="left:${n.enabled?25:3}px"></div>
        </div>
        <span style="color:rgba(255,255,255,.65);font-size:14px">${n.enabled?'Notifications enabled':'Notifications disabled'}</span>
      </div>
      <button class="btn bp bbl" id="notif-save-btn" style="padding:12px;font-size:15px" onclick="saveNotif()">Save Notification Settings</button>
    </div>
    <div class="g" style="padding:20px">
      <h4 style="margin:0 0 14px;font-size:14px">What you'll receive:</h4>
      ${[{t:n.morning||'08:00',i:'☀️',m:'Mark attendance & review your active syllabus topic'},{t:n.evening||'20:00',i:'🌙',m:'Complete a Pomodoro session & take the AI quiz'}].map((x,idx)=>`
        <div style="display:flex;gap:12px;padding:12px 0;${idx===0?'border-bottom:1px solid rgba(255,255,255,.05)':''}">
          <span style="font-size:22px">${x.i}</span>
          <div><p style="color:var(--c);font-weight:700;margin:0 0 2px;font-size:15px">${x.t}</p><p style="color:rgba(255,255,255,.45);margin:0;font-size:13px">${x.m}</p></div>
        </div>`).join('')}
    </div>`;
}
function toggleNotifEnabled(){
  const n=UD.notifications||{morning:'08:00',evening:'20:00',enabled:false};
  n.enabled=!n.enabled;UD.notifications=n;save();renderNotif();
}
async function saveNotif(){
  const n=UD.notifications||{};
  n.morning=gv('notif-morning')||'08:00';n.evening=gv('notif-evening')||'20:00';
  UD.notifications=n;save();
  const btn=el('notif-save-btn');btn.textContent='✅ Saved!';btn.style.background='rgba(16,185,129,.25)';btn.style.color='var(--g)';btn.style.border='1px solid var(--g)';
  setTimeout(()=>{btn.textContent='Save Notification Settings';btn.style.background='linear-gradient(135deg,var(--c),var(--p))';btn.style.color='#fff';btn.style.border='none';},2500);
  if(n.enabled){
    const perm=Notification.permission==='granted'?'granted':await Notification.requestPermission();
    if(perm==='granted'){
      const sched=(label,timeStr,body)=>{
        const[h,m]=timeStr.split(':').map(Number);const t=new Date();t.setHours(h,m,0,0);
        const diff=t-Date.now();if(diff>0)setTimeout(()=>new Notification('EduPulse — '+label,{body}),diff);
      };
      sched('Morning ☀️',n.morning,'Good morning! Mark your attendance & review today\'s topic.');
      sched('Evening 🌙',n.evening,'Evening check-in! Run a Pomodoro session and take the AI quiz.');
      new Notification('EduPulse ⚡',{body:'Reminders set for '+n.morning+' and '+n.evening});
    }
  }
}

// ═══════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════
function renderResults(){
  const syls=UD.syllabuses||[];
  if(!syls.length){el('pg-results').innerHTML='<h2 style="font-family:\'Syne\',sans-serif;font-size:22px;font-weight:700;margin:0 0 24px">📊 Results & Report</h2><div class="g" style="padding:60px;text-align:center;color:rgba(255,255,255,.35)">No results yet.</div>';return;}
  let html='<h2 style="font-family:\'Syne\',sans-serif;font-size:22px;font-weight:700;margin:0 0 24px">📊 Results & Report</h2>';
  syls.forEach(syl=>{
    const comp=syl.schedule.filter(i=>i.status==='completed'&&i.score!=null);
    const sItems=comp.filter(i=>i.type==='study');
    const uTests=comp.filter(i=>i.type==='unit_test');
    const gTests=comp.filter(i=>i.type==='grand_test');
    const avg=comp.length?Math.round(comp.reduce((s,i)=>s+i.score,0)/comp.length):null;
    const studyTime=(UD.studyLog||[]).filter(l=>l.syllabusId===syl.id).reduce((s,l)=>s+(l.duration||0),0);
    const pend=syl.schedule.filter(i=>i.status==='pending').length;
    const post=syl.schedule.filter(i=>i.status==='postponed').length;
    const unitHTML=syl.units.map((u,ui)=>{
      const ui2=sItems.filter(i=>i.unitIndex===ui);
      const ut=uTests.find(i=>i.unitIndex===ui);
      const ua=ui2.length?Math.round(ui2.reduce((s,i)=>s+i.score,0)/ui2.length):null;
      const chips=ui2.length?ui2.map(item=>{const c=item.score>=80?'var(--g)':item.score>=60?'var(--c)':'var(--a)';return`<div style="width:32px;height:32px;border-radius:6px;background:${c}25;border:1px solid ${c}50;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:${c}" title="${esc(item.topic)}">${item.score}</div>`;}).join(''):'<p style="color:rgba(255,255,255,.25);font-size:12px;margin:0">No data yet</p>';
      return`<div class="g" style="padding:14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
          <span style="font-weight:600;font-size:14px">${esc(u.name)}</span>
          <div style="display:flex;gap:12px">${ua!=null?('<span style="color:var(--c);font-size:12px">Avg: '+ua+'%</span>'):''}${ut?('<span style="color:var(--p);font-size:12px;font-weight:700">Unit Test: '+ut.score+'%</span>'):''}</div>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">${chips}</div>
      </div>`;
    }).join('');
    html+=`<div class="g2" style="padding:24px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px">
        <div><h3 style="font-family:'Syne',sans-serif;font-size:18px;margin:0 0 3px">${esc(syl.subject)}</h3>
          <p style="color:rgba(255,255,255,.35);margin:0;font-size:12px">${syl.startDate} → ${syl.endDate}</p></div>
        ${avg!=null?`<div style="text-align:right"><div style="color:${avg>=80?'var(--g)':avg>=60?'var(--c)':'var(--a)'};font-size:32px;font-weight:800;font-family:'Syne',sans-serif">${avg}%</div><div style="color:rgba(255,255,255,.4);font-size:11px">Average</div></div>`:''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
        ${[{l:'Study Sessions',v:sItems.length,c:'var(--c)'},{l:'Unit Tests',v:uTests.length+'/'+syl.units.length,c:'var(--p)'},{l:'Study Time',v:Math.floor(studyTime/3600)+'h '+Math.floor((studyTime%3600)/60)+'m',c:'var(--blue,#60a5fa)'},{l:'Pending',v:pend+post,c:pend+post>0?'var(--a)':'var(--g)'}]
          .map(s=>`<div style="text-align:center;padding:12px;background:rgba(255,255,255,.04);border-radius:10px"><div style="color:${s.c};font-size:18px;font-weight:800">${s.v}</div><div style="color:rgba(255,255,255,.4);font-size:10px">${s.l}</div></div>`).join('')}
      </div>
      ${unitHTML}
      ${gTests.length?`<div style="background:linear-gradient(135deg,rgba(245,158,11,.15),rgba(167,139,250,.15));border:1px solid rgba(245,158,11,.3);border-radius:12px;padding:20px;margin-top:12px;text-align:center">
        <p style="color:var(--a);font-weight:800;font-size:13px;margin:0 0 6px;letter-spacing:1px">🏆 GRAND FINAL TEST</p>
        <p style="font-size:38px;font-weight:800;font-family:'Syne',sans-serif;margin:0 0 4px">${gTests[0].score}%</p>
        <p style="color:rgba(255,255,255,.45);margin:0;font-size:13px">${gTests[0].score>=80?'Outstanding!':gTests[0].score>=60?'Great effort!':'Keep going!'}</p>
      </div>`:''}
      ${!comp.length?'<div style="color:rgba(255,255,255,.3);text-align:center;padding:24px">No tests taken yet.</div>':''}
    </div>`;
  });
  el('pg-results').innerHTML=html;
}

// ═══════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════
function renderSettings(){
  const staff=UD.staff||{name:'',number:''};
  const att=UD.attendance||{};
  const allDays=Object.values(att);
  const pres=allDays.filter(d=>d.status==='present').length;
  const pct=allDays.length?Math.round(pres/allDays.length*100):0;
  const used=getPostpones(UD);
  el('pg-settings').innerHTML=`
    <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;margin:0 0 24px">⚙️ Settings</h2>
    <div class="g2" style="padding:24px;margin-bottom:16px">
      <h3 style="font-size:16px;margin:0 0 18px">👨‍🏫 Staff Details</h3>
      <div style="margin-bottom:12px"><label style="color:rgba(255,255,255,.5);font-size:12px;display:block;margin-bottom:5px">Staff Name</label><input class="inp" id="set-sn" value="${esc(staff.name||'')}"></div>
      <div style="margin-bottom:16px"><label style="color:rgba(255,255,255,.5);font-size:12px;display:block;margin-bottom:5px">WhatsApp Number</label><input class="inp" id="set-sp" value="${staff.number||''}" oninput="this.value=this.value.replace(/\D/g,'')"></div>
      <button class="btn bp bbl" style="padding:12px" id="set-save" onclick="saveSettings()">Update Staff Details</button>
      <div id="set-ok" class="al al-ok" style="display:none;margin-top:10px">✅ Saved!</div>
    </div>
    <div class="g" style="padding:20px;margin-bottom:16px">
      <h3 style="font-size:15px;margin:0 0 16px">📅 Attendance Summary</h3>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px">
        ${[{l:'Present',v:pres,c:'var(--g)'},{l:'Absent',v:allDays.length-pres,c:'var(--r)'},{l:'Rate',v:pct+'%',c:pct>=75?'var(--g)':'var(--a)'}].map(s=>`<div style="text-align:center;padding:12px 8px;background:rgba(255,255,255,.04);border-radius:10px"><div style="color:${s.c};font-size:22px;font-weight:800">${s.v}</div><div style="color:rgba(255,255,255,.4);font-size:11px">${s.l}</div></div>`).join('')}
      </div>
      <div class="pb" style="background:rgba(255,255,255,.07)"><div class="pbf" style="width:${pct}%;background:linear-gradient(90deg,var(--c),var(--g))"></div></div>
      ${pct<75&&allDays.length?'<p style="color:var(--a);font-size:12px;margin:8px 0 0">⚠️ Below 75% — attendance at risk!</p>':''}
    </div>
    <div class="g" style="padding:20px">
      <h3 style="font-size:15px;margin:0 0 14px">🔄 Postpone Usage (This Month)</h3>
      <div style="display:flex;gap:10px">
        ${[0,1].map(i=>`<div style="flex:1;padding:14px;text-align:center;border-radius:10px;background:${i<used?'rgba(245,158,11,.2)':'rgba(255,255,255,.04)'};border:1px solid ${i<used?'rgba(245,158,11,.4)':'rgba(255,255,255,.06)'}">
          <div style="font-size:22px">${i<used?'🔄':'⭕'}</div>
          <div style="color:${i<used?'var(--a)':'rgba(255,255,255,.3)'};font-size:12px;margin-top:4px;font-weight:600">${i<used?'Used':'Available'}</div>
        </div>`).join('')}
      </div>
      <p style="color:rgba(255,255,255,.3);font-size:12px;margin:10px 0 0">Resets on the 1st of every month.</p>
    </div>`;
}
function saveSettings(){
  const n=gv('set-sn').trim(),p=gv('set-sp').trim();
  if(!n||!p){alert('Both required');return;}
  UD.staff={name:n,number:p};save();
  const ok=el('set-ok');ok.style.display='block';setTimeout(()=>ok.style.display='none',2000);
}

// ═══════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════
const el=id=>document.getElementById(id);
const gv=id=>(el(id)||{}).value||'';
function openOv(id){el(id).classList.add('open');document.body.style.overflow='hidden';}
function closeOv(id){el(id).classList.remove('open');document.body.style.overflow='';}
document.querySelectorAll('.ov').forEach(o=>{
  o.addEventListener('click',e=>{if(e.target===o&&o.id!=='m-staff')closeOv(o.id);});
});
function clearAllTimers(){
  clearInterval(studyIv);studyIv=null;clearInterval(breakIv);breakIv=null;
  clearInterval(pomIv);pomIv=null;clearInterval(aiBreakIv);aiBreakIv=null;
  clearInterval(window._cuIv);clearInterval(window._gapIv);
}

// ═══════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════
(()=>{const s=DB.session();if(s)initApp(s);})();