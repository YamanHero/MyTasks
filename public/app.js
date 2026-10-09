(()=>{
  "use strict";

  /* ======================= data ======================= */
  const TYPES={
    study:   {l:"دراسة",         p:15,i:"📚",c:"#3b6ff0",s:["قراءة 15 دقيقة","حل واجب الرياضيات","مراجعة كلمات جديدة"]},
    home:    {l:"مسؤولية منزلية",p:10,i:"🏠",c:"#e8710a",s:["ترتيب الغرفة","مساعدة في تحضير الطاولة","إخراج القمامة"]},
    creative:{l:"إبداع",         p:15,i:"🎨",c:"#9a4de0",s:["الرسم 15 دقيقة","بناء شيء من المكعبات","كتابة قصة قصيرة"]},
    movement:{l:"حركة",          p:10,i:"🏃",c:"#12a37a",s:["المشي 15 دقيقة","تمارين تمدد","اللعب في الخارج"]},
    social:  {l:"مهارة اجتماعية",p:10,i:"🤝",c:"#d6246e",s:["الاتصال بالجدة","مشاركة لعبة مع الأخ أو الأخت","قول شكراً لشخص ما"]},
    routine: {l:"روتين",         p:5, i:"⏰",c:"#0891b2",s:["تنظيف الأسنان","تحضير الحقيبة","تحضير ملابس الغد"]},
    breathing:{l:"تنفس وهدوء",   p:5, i:"🌬️",c:"#2fa4a0",s:["وردة وشمعة: 5 مرات","الأصابع الخمسة","زفير طويل مع إنزال الكتفين"]},
    youtube: {l:"قناتي",         p:15,i:"🎬",c:"#e0392b",s:["فكرة حلقة جديدة","تدريب صوت أو دبلجة","قائمة تصوير"]},
    prayer:  {l:"صلاة",          p:0, i:"🕌",c:"#2e7d6b",s:[]},
    other:   {l:"مهمة أخرى",     p:5, i:"⭐",c:"#7b6cf6",s:[]}
  };
  const PEOPLE={
    parent:{name:"الوالدان",icon:"🏠",color:"#4f46e5",sub:"نظرة واحدة على يوم العائلة كلها."},
    yaman:{name:"يَمان",icon:"🦸‍♂️",color:"#0891b2",sub:"خطوة واحدة واضحة في كل مرة."},
    judy:{name:"جودي",icon:"🦸‍♀️",color:"#d6246e",sub:"مهام قصيرة وواضحة."}
  };
  const KIDS=["yaman","judy"];
  const TIMERS=[0,5,10,15,20,30,45,60];
  const PRAYER_KEYS=[["fajr","الفجر"],["sunrise","الشروق"],["dhuhr","الظهر"],["asr","العصر"],["maghrib","المغرب"],["isha","العشاء"]];

  /* ======================= state ======================= */
  const qs=new URLSearchParams(location.search);
  let stored="";try{stored=localStorage.getItem("hero-area")||""}catch{}
  let area=(PEOPLE[qs.get("area")]||qs.get("area")==="home")?qs.get("area"):(PEOPLE[stored]?stored:"home");
  let pview="today";
  const pending=new Map();
  let family={},tick={},dashboard=null,child={yaman:null,judy:null},prayer=null;
  let loading=true,pin="",pinBusy=false,pinError="";
  let focusId={yaman:null,judy:null};
  let projects=[],chosenProjects=new Set(),importTasks=[],chosenTasks=new Set();
  let draft=newDraft();
  let help={task:null,member:"",mode:"full",question:"",loading:false,result:null,checked:new Set()};
  let breathTimer=null;
  function newDraft(o={}){return{step:1,who:"yaman",type:"study",points:15,title:"",note:"",time:"",timer:0,editId:null,...o}}

  /* ======================= helpers ======================= */
  const $=id=>document.getElementById(id);
  const iso=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
  const today=()=>iso(new Date());
  const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
  const typeOf=t=>TYPES[t]||TYPES.other;
  const isPrayer=t=>t.type==="prayer";
  const gain=t=>t.done?Number(t.earnedPoints??t.points??0):0;
  const pointsOf=list=>(list||[]).filter(t=>t.done&&!isPrayer(t)).reduce((a,t)=>a+gain(t),0);
  function dayLabel(d){const t=today();if(d===t)return "اليوم";const n=new Date();n.setDate(n.getDate()+1);if(d===iso(n))return "غداً";return new Date(d+"T12:00:00").toLocaleDateString("ar",{weekday:"short",day:"numeric",month:"short"})}
  function greeting(){const h=new Date().getHours();return h<12?"صباح الخير":h<18?"نهارك سعيد":"مساء الخير"}
  async function api(url,opts={}){
    const r=await fetch(url,{...opts,credentials:"include",cache:"no-store",headers:{"Content-Type":"application/json",...(opts.headers||{})}});
    const text=await r.text();let body=null;try{body=text?JSON.parse(text):null}catch{}
    if(!r.ok){const e=new Error(body?.error||"تعذر تنفيذ العملية. حاول مرة أخرى.");e.status=r.status;throw e}
    return body;
  }
  function toast(msg,kind="",action=null,ms=3200){
    const el=document.createElement("div");el.className="toast "+kind;
    const s=document.createElement("span");s.textContent=msg;el.appendChild(s);
    if(action){const b=document.createElement("button");b.type="button";b.textContent=action.label;b.onclick=()=>{el.remove();action.fn()};el.appendChild(b)}
    $("toasts").appendChild(el);setTimeout(()=>el.remove(),ms);return el;
  }
  function onErr(err){
    if(err.status===401){toast("انتهت الجلسة. أدخل الرمز من جديد.","err");pin="";pinError="";return refresh().catch(()=>{})}
    toast(err.message,"err");
  }
  const allTasks=()=>[...(child.yaman?.tasks||[]),...(child.judy?.tasks||[])];
  const findTask=id=>allTasks().find(t=>t.id===id);
  const stats=m=>{const l=(child[m]?.tasks||[]).filter(t=>!isPrayer(t));const done=l.filter(t=>t.done).length;return{total:l.length,done,open:l.length-done}};
  function buzz(ms=25){try{navigator.vibrate&&navigator.vibrate(ms)}catch{}}
  /* ---- completion sound (soft two-note chime, no audio files) ---- */
  let soundOn=true;try{soundOn=localStorage.getItem("hero-sound")!=="off"}catch{}
  let actx=null;
  function tone(freq,at,len,vol){
    const o=actx.createOscillator(),g=actx.createGain(),t=actx.currentTime+at;
    o.type="sine";o.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,t);g.gain.linearRampToValueAtTime(vol,t+0.012);g.gain.exponentialRampToValueAtTime(0.0001,t+len);
    o.connect(g);g.connect(actx.destination);o.start(t);o.stop(t+len+0.05);
  }
  function playDone(kind="task"){
    if(!soundOn)return;
    try{
      actx=actx||new (window.AudioContext||window.webkitAudioContext)();
      if(actx.state==="suspended")actx.resume();
      if(kind==="soft"){tone(784,0,.45,.12);return}
      if(kind==="all"){[523.25,659.25,783.99,1046.5].forEach((f,i)=>tone(f,i*.11,.5,.16));return}
      tone(659.25,0,.32,.2);tone(987.77,.09,.42,.2);
    }catch{}
  }
  function confetti(x,y,n=30){
    if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const cols=["#f5b301","#12a37a","#d6246e","#3b6ff0","#9a4de0","#e8710a"];
    for(let i=0;i<n;i++){
      const p=document.createElement("i");p.className="confetti";p.style.background=cols[i%cols.length];p.style.left=x+"px";p.style.top=y+"px";
      document.body.appendChild(p);
      const a=Math.random()*Math.PI*2,d=90+Math.random()*190;
      p.animate([{transform:"translate(0,0) rotate(0)",opacity:1},{transform:`translate(${Math.cos(a)*d}px,${Math.sin(a)*d+160}px) rotate(${Math.random()*720}deg)`,opacity:0}],{duration:1000+Math.random()*700,easing:"cubic-bezier(.2,.7,.4,1)"}).onfinish=()=>p.remove();
    }
  }
  async function guard(btn,fn){
    if(btn){if(btn.classList.contains("busy"))return;btn.classList.add("busy")}
    try{return await fn()}catch(err){onErr(err)}finally{btn?.classList.remove("busy")}
  }
  const listOrDetails=(items,n,render,label)=>items.length<=n?items.map(render).join(""):items.slice(0,n).map(render).join("")+`<details class="fold"><summary>${label} (${items.length-n})</summary><div class="list">${items.slice(n).map(render).join("")}</div></details>`;

  /* ======================= data loading ======================= */
  async function load(){
    const [f,t]=await Promise.all([api("/api/family/status").catch(()=>({})),api("/api/ticktick/status").catch(()=>({configured:false,connected:false}))]);
    family=f;tick=t;dashboard=null;child={yaman:null,judy:null};
    const jobs=[];
    if(f.parentAuthenticated)jobs.push(api(`/api/family/dashboard?date=${today()}`).then(d=>dashboard=d).catch(()=>null));
    for(const m of KIDS)if(f.parentAuthenticated||f[`${m}Authenticated`])jobs.push(api(`/api/family/child/${m}?date=${today()}`).then(d=>child[m]=d).catch(()=>null));
    await Promise.all(jobs);
    for(const id of pending.keys()){const t=findTask(id);if(t)t.done=true}
  }
  async function refresh(){await load();loading=false;render()}

  /* ======================= components ======================= */
  function ring(done,total){
    const C=2*Math.PI*45,pct=total?done/total:0;
    return `<div class="ring" role="img" aria-label="أنجزت ${done} من ${total}"><svg viewBox="0 0 104 104"><circle class="bg" cx="52" cy="52" r="45"/><circle class="fg" cx="52" cy="52" r="45" stroke-dasharray="${C}" stroke-dashoffset="${C*(1-pct)}"/></svg><div class="ring-num"><div>${done}/${total}<small>مهام</small></div></div></div>`;
  }
  function hero(title,sub,icon,withDate=true){
    const d=new Date();
    return `<header class="hero"><div class="avatar" aria-hidden="true">${icon}</div><div class="hero-text"><h1>${title}</h1><p>${sub}</p></div>${withDate?`<div class="hero-date" aria-label="تاريخ اليوم">${d.toLocaleDateString("ar",{weekday:"long"})}<b>${d.toLocaleDateString("ar",{day:"numeric"})}</b>${d.toLocaleDateString("ar",{month:"long"})}</div>`:""}</header>`;
  }
  function keypad(){
    return `<div class="pad" role="group" aria-label="لوحة الأرقام">${[1,2,3,4,5,6,7,8,9].map(n=>`<button type="button" class="key" data-key="${n}">${n}</button>`).join("")}<button type="button" class="key key-fn" data-key="back" aria-label="مسح رقم">⌫</button><button type="button" class="key" data-key="0">0</button><button type="button" class="key key-go ${pinBusy?"busy":""}" data-key="go" aria-label="دخول">✓</button></div>`;
  }
  function loginCard(who){
    const p=PEOPLE[who];
    if(who==="parent"&&family.parentPinConfigured===false)return `<article class="card login"><div class="avatar" aria-hidden="true">${p.icon}</div><h2>رمز الوالدين غير مهيأ</h2><p class="muted">أضف المتغير PARENT_PIN في Railway ثم أعد تحميل الصفحة.</p></article>`;
    if(who!=="parent"&&!family[`${who}PinConfigured`])return `<article class="card login"><div class="avatar" aria-hidden="true">${p.icon}</div><h2>رمز الدخول غير مهيأ</h2><p class="muted">أضف ${who.toUpperCase()}_PIN في Railway أولاً.</p></article>`;
    const n=Math.max(4,pin.length);
    return `<article class="card login"><div class="avatar" aria-hidden="true">${p.icon}</div><h2>${who==="parent"?"منطقة الوالدين":`أهلاً ${p.name}!`}</h2><p class="muted">${who==="parent"?"اكتب رمز الوالدين لإدارة مهام العائلة.":"اكتب رمزك السري لتفتح مهامك."}</p><div class="dots" id="dots" aria-label="عدد الأرقام: ${pin.length}">${Array.from({length:n},(_,i)=>`<i class="${i<pin.length?"f":""}"></i>`).join("")}</div><p class="err" id="pinErr" role="alert">${esc(pinError)}</p>${keypad()}</article>`;
  }
  function skeleton(){return `<div class="stack"><div class="skel" style="height:110px"></div><div class="skel"></div><div class="skel" style="height:80px"></div></div>`}
  function topbar(){
    const parentIn=family.parentAuthenticated;
    const lockable=area==="parent"?parentIn:(area!=="home"&&!parentIn&&family[`${area}Authenticated`]);
    const back=(area!=="parent"&&parentIn&&area!=="home")?`<button class="pill" data-area="parent">→ لوحة الوالدين</button>`:`<button class="pill" data-area="home">👥 من أنا؟</button>`;
    return `<div class="topbar">${back}<button class="pill pill-sm" data-action="sound" aria-label="${soundOn?"كتم الصوت":"تشغيل الصوت"}" aria-pressed="${soundOn}">${soundOn?"🔔":"🔕"}</button>${lockable?`<button class="pill" data-action="lock">🔒 قفل</button>`:""}</div>`;
  }
  const timeChip=t=>t.suggestedTime?`<span class="tchip">⏰ ${esc(t.suggestedTime)}</span>`:"";
  const timerChip=t=>t.timerMinutes?`<span class="tchip timer">⏱ ${t.timerMinutes} د</span>`:"";

  /* ---- home ---- */
  function homeView(){
    const tile=m=>{
      const p=PEOPLE[m],ok=family.parentAuthenticated||family[`${m}Authenticated`],s=stats(m);
      const st=!ok?"🔒 اضغط لتفتح مهامك":!s.total?"لا توجد مهام اليوم":s.open?`${s.open} ${s.open===1?"مهمة":"مهام"} بانتظارك`:"أنجزت كل شيء 🎉";
      return `<button class="tile" style="--kc:${p.color}" data-area="${m}"><span class="av" aria-hidden="true">${p.icon}</span><span><h2>${p.name}</h2><span class="st">${st}</span></span><span class="go" aria-hidden="true">←</span></button>`;
    };
    const pOpen=family.parentAuthenticated&&dashboard?stats("yaman").open+stats("judy").open:null;
    return `${hero("أهلاً بكم في Hero","من يستخدم التطبيق الآن؟","🦸")}
    <div class="tiles" style="margin-top:16px">${KIDS.map(tile).join("")}
      <button class="tile parent" style="--kc:${PEOPLE.parent.color}" data-area="parent"><span class="av" aria-hidden="true">🏠</span><span><h2>الوالدان</h2><span class="st">${family.parentAuthenticated?(pOpen===null?"إدارة العائلة":`${pOpen} مهام مفتوحة اليوم`):"🔒 إدارة مهام العائلة"}</span></span><span class="go" aria-hidden="true">←</span></button>
    </div>`;
  }

  /* ---- settings (prayer + ticktick) ---- */
  function prayerCard(){
    const pt=prayer?.prayerTimes||{};
    const has=PRAYER_KEYS.some(([k])=>pt[k]);
    return `<article class="card"><div class="card-title"><h2>🕌 مواقيت الصلاة</h2></div>${prayer===null?`<p class="muted"><span class="spin"></span>جاري تحميل المواقيت…</p>`:`${has?`<div class="stat3" style="grid-template-columns:repeat(3,1fr)">${PRAYER_KEYS.map(([k,l])=>`<div><b style="font-size:1.1rem">${esc(pt[k]||"—")}</b><span>${l}</span></div>`).join("")}</div>`:""}${prayer.warning?`<p class="soft-note" style="margin-top:12px">${esc(prayer.warning)}</p>`:""}<button class="btn btn-soft btn-big" style="margin-top:14px;min-height:54px;font-size:1rem" data-action="prayer-edit">✏️ إدخال المواقيت يدوياً</button>`}</article>`;
  }
  function tickView(){
    const status=!tick.configured?`<div class="tt"><span class="dot"></span><div><b>TickTick غير مهيأ</b><div class="muted">التطبيق يعمل بشكل طبيعي. أكمل متغيرات TickTick في Railway لتفعيل المزامنة.</div></div></div>`
      :!tick.connected?`<div class="tt"><span class="dot"></span><div style="flex:1"><b>TickTick غير متصل</b><div class="muted">اربطه لاستيراد مهام اليوم وإرسال مهام Hero إليه.</div></div></div><a class="btn btn-primary btn-big" style="margin-top:14px" href="/auth/ticktick">ربط TickTick</a>`
      :`<div class="tt"><span class="dot on"></span><div style="flex:1"><b>TickTick متصل</b><div class="muted">مهمة جديدة هنا تصل إلى TickTick، وإنجازها هنا يُكمّلها هناك.</div></div></div>`;
    const steps=tick.connected?`<ol class="howto" style="margin-top:16px"><li><b>اختر القوائم</b><div class="muted">حدد القوائم التي تريد الاستيراد منها.</div><button class="btn btn-line btn-sm" style="margin-top:8px" data-action="projects">📋 اختيار القوائم</button></li><li><b>استورد مهام اليوم</b><div class="muted">اختر المهام وحدد لمن تُضاف.</div><button class="btn btn-soft btn-sm" style="margin-top:8px" data-action="import">⬇️ استيراد مهام اليوم</button></li></ol>`:"";
    return `<article class="card"><div class="card-title"><h2>🔗 TickTick</h2></div>${status}${steps}</article>`;
  }

  /* ---- parent ---- */
  function parentTaskRow(t,m){
    const ty=typeOf(t.type);
    const meta=`${timeChip(t)}${timerChip(t)}<span>${ty.l}</span>${isPrayer(t)?"":`<span>⭐ ${t.points}</span>`}${t.status==="in_progress"?"<span>▶ بدأ</span>":""}${t.ticktickTaskId?"<span>TickTick</span>":""}${t.note?`<span>${esc(t.note)}</span>`:""}`;
    return `<div class="task ${t.done?"done":""}" style="--tc:${ty.c}"><button class="t-main" data-action="edit-task" data-id="${t.id}" aria-label="تعديل: ${esc(t.title)}"><span class="t-ico" aria-hidden="true">${ty.i}</span><span class="t-body"><span class="t-title">${esc(t.title)}</span><span class="t-meta">${meta}</span></span></button><div class="t-act">${t.done?`<span class="check on" aria-label="منجزة">✓</span>`:`<button class="check" data-action="complete" data-member="${m}" data-id="${t.id}" aria-label="تأكيد إنجاز: ${esc(t.title)}">✓</button>`}</div></div>`;
  }
  function kidCard(m){
    const s=stats(m),tasks=child[m]?.tasks||[],pts=pointsOf(tasks),p=PEOPLE[m];
    const pct=s.total?Math.round(s.done/s.total*100):0;
    const prayers=tasks.filter(isPrayer),rest=tasks.filter(t=>!isPrayer(t));
    const open=rest.filter(t=>!t.done),done=rest.filter(t=>t.done);
    const body=rest.length||prayers.length?
      (open.length?listOrDetails(open,4,t=>parentTaskRow(t,m),"باقي المهام"):(rest.length?`<div class="empty"><b>🏆</b>أنجز ${p.name} كل المهام</div>`:""))
      +(done.length?`<details class="fold"><summary>المنجزة (${done.length})</summary><div class="list">${done.map(t=>parentTaskRow(t,m)).join("")}</div></details>`:"")
      +(prayers.length?`<details class="fold"><summary>🕌 الصلوات (${prayers.filter(t=>t.done).length}/${prayers.length})</summary><div class="list">${prayers.map(t=>parentTaskRow(t,m)).join("")}</div></details>`:"")
      :`<div class="empty"><b>🌱</b>لا توجد مهام لـ${p.name} اليوم<div style="margin-top:10px"><button class="btn btn-soft btn-sm" data-action="seed" data-who="${m}">✨ جهّز يوماً هادئاً تلقائياً</button></div></div>`;
    return `<article class="card kid-card" data-kid="${m}"><div class="kid-head"><div class="av" aria-hidden="true">${p.icon}</div><div style="flex:1"><h3>${p.name}</h3><div class="muted">${s.total?`${s.done} من ${s.total} منجزة`:"لا توجد مهام اليوم"}</div></div><span class="chip gold">⭐ ${pts}</span><button class="pill pill-sm" data-area="${m}" aria-label="فتح شاشة ${p.name}">فتح ←</button></div><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="--w:${pct}%"></i></div><div class="list">${body}</div><div class="actions"><button class="btn btn-soft btn-sm" data-action="add-task" data-who="${m}">＋ مهمة لـ${p.name}</button><button class="btn btn-line btn-sm" data-area="${m}">شاهد كما يراها ←</button></div><button class="btn btn-line btn-sm" data-action="endday" data-member="${m}">🌙 تقرير نهاية اليوم</button></article>`;
  }
  function eventsView(){
    const events=dashboard.events||[];
    return `<article class="card"><div class="card-title"><h2>المواعيد القادمة</h2><span class="count">${events.length}</span></div>${events.length?events.map(e=>`<div class="ev-row"><div class="ev-day">${dayLabel(e.date)}${e.time?`<br>${esc(e.time)}`:""}</div><div style="flex:1;min-width:0"><div class="t-title">${esc(e.title)}</div><div class="muted small">${e.assignee==="family"?"كل العائلة":PEOPLE[e.assignee]?.name||""}</div></div><button class="icon-btn" data-action="delete-event" data-id="${e.id}" aria-label="حذف الموعد: ${esc(e.title)}">🗑</button></div>`).join(""):`<div class="empty"><b>📅</b>لا توجد مواعيد قادمة</div>`}<button class="btn btn-primary btn-big" style="margin-top:14px" data-action="add-event">＋ موعد جديد</button></article>`;
  }
  function parentView(){
    if(!family.parentAuthenticated)return `${topbar()}<div class="stack">${loginCard("parent")}</div>`;
    if(!dashboard)return `${topbar()}<div class="stack"><article class="card login"><h2>تعذر تحميل لوحة العائلة</h2><p class="muted">تحقق من الاتصال بقاعدة البيانات ثم أعد المحاولة.</p><div class="row" style="justify-content:center;margin-top:12px"><button class="btn btn-primary" data-action="reload">إعادة المحاولة</button></div></article></div>`;
    const sy=stats("yaman"),sj=stats("judy"),openAll=sy.open+sj.open,doneAll=sy.done+sj.done;
    const events=dashboard.events||[];
    const nextEv=events.find(e=>e.date===today());
    const prev=dashboard.previousIncomplete;
    let body="";
    if(pview==="today"){
      body=`<div class="actions"><button class="btn btn-primary" data-action="add-task">＋ مهمة جديدة</button><button class="btn btn-soft" data-action="plan">✨ خطة اليوم الذكية</button></div>
      ${prev?.total?`<div class="soft-note">🌙 بقيت ${prev.total} ${prev.total===1?"مهمة":"مهام"} من أمس (يَمان ${prev.summary?.yaman||0}، جودي ${prev.summary?.judy||0}). لا نرحّلها كلها، اختاروا مهمة واحدة سهلة للبداية.</div>`:""}
      ${nextEv?`<div class="event" style="width:100%">📌 اليوم${nextEv.time?` ${esc(nextEv.time)}`:""}: ${esc(nextEv.title)}</div>`:""}<div class="grid2">${KIDS.map(kidCard).join("")}</div>`;
    }else if(pview==="events")body=eventsView();
    else body=prayerCard()+tickView();
    const head=pview==="today"?hero(greeting(),openAll?`بقي ${openAll} ${openAll===1?"مهمة":"مهام"} مفتوحة لليوم`:(doneAll?"أنجز الجميع كل المهام. يوم رائع!":"لا توجد مهام لليوم بعد."),"🏠"):hero(pview==="events"?"المواعيد":"الإعدادات",pview==="events"?"جدول العائلة القادم":"الصلاة والمزامنة","🏠",false);
    return `${topbar()}${head}<div class="stack">${body}</div>`;
  }

  /* ---- child ---- */
  function childView(m){
    const p=PEOPLE[m];
    if(!family.parentAuthenticated&&!family[`${m}Authenticated`])return `${topbar()}<div class="stack">${loginCard(m)}</div>`;
    const d=child[m];
    if(!d)return `${topbar()}<div class="stack"><article class="card login"><h2>تعذر تحميل مهامك</h2><div class="row" style="justify-content:center;margin-top:12px"><button class="btn btn-primary" data-action="reload">إعادة المحاولة</button></div></article></div>`;
    const all=d.tasks||[],tasks=all.filter(t=>!isPrayer(t)),prayers=all.filter(isPrayer);
    const open=tasks.filter(t=>!t.done),done=tasks.filter(t=>t.done),pts=pointsOf(tasks);
    const cur=open.find(t=>t.id===focusId[m])||open[0];
    const rest=open.filter(t=>t!==cur);
    let msg;
    if(!tasks.length)msg="لا توجد مهام اليوم. استمتع بوقتك!";
    else if(!open.length)msg="أنجزت كل مهامك. أنت بطل!";
    else if(!done.length)msg=`يلا نبدأ! عندك ${open.length===1?"مهمة واحدة":open.length+" مهام"} فقط`;
    else msg=`رائع! بقي ${open.length===1?"مهمة واحدة":open.length+" مهام"}`;
    let focus="";
    if(cur){
      const ty=typeOf(cur.type),started=cur.status==="in_progress"||cur.startedAt;
      focus=`<article class="card focus pop" style="--tc:${ty.c}"><span class="kicker">${rest.length||done.length?"مهمتك الآن":"مهمتك اليوم"}</span><div class="big-icon" aria-hidden="true">${ty.i}</div><h2>${esc(cur.title)}</h2><div class="meta">${timeChip(cur)}${timerChip(cur)}<span class="tchip">${ty.l}</span></div>${cur.note?`<p class="note">${esc(cur.note)}</p>`:""}${started?`<div class="timerbox" data-timer data-start="${esc(cur.startedAt||"")}" data-min="${cur.timerMinutes||0}"><small>${cur.timerMinutes?"الوقت المتبقي":"مرّ منذ البداية"}</small><b>--:--</b></div>`:""}<p class="reward">⭐ تربح ${cur.points} نقطة${started?"":" · ابدأ الآن لتحصل على مكافأة البداية"}</p><button class="btn btn-ok btn-big" data-action="complete" data-member="${m}" data-id="${cur.id}">✓ أنجزتها!</button><div class="actions" style="margin-top:12px">${started?"":`<button class="btn btn-soft btn-sm" data-action="start" data-member="${m}" data-id="${cur.id}">▶ ابدأ الآن</button>`}<button class="btn btn-soft btn-sm" data-action="help" data-member="${m}" data-id="${cur.id}">🤝 ساعدني</button>${cur.type==="breathing"?`<button class="btn btn-soft btn-sm" data-action="breathe">🌬️ نتنفس معاً</button>`:""}${rest.length?`<button class="btn btn-line btn-sm" data-action="later" data-member="${m}" data-id="${cur.id}">ليس الآن ↩</button>`:""}</div></article>`;
    }else if(tasks.length)focus=`<article class="card celebrate pop"><div class="trophy" aria-hidden="true">🏆</div><h2>أحسنت يا ${p.name}!</h2><p class="muted">ربحت ${pts} نقطة اليوم. استرح، فقد استحققت ذلك.</p><button class="btn btn-soft" style="margin-top:14px" data-action="endday" data-member="${m}">🌙 تقرير يومي</button></article>`;
    const events=(d.events||[]);
    const prevN=d.previousIncomplete?.incomplete||0;
    const row=t=>{const ty=typeOf(t.type);return `<button class="task" style="--tc:${ty.c}" data-action="focus" data-member="${m}" data-id="${t.id}" aria-label="ابدأ: ${esc(t.title)}"><span class="t-ico" aria-hidden="true">${ty.i}</span><span class="t-body"><span class="t-title">${esc(t.title)}</span><span class="t-meta">${timeChip(t)}${timerChip(t)}<span>⭐ ${t.points}</span></span></span><span aria-hidden="true">←</span></button>`};
    return `${topbar()}${hero(`${greeting()} ${p.name}`,p.sub,p.icon)}
    <div class="stack">
      <article class="card"><div class="progress">${ring(done.length,tasks.length)}<div><div class="progress-msg">${msg}</div><div class="chips"><span class="chip gold">⭐ ${pts} نقطة اليوم</span>${done.length?`<span class="chip ok">✓ ${done.length} منجزة</span>`:""}</div></div></div></article>
      ${prevN&&!done.length?`<div class="soft-note">🌙 أمس بقيت بعض المهام. لا بأس! نبدأ اليوم بخطوة صغيرة واحدة.</div>`:""}
      ${focus}
      ${prayers.length?`<article class="card"><div class="card-title"><h2>🕌 الصلوات</h2></div><div class="prayers">${prayers.map(t=>`<button class="pr ${t.done?"done":""}" data-action="complete" data-member="${m}" data-id="${t.id}" ${t.done?"disabled":""} aria-label="${esc(t.title)}">${t.done?"✓":"○"} <span>${esc(t.title.replace("صلاة ","").replace(" في وقتها",""))}</span><small>${esc(t.suggestedTime||"")}</small></button>`).join("")}</div></article>`:""}
      ${events.length?`<article class="card"><div class="card-title"><h2>مواعيدي اليوم</h2></div><div class="events">${events.map(e=>`<div class="event">${e.time?`<time>${esc(e.time)}</time>`:"📌"}${esc(e.title)}</div>`).join("")}</div></article>`:""}
      ${rest.length?`<article class="card"><div class="card-title"><h2>بعدها</h2><span class="count">${rest.length}</span></div><div class="list">${listOrDetails(rest,3,row,"عرض الباقي")}</div></article>`:""}
      ${done.length?`<article class="card"><details class="fold" ${open.length?"":"open"}><summary>أنجزت اليوم (${done.length})</summary><div class="list">${done.map(t=>{const ty=typeOf(t.type);return `<div class="task done" style="--tc:${ty.c}"><span class="t-ico" aria-hidden="true">${ty.i}</span><span class="t-body"><span class="t-title">${esc(t.title)}</span><span class="t-meta"><span>⭐ ${gain(t)}</span></span>${(t.badges||[]).length?`<span class="badges">${t.badges.map(b=>`<span>${esc(b.icon)} ${esc(b.label)}</span>`).join("")}</span>`:""}</span><span class="check on" aria-hidden="true">✓</span></div>`}).join("")}</div></details></article>`:""}
      ${tasks.length&&(open.length===0||new Date().getHours()>=17)?`<button class="btn btn-line" data-action="endday" data-member="${m}">🌙 تقرير يومي</button>`:""}
    </div>`;
  }

  /* ======================= render ======================= */
  function render(){
    const a=area==="home"?"parent":area;
    document.body.dataset.area=a;
    $("themeColor").content=PEOPLE[a].color;
    const y=scrollY;
    $("root").innerHTML=loading?skeleton():(area==="home"?homeView():area==="parent"?parentView():childView(area));
    const pm=!loading&&area==="parent"&&family.parentAuthenticated&&dashboard;
    const nav=$("nav");nav.hidden=!pm;
    nav.innerHTML=pm?`<div class="nav-in">${[["today","📋","اليوم"],["events","📅","المواعيد"],["settings","⚙️","الإعدادات"]].map(([k,i,l])=>`<button class="tab ${pview===k?"active":""}" data-pview="${k}" aria-current="${pview===k}"><span>${i}</span>${l}</button>`).join("")}</div>`:"";
    $("fabRoot").innerHTML="";
    scrollTo(0,y);
    tickTimers();
  }
  function tickTimers(){
    document.querySelectorAll("[data-timer]").forEach(el=>{
      const start=Date.parse(el.dataset.start)||Date.now(),min=Number(el.dataset.min)||0,b=el.querySelector("b");
      const el_s=Math.floor((Date.now()-start)/1000);
      const fmt=s=>{s=Math.abs(s);return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`};
      if(min){const left=min*60-el_s;b.textContent=left>=0?fmt(left):"انتهى الوقت 🎉";if(left<0)el.querySelector("small").textContent="لا مشكلة، أنهِ بهدوء عندما تكون جاهزاً"}
      else b.textContent=fmt(el_s);
    });
  }
  setInterval(tickTimers,1000);

  /* ======================= modals ======================= */
  function modal(title,html){
    $("modalRoot").innerHTML=`<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div><div class="sheet-head"><h2>${esc(title)}</h2><button class="x" data-action="close" aria-label="إغلاق">✕</button></div>${html}</section>`;
    const f=$("modalRoot").querySelector("input[type=text],textarea");f&&setTimeout(()=>f.focus({preventScroll:true}),60);
  }
  function close(){$("modalRoot").innerHTML=""}
  function syncDraft(){const t=$("taskTitle"),n=$("taskNote"),tm=$("taskTime");if(t)draft.title=t.value;if(n)draft.note=n.value;if(tm)draft.time=tm.value}

  function taskModal(){
    const ty=typeOf(draft.type),two=draft.step===2,edit=!!draft.editId;
    const steps=`<div class="steps" aria-hidden="true"><i class="on"></i><i class="${two?"on":""}"></i></div>`;
    const ttl=edit?"تعديل المهمة":"مهمة جديدة";
    if(!two){
      const whos=edit?[["yaman","🦸‍♂️ يَمان"],["judy","🦸‍♀️ جودي"]]:[["yaman","🦸‍♂️ يَمان"],["judy","🦸‍♀️ جودي"],["both","👫 كلاهما"]];
      modal(`${ttl} · 1 من 2`,`${steps}<div class="form" id="taskStep1">
        <div><span class="label">لمن؟</span><div class="seg" role="group">${whos.map(([k,l])=>`<button type="button" class="${draft.who===k?"on":""}" data-action="d-who" data-v="${k}">${l}</button>`).join("")}</div></div>
        <div><span class="label">نوع المهمة</span><div class="types">${Object.entries(TYPES).map(([k,v])=>`<button type="button" class="${draft.type===k?"on":""}" style="--tc:${v.c}" data-action="d-type" data-v="${k}"><span>${v.i}</span>${v.l}</button>`).join("")}</div></div>
        <button class="btn btn-primary btn-big" type="button" data-action="d-next">التالي ←</button></div>`);
      return;
    }
    const whoLbl=draft.who==="both"?"يَمان وجودي":PEOPLE[draft.who].name;
    modal(`${ttl} · 2 من 2`,`${steps}<form class="form" id="taskForm">
      <div class="chips" style="margin:0"><span class="chip">${ty.i} ${ty.l}</span><span class="chip">لـ${whoLbl}</span></div>
      <label class="field"><span>ما المطلوب؟</span><input id="taskTitle" type="text" required maxlength="180" placeholder="جملة قصيرة وواضحة" value="${esc(draft.title)}" autocomplete="off">${ty.s.length?`<div class="sugg">${ty.s.map(s=>`<button type="button" data-action="d-sugg" data-v="${esc(s)}">${esc(s)}</button>`).join("")}</div>`:""}</label>
      <label class="field"><span>الوقت المقترح (اختياري)</span><input id="taskTime" type="time" value="${esc(draft.time)}"></label>
      <div><span class="label">مؤقت (دقائق)</span><div class="seg wrap" role="group">${TIMERS.map(n=>`<button type="button" class="${draft.timer===n?"on":""}" data-action="d-timer" data-v="${n}">${n?n+" د":"بلا"}</button>`).join("")}</div></div>
      ${draft.type==="prayer"?`<p class="hint">مهام الصلاة بلا نقاط ولا مكافآت.</p>`:`<div><span class="label">النقاط</span><div class="stepper"><button type="button" data-action="d-pts" data-v="-5" aria-label="أقل">−</button><output>⭐ ${draft.points}</output><button type="button" data-action="d-pts" data-v="5" aria-label="أكثر">＋</button></div></div>`}
      <label class="field"><span>ملاحظة للطفل (اختياري)</span><input id="taskNote" type="text" maxlength="500" placeholder="مثال: بعد الغداء مباشرة" value="${esc(draft.note)}" autocomplete="off"></label>
      <div class="actions"><button class="btn btn-primary" type="submit">${edit?"حفظ التعديل":"حفظ المهمة"}</button><button class="btn btn-line" type="button" data-action="d-back">→ رجوع</button></div>
      ${edit?`<button class="btn btn-danger" type="button" data-action="delete-task" data-id="${esc(draft.editId)}" data-title="${esc(draft.title)}">🗑 حذف المهمة</button>`:""}
    </form>`);
  }
  function eventModal(){
    modal("موعد جديد",`<form class="form" id="eventForm">
      <label class="field"><span>لمن؟</span><select id="eventMember"><option value="family">كل العائلة</option><option value="yaman">يَمان</option><option value="judy">جودي</option></select></label>
      <label class="field"><span>العنوان</span><input id="eventTitle" type="text" required maxlength="140" placeholder="مثال: زيارة الجدة" autocomplete="off"></label>
      <div class="grid2" style="gap:12px"><label class="field"><span>التاريخ</span><input id="eventDate" type="date" value="${today()}" required></label><label class="field"><span>الوقت (اختياري)</span><input id="eventTime" type="time"></label></div>
      <button class="btn btn-primary btn-big" type="submit">حفظ الموعد</button>
    </form>`);
  }
  function confirmModal(title,text,action,id){
    modal(title,`<p class="muted" style="margin-bottom:16px">${esc(text)}</p><div class="actions"><button class="btn btn-danger" data-action="${action}" data-id="${esc(id)}">نعم، احذف</button><button class="btn btn-line" data-action="close">تراجع</button></div>`);
  }

  /* ---- smart plan ---- */
  let planOpts={fullDay:true,start:"06:00",end:"21:00",count:6,goals:""};
  function planModal(){
    modal("خطة اليوم الذكية",`<form class="form" id="planForm">
      <p class="muted">تُنشأ مهام لـيَمان وجودي معاً (وتُضاف الصلوات حسب المواقيت). لا تتكرر المهام الموجودة بنفس العنوان.</p>
      <div class="seg" role="group"><button type="button" class="${planOpts.fullDay?"on":""}" data-action="p-mode" data-v="1">يوم كامل</button><button type="button" class="${planOpts.fullDay?"":"on"}" data-action="p-mode" data-v="0">عدد محدد</button></div>
      ${planOpts.fullDay?`<div class="times"><label class="field"><span>من</span><input id="planStart" type="time" value="${planOpts.start}"></label><label class="field"><span>إلى</span><input id="planEnd" type="time" value="${planOpts.end}"></label></div>`:`<label class="field"><span>عدد المهام لكل طفل</span><input id="planCount" type="number" min="1" max="20" value="${planOpts.count}"></label>`}
      <label class="field"><span>أهداف اليوم (اختياري)</span><textarea id="planGoals" class="helpq" placeholder="مثال: ركّز على الرياضيات والحركة، ويوم هادئ لـيَمان">${esc(planOpts.goals)}</textarea></label>
      <button class="btn btn-primary btn-big" type="submit">✨ جهّز الخطة</button></form>`);
  }
  function planBusy(){modal("خطة اليوم الذكية",`<p style="text-align:center;padding:30px 0"><span class="spin"></span>جاري تجهيز خطة هادئة… قد يستغرق ذلك بضع ثوانٍ.</p>`)}
  function planDone(r){
    const n=(r.inserted||[]).length;
    modal("الخطة جاهزة",`<div class="stack" style="margin:0"><div class="chips" style="margin:0"><span class="chip ok">✓ أُضيفت ${n} ${n===1?"مهمة":"مهام"}</span><span class="chip">${r.source==="openai"?"بمساعدة ChatGPT":"خطة محلية آمنة"}</span></div>${r.warning?`<p class="soft-note">${esc(r.warning)}</p>`:""}${n===0?`<p class="muted">كل مهام الخطة موجودة مسبقاً بنفس العناوين.</p>`:""}<button class="btn btn-primary btn-big" data-action="close">تم</button></div>`);
  }

  /* ---- prayer manual ---- */
  function prayerModal(){
    const pt=prayer?.prayerTimes||{};
    modal("مواقيت الصلاة اليوم",`<form class="form" id="prayerForm"><p class="muted">أدخل المواقيت مرة واحدة من تطبيق مواقيت فلسطين أو شو بدك لتُضاف تذكيرات الصلاة بدقة.</p><div class="times">${PRAYER_KEYS.map(([k,l])=>`<label class="field"><span>${l}</span><input name="${k}" type="time" value="${esc(pt[k]||"")}" ${k==="sunrise"?"":"required"}></label>`).join("")}</div><label class="field"><span>ملاحظة (اختياري)</span><input name="note" type="text" maxlength="200"></label><button class="btn btn-primary btn-big" type="submit">حفظ المواقيت</button></form>`);
  }

  /* ---- help ---- */
  function helpModal(){
    const t=help.task,r=help.result;
    const modes=[["full","شرح كامل"],["first_step","أول خطوة"],["checklist","قائمة تحقق"],["clarify","أسئلة توضيح"]];
    if(t.type==="youtube")modes.push(["youtube","مدرب القناة"]);
    const list=(a)=>`<ol>${a.map(x=>`<li>${esc(x)}</li>`).join("")}</ol>`;
    modal("🤝 ساعدني",`<div class="form"><div class="chips" style="margin:0"><span class="chip">${typeOf(t.type).i} ${esc(t.title)}</span></div>
      <div class="seg wrap" style="grid-template-columns:repeat(2,1fr)" role="group">${modes.map(([k,l])=>`<button type="button" class="${help.mode===k?"on":""}" data-action="h-mode" data-v="${k}">${l}</button>`).join("")}</div>
      <label class="field"><span>سؤالك (اختياري)</span><textarea id="helpQ" class="helpq" placeholder="اكتب ما لا تفهمه أو انسخ نص التمرين هنا">${esc(help.question)}</textarea></label>
      <button class="btn btn-primary btn-big ${help.loading?"busy":""}" data-action="h-ask">${help.loading?`<span class="spin"></span>أفكر معك…`:"اسأل Hero"}</button>
      ${r?`<div>${r.intro?`<p><b>${esc(r.intro)}</b></p>`:""}${r.answer?`<div class="hsec"><h3>الجواب</h3><p style="margin:0">${esc(r.answer)}</p></div>`:""}${(r.questions||[]).length?`<div class="hsec"><h3>أسئلة تساعدك</h3><ul>${r.questions.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`:""}${(r.steps||[]).length?`<div class="hsec"><h3>الخطوات</h3>${list(r.steps)}</div>`:""}${(r.checklist||[]).length?`<div class="hsec"><h3>قائمة التحقق</h3>${r.checklist.map((x,i)=>`<button class="ck ${help.checked.has(i)?"on":""}" data-action="h-check" data-i="${i}"><i>✓</i><span>${esc(x)}</span></button>`).join("")}</div>`:""}${r.encouragement?`<p class="soft-note" style="margin-top:12px">${esc(r.encouragement)}</p>`:""}${r.warning?`<p class="quiet">${esc(r.warning)}</p>`:""}</div>`:""}</div>`);
  }

  /* ---- end of day ---- */
  async function endDayModal(m){
    const r=await api(`/api/ai/end-day/${m}?date=${today()}`);const s=r.summary||{};
    const parent=family.parentAuthenticated;
    const li=a=>(a||[]).length?`<ul>${a.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:"";
    modal(`🌙 يوم ${PEOPLE[m].name}`,`<div class="stack" style="margin:0"><div class="stat3"><div><b>${s.done??0}</b><span>منجزة</span></div><div><b>${s.open??0}</b><span>متبقية</span></div><div><b>⭐ ${s.points??0}</b><span>نقاط</span></div></div><p style="font-weight:700">${esc(s.encouragement||"")}</p>${(s.completedTasks||[]).length?`<div class="hsec"><h3>أنجزت</h3>${li(s.completedTasks)}</div>`:""}${(s.unfinishedTasks||[]).length?`<div class="hsec"><h3>للغد بهدوء</h3>${li(s.unfinishedTasks)}${s.nextStep?`<p style="margin:6px 0 0">${esc(s.nextStep)}</p>`:""}</div>`:""}${parent&&s.parentRecommendation?`<div class="soft-note">💡 للوالدين: ${esc(s.parentRecommendation)}</div>`:""}<button class="btn btn-primary btn-big" data-action="close">تم</button></div>`);
  }

  /* ---- breathing ---- */
  function breathe(){
    const el=document.createElement("div");el.className="breath";el.id="breath";
    el.innerHTML=`<div class="orb" aria-hidden="true"></div><h2 id="breathTxt">شهيق…</h2><p>شهيق من الأنف 4 ثوانٍ، ثم زفير طويل 6 ثوانٍ. توقّف في أي وقت إذا شعرت بدوخة أو انزعاج.</p><button class="btn btn-line" data-action="breathe-stop">انتهيت</button>`;
    document.body.appendChild(el);
    const txt=$("breathTxt"),t0=Date.now();
    clearInterval(breathTimer);
    breathTimer=setInterval(()=>{const s=((Date.now()-t0)/1000)%10;txt.textContent=s<4?"شهيق…":"زفير… ببطء"},300);
  }
  function breatheStop(){clearInterval(breathTimer);$("breath")?.remove()}

  /* ---- ticktick modals ---- */
  async function projectsModal(){
    if(!tick.connected)return toast("اربط TickTick أولاً.","err");
    projects=(await api("/api/ticktick/projects")).projects||[];
    let saved=[];try{saved=JSON.parse(localStorage.getItem("hero-projects")||"[]")}catch{}
    chosenProjects=new Set(saved);if(!chosenProjects.size)projects.forEach(p=>chosenProjects.add(p.id));
    drawProjects();
  }
  function drawProjects(){
    modal("قوائم TickTick للاستيراد",`<p class="muted" style="margin-bottom:12px">اختر القوائم التي تُستورد منها مهام اليوم.</p>${projects.map(p=>`<button class="pick ${chosenProjects.has(p.id)?"on":""}" data-action="toggle-project" data-id="${esc(p.id)}"><span class="box">${chosenProjects.has(p.id)?"✓":""}</span><span>${esc(p.name)}</span></button>`).join("")||`<div class="empty">لا توجد قوائم.</div>`}<button class="btn btn-primary btn-big" data-action="save-projects" style="margin-top:8px">حفظ الاختيار</button>`);
  }
  async function importModal(){
    if(!tick.connected)return toast("اربط TickTick أولاً.","err");
    let ids=[];try{ids=JSON.parse(localStorage.getItem("hero-projects")||"[]")}catch{}
    const q=ids.length?`?projectIds=${encodeURIComponent(ids.join(","))}`:"";
    importTasks=(await api(`/api/ticktick/today-tasks${q}`)).tasks||[];chosenTasks=new Set();drawImport();
  }
  function drawImport(){
    const n=chosenTasks.size;
    modal("استيراد من TickTick",`<p class="muted" style="margin-bottom:12px">مهام اليوم المفتوحة. اختر ما تريد ثم حدد لمن.</p>${importTasks.length?importTasks.map(t=>{const k=t.projectId+":"+t.id;return `<button class="pick ${chosenTasks.has(k)?"on":""}" data-action="toggle-import" data-key="${esc(k)}"><span class="box">${chosenTasks.has(k)?"✓":""}</span><span><b>${esc(t.title)}</b><br><small class="muted">${esc(t.projectName)}</small></span></button>`}).join(""):`<div class="empty"><b>🎉</b>لا توجد مهام بتاريخ اليوم</div>`}<div class="actions" style="margin-top:8px"><button class="btn btn-primary" data-action="assign-import" data-member="yaman" ${n?"":"disabled"}>إضافة ليَمان${n?` (${n})`:""}</button><button class="btn btn-primary" data-action="assign-import" data-member="judy" ${n?"":"disabled"}>إضافة لجودي${n?` (${n})`:""}</button></div>`);
  }

  /* ======================= actions ======================= */
  function commitTask(id){
    const p=pending.get(id);if(!p)return;
    api(`/api/family/tasks/${id}/complete`,{method:"PATCH",body:JSON.stringify({assignee:p.member})})
      .then(()=>{pending.delete(id);return load().then(render)})
      .catch(err=>{pending.delete(id);const t=findTask(id);if(t)t.done=false;render();onErr(err)});
  }
  function completeTask(btn){
    const m=btn.dataset.member,id=btn.dataset.id,task=child[m]?.tasks?.find(t=>t.id===id);
    if(!task||task.done||pending.has(id))return;
    const r=btn.getBoundingClientRect(),prayerTask=isPrayer(task);
    task.done=true;buzz();playDone(prayerTask?"soft":"task");render();
    pending.set(id,{member:m,timer:setTimeout(()=>commitTask(id),5000)});
    $("toasts").innerHTML="";
    const undo={label:"تراجع",fn:()=>{const p=pending.get(id);if(!p)return;clearTimeout(p.timer);pending.delete(id);task.done=false;render()}};
    if(prayerTask){toast("تقبّل الله 🤍","ok",undo,5000);return}
    confetti(r.left+r.width/2,r.top+r.height/2,24);
    const left=(child[m].tasks||[]).filter(t=>!t.done&&!isPrayer(t)).length;
    const all=!left&&stats(m).total;
    if(all)setTimeout(()=>{confetti(innerWidth/2,innerHeight/3,70);playDone("all")},250);
    const est=task.points+(task.startedAt?2:0);
    toast(all?`أنجزت كل المهام! +${est} ⭐`:`أحسنت! +${est} نقطة ⭐`,all?"ok":"gold",undo,5000);
  }
  window.addEventListener("pagehide",()=>{
    for(const [id,p] of pending){clearTimeout(p.timer);try{fetch(`/api/family/tasks/${id}/complete`,{method:"PATCH",keepalive:true,credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({assignee:p.member})})}catch{}}
  });
  async function pinKey(k){
    if(pinBusy)return;
    if(k==="back")pin=pin.slice(0,-1);
    else if(k==="go"){if(pin.length<4){pinError="الرمز 4 أرقام على الأقل.";return paintPin(true)}return submitPin()}
    else if(/^\d$/.test(k)&&pin.length<10)pin+=k;
    pinError="";paintPin();
  }
  function paintPin(shake=false){
    const dots=$("dots"),err=$("pinErr");if(!dots)return;
    const n=Math.max(4,pin.length);
    dots.innerHTML=Array.from({length:n},(_,i)=>`<i class="${i<pin.length?"f":""}"></i>`).join("");
    err.textContent=pinError;
    if(shake){dots.classList.remove("shake");void dots.offsetWidth;dots.classList.add("shake");buzz(60)}
  }
  async function submitPin(){
    pinBusy=true;const go=document.querySelector(".key-go");go?.classList.add("busy");
    try{
      const url=area==="parent"?"/api/family/parent/login":`/api/family/child/${area}/login`;
      await api(url,{method:"POST",body:JSON.stringify({pin})});
      pin="";pinError="";await refresh();
    }catch(err){pinError=err.message;pin="";paintPin(true)}
    finally{pinBusy=false;go?.classList.remove("busy")}
  }
  async function loadPrayer(){
    prayer=null;if(pview==="settings")render();
    try{const r=await api(`/api/prayer/today?date=${today()}`);prayer={prayerTimes:r.prayerTimes||{},warning:r.warning||""}}
    catch(e){prayer={prayerTimes:{},warning:e.message}}
    if(pview==="settings"&&area==="parent")render();
  }
  function taskBody(){
    return{title:draft.title.trim(),type:draft.type,points:draft.type==="prayer"?0:draft.points,date:today(),note:draft.note,suggestedTime:draft.time,timerMinutes:draft.timer};
  }

  /* ======================= events ======================= */
  document.addEventListener("click",async e=>{
    const kb=e.target.closest("[data-key]");if(kb)return pinKey(kb.dataset.key);
    const b=e.target.closest("[data-area],[data-action],[data-pview]");
    if(!b){if(e.target.id==="modalRoot")close();return}
    if(b.dataset.pview){pview=b.dataset.pview;render();scrollTo(0,0);if(pview==="settings"&&!prayer)loadPrayer();return}
    if(b.dataset.area&&!b.dataset.action){
      area=b.dataset.area;pin="";pinError="";
      if(area!=="home"){try{localStorage.setItem("hero-area",area)}catch{}}
      history.replaceState(null,"",`?area=${area}`);render();scrollTo(0,0);return;
    }
    const a=b.dataset.action;
    switch(a){
      case "close":return close();
      case "reload":return guard(b,()=>refresh());
      case "add-task":draft=newDraft({who:b.dataset.who||"yaman"});return taskModal();
      case "edit-task":{const t=findTask(b.dataset.id);if(!t)return;draft=newDraft({step:2,who:t.assignee,type:t.type,points:t.points,title:t.title,note:t.note,time:t.suggestedTime||"",timer:t.timerMinutes||0,editId:t.id});return taskModal()}
      case "add-event":return eventModal();
      case "d-who":syncDraft();draft.who=b.dataset.v;return taskModal();
      case "d-type":syncDraft();draft.type=b.dataset.v;draft.points=TYPES[draft.type].p;return taskModal();
      case "d-next":draft.step=2;taskModal();return;
      case "d-back":syncDraft();draft.step=1;taskModal();return;
      case "d-sugg":syncDraft();draft.title=b.dataset.v;taskModal();return;
      case "d-timer":syncDraft();draft.timer=Number(b.dataset.v);return taskModal();
      case "d-pts":syncDraft();draft.points=Math.min(50,Math.max(0,draft.points+Number(b.dataset.v)));return taskModal();
      case "later":{const l=child[b.dataset.member].tasks.filter(t=>!t.done&&!isPrayer(t));const i=l.findIndex(t=>t.id===b.dataset.id);focusId[b.dataset.member]=l[(i+1)%l.length].id;render();return}
      case "lock":return guard(b,async()=>{
        if(area==="parent")await api("/api/family/parent/logout",{method:"POST"});
        else await api(`/api/family/child/${area}/logout`,{method:"POST"});
        area="home";history.replaceState(null,"","?area=home");await refresh();toast("تم القفل 🔒");
      });
      case "start":return guard(b,async()=>{
        const t=findTask(b.dataset.id);if(!t)return;
        const r=await api(`/api/family/tasks/${t.id}/start`,{method:"PATCH",body:JSON.stringify({assignee:b.dataset.member})});
        Object.assign(t,r.task||{status:"in_progress",startedAt:new Date().toISOString()});render();toast("بدأت! مكافأة البداية +2 ⭐","gold");
      });
      case "sound":{soundOn=!soundOn;try{localStorage.setItem("hero-sound",soundOn?"on":"off")}catch{}if(soundOn)playDone("task");return render()}
      case "complete":return completeTask(b);
      case "focus":focusId[b.dataset.member]=b.dataset.id;render();scrollTo({top:0,behavior:"smooth"});return;
      case "projects":return guard(b,projectsModal);
      case "import":return guard(b,importModal);
      case "toggle-project":chosenProjects.has(b.dataset.id)?chosenProjects.delete(b.dataset.id):chosenProjects.add(b.dataset.id);return drawProjects();
      case "save-projects":localStorage.setItem("hero-projects",JSON.stringify([...chosenProjects]));close();return toast("تم حفظ القوائم ✓","ok");
      case "toggle-import":chosenTasks.has(b.dataset.key)?chosenTasks.delete(b.dataset.key):chosenTasks.add(b.dataset.key);return drawImport();
      case "assign-import":return guard(b,async()=>{
        let ok=0;
        for(const k of chosenTasks){const t=importTasks.find(x=>`${x.projectId}:${x.id}`===k);if(!t)continue;
          await api("/api/family/tasks",{method:"POST",body:JSON.stringify({assignee:b.dataset.member,title:t.title,type:"other",points:5,date:today(),note:t.content||"مستورد من TickTick",source:"ticktick",ticktickTaskId:t.id,ticktickProjectId:t.projectId,ticktickProjectName:t.projectName})});ok++}
        close();await refresh();toast(`تمت إضافة ${ok} ${ok===1?"مهمة":"مهام"} ✓`,"ok");
      });
      case "delete-task":return confirmModal("حذف المهمة؟",`«${b.dataset.title}» ستُحذف نهائياً.`,"do-delete-task",b.dataset.id);
      case "do-delete-task":return guard(b,async()=>{await api(`/api/family/tasks/${b.dataset.id}`,{method:"DELETE"});close();await refresh();toast("تم الحذف")});
      case "delete-event":return confirmModal("حذف الموعد؟","سيُحذف هذا الموعد من جدول العائلة.","do-delete-event",b.dataset.id);
      case "do-delete-event":return guard(b,async()=>{await api(`/api/family/events/${b.dataset.id}`,{method:"DELETE"});close();await refresh();toast("تم الحذف")});
      case "plan":return planModal();
      case "p-mode":planOpts.fullDay=b.dataset.v==="1";planOpts.goals=$("planGoals")?.value||planOpts.goals;return planModal();
      case "seed":return guard(b,async()=>{
        const r=await api(`/api/family/child/${b.dataset.who}/seed-today`,{method:"POST",body:JSON.stringify({date:today()})});
        await refresh();toast(r.skipped?(r.reason||"توجد مهام بالفعل."):`جُهّز يوم ${PEOPLE[b.dataset.who].name} ✓`,r.skipped?"":"ok");
      });
      case "prayer-edit":return prayerModal();
      case "endday":return guard(b,()=>endDayModal(b.dataset.member));
      case "help":{const t=findTask(b.dataset.id);if(!t)return;help={task:t,member:b.dataset.member,mode:t.type==="youtube"?"youtube":"full",question:"",loading:false,result:null,checked:new Set()};return helpModal()}
      case "h-mode":help.question=$("helpQ")?.value||help.question;help.mode=b.dataset.v;return helpModal();
      case "h-check":{const i=Number(b.dataset.i);help.checked.has(i)?help.checked.delete(i):help.checked.add(i);help.question=$("helpQ")?.value||help.question;return helpModal()}
      case "h-ask":{
        help.question=$("helpQ")?.value||"";help.loading=true;helpModal();
        try{
          const t=help.task;
          help.result=await api("/api/ai/task-help",{method:"POST",body:JSON.stringify({assignee:help.member,mode:help.mode,question:help.question,task:{title:t.title,type:t.type,note:t.note,suggestedTime:t.suggestedTime,timerMinutes:t.timerMinutes,points:t.points,done:t.done,status:t.status}})});
          help.checked=new Set();
        }catch(err){help.loading=false;helpModal();return onErr(err)}
        help.loading=false;if($("modalRoot").firstChild)helpModal();return;
      }
      case "breathe":return breathe();
      case "breathe-stop":return breatheStop();
    }
  });

  document.addEventListener("submit",async e=>{
    const id=e.target.id;if(!["taskForm","eventForm","planForm","prayerForm"].includes(id))return;
    e.preventDefault();const btn=e.target.querySelector("[type=submit]");
    if(id==="taskForm")return guard(btn,async()=>{
      syncDraft();if(!draft.title.trim())return toast("اكتب المهمة أولاً.","err");
      if(draft.editId){
        await api(`/api/family/tasks/${draft.editId}`,{method:"PATCH",body:JSON.stringify({...taskBody(),assignee:draft.who==="both"?"yaman":draft.who})});
        close();await refresh();return toast("تم تحديث المهمة ✓","ok");
      }
      const who=draft.who==="both"?KIDS:[draft.who];
      for(const w of who)await api("/api/family/tasks",{method:"POST",body:JSON.stringify({...taskBody(),assignee:w,source:"parent"})});
      close();await refresh();toast("تمت إضافة المهمة ✓","ok");
    });
    if(id==="eventForm")return guard(btn,async()=>{
      await api("/api/family/events",{method:"POST",body:JSON.stringify({assignee:$("eventMember").value,title:$("eventTitle").value,date:$("eventDate").value,time:$("eventTime").value})});
      close();await refresh();toast("تمت إضافة الموعد ✓","ok");
    });
    if(id==="planForm")return guard(btn,async()=>{
      planOpts.goals=$("planGoals").value;
      if(planOpts.fullDay){planOpts.start=$("planStart").value||"06:00";planOpts.end=$("planEnd").value||"21:00"}else planOpts.count=Number($("planCount").value)||6;
      planBusy();
      try{
        const r=await api("/api/ai/daily-plan",{method:"POST",body:JSON.stringify({date:today(),fullDay:planOpts.fullDay,startTime:planOpts.start,endTime:planOpts.end,taskCount:planOpts.count,goals:planOpts.goals})});
        await load();render();planDone(r);
      }catch(err){close();onErr(err)}
    });
    return guard(btn,async()=>{
      const fd=new FormData(e.target),body={date:today(),note:fd.get("note")||""};
      for(const [k] of PRAYER_KEYS)body[k]=fd.get(k)||"";
      const r=await api("/api/prayer/manual",{method:"POST",body:JSON.stringify(body)});
      prayer={prayerTimes:r.prayerTimes||{},warning:""};close();render();toast("تم حفظ المواقيت ✓","ok");
    });
  });

  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"){if($("breath"))return breatheStop();if($("modalRoot").firstChild)return close()}
    if($("dots")&&!$("modalRoot").firstChild&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)){
      if(/^\d$/.test(e.key))pinKey(e.key);else if(e.key==="Backspace")pinKey("back");else if(e.key==="Enter")pinKey("go");
    }
  });

  /* ======================= boot ======================= */
  const tt=qs.get("ticktick");
  if(tt){
    const m={connected:["تم ربط TickTick ✓","ok"],denied:["تم إلغاء ربط TickTick.","err"],state_error:["تعذر التحقق من ربط TickTick. حاول مرة أخرى.","err"]}[tt];
    if(m)setTimeout(()=>toast(m[0],m[1]),300);
    history.replaceState(null,"",`?area=${area}`);
  }
  render();
  refresh().catch(err=>{loading=false;$("root").innerHTML=`<div class="stack"><article class="card login"><h2>تعذر تشغيل التطبيق</h2><p class="muted">${esc(err.message)}</p><div class="row" style="justify-content:center;margin-top:12px"><button class="btn btn-primary" data-action="reload">إعادة المحاولة</button></div></article></div>`});
})();

