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
    school:  {l:"مدرسة",         p:0, i:"🏫",c:"#5b6b7b",s:[]},
    lesson:  {l:"درس خاص",       p:10,i:"🎓",c:"#6b4de0",s:["درس الرياضيات","درس اللغة"]},
    outing:  {l:"زيارة وخروج",   p:0, i:"🚗",c:"#c2410c",s:["زيارة الجدّين","مشوار مع العائلة"]},
    rest:    {l:"استراحة",       p:0, i:"😌",c:"#64748b",s:["استراحة هادئة","وقت حر"]},
    prayer:  {l:"صلاة",          p:0, i:"🕌",c:"#2e7d6b",s:[]},
    other:   {l:"مهمة أخرى",     p:5, i:"⭐",c:"#7b6cf6",s:[]}
  };
  /* ---- daily motivation: Quran, hadith and sayings attributed to scholars (source shown with each) ---- */
  const QUOTES=[
    {c:"prayer",t:"وَاسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",s:"القرآن الكريم، البقرة: 45"},
    {c:"prayer",t:"حَافِظُوا عَلَى الصَّلَوَاتِ وَالصَّلَاةِ الْوُسْطَىٰ",s:"القرآن الكريم، البقرة: 238"},
    {c:"prayer",t:"إِنَّ الصَّلَاةَ تَنْهَىٰ عَنِ الْفَحْشَاءِ وَالْمُنكَرِ",s:"القرآن الكريم، العنكبوت: 45"},
    {c:"prayer",t:"أَرِحْنَا بِالصَّلَاةِ يَا بِلَالُ",s:"حديث نبوي، رواه أبو داود"},
    {c:"prayer",t:"وَالصَّلَاةُ نُورٌ",s:"حديث نبوي، رواه مسلم"},
    {c:"prayer",t:"أَرَأَيْتُمْ لَوْ أَنَّ نَهْرًا بِبَابِ أَحَدِكُمْ يَغْتَسِلُ مِنْهُ كُلَّ يَوْمٍ خَمْسَ مَرَّاتٍ، هَلْ يَبْقَى مِنْ دَرَنِهِ شَيْءٌ؟ قَالُوا: لَا. قَالَ: فَذَلِكَ مَثَلُ الصَّلَوَاتِ الْخَمْسِ يَمْحُو اللَّهُ بِهِنَّ الْخَطَايَا",s:"حديث نبوي، متفق عليه"},
    {c:"study",t:"وَقُل رَّبِّ زِدْنِي عِلْمًا",s:"القرآن الكريم، طه: 114"},
    {c:"study",t:"يَرْفَعِ اللَّهُ الَّذِينَ آمَنُوا مِنكُمْ وَالَّذِينَ أُوتُوا الْعِلْمَ دَرَجَاتٍ",s:"القرآن الكريم، المجادلة: 11"},
    {c:"study",t:"مَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا سَهَّلَ اللَّهُ لَهُ بِهِ طَرِيقًا إِلَى الْجَنَّةِ",s:"حديث نبوي، رواه مسلم"},
    {c:"study",t:"خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ",s:"حديث نبوي، رواه البخاري"},
    {c:"study",t:"لَا يُسْتَطَاعُ الْعِلْمُ بِرَاحَةِ الْجِسْمِ",s:"يحيى بن أبي كثير، رواه مسلم"},
    {c:"study",t:"مَنْ لَمْ يَذُقْ مُرَّ التَّعَلُّمِ سَاعَةً تَجَرَّعَ ذُلَّ الْجَهْلِ طُولَ حَيَاتِهِ",s:"يُنسب إلى الإمام الشافعي"},
    {c:"study",t:"قِيمَةُ كُلِّ امْرِئٍ مَا يُحْسِنُهُ",s:"يُنسب إلى الإمام علي بن أبي طالب"},
    {c:"effort",t:"وَأَن لَّيْسَ لِلْإِنسَانِ إِلَّا مَا سَعَىٰ",s:"القرآن الكريم، النجم: 39"},
    {c:"effort",t:"أَحَبُّ الْأَعْمَالِ إِلَى اللَّهِ أَدْوَمُهَا وَإِنْ قَلَّ",s:"حديث نبوي، متفق عليه"},
    {c:"effort",t:"احْرِصْ عَلَى مَا يَنْفَعُكَ وَاسْتَعِنْ بِاللَّهِ وَلَا تَعْجَزْ",s:"حديث نبوي، رواه مسلم"},
    {c:"effort",t:"إِنَّ اللَّهَ لَا يُضِيعُ أَجْرَ مَنْ أَحْسَنَ عَمَلًا",s:"القرآن الكريم، الكهف: 30"},
    {c:"effort",t:"إِنَّ اللَّهَ يُحِبُّ إِذَا عَمِلَ أَحَدُكُمْ عَمَلًا أَنْ يُتْقِنَهُ",s:"حديث نبوي، رواه البيهقي"},
    {c:"success",t:"إِنَّ مَعَ الْعُسْرِ يُسْرًا",s:"القرآن الكريم، الشرح: 6"},
    {c:"success",t:"وَالَّذِينَ جَاهَدُوا فِينَا لَنَهْدِيَنَّهُمْ سُبُلَنَا",s:"القرآن الكريم، العنكبوت: 69"},
    {c:"success",t:"فَإِذَا عَزَمْتَ فَتَوَكَّلْ عَلَى اللَّهِ",s:"القرآن الكريم، آل عمران: 159"},
    {c:"success",t:"إِنَّ اللَّهَ لَا يُغَيِّرُ مَا بِقَوْمٍ حَتَّىٰ يُغَيِّرُوا مَا بِأَنفُسِهِمْ",s:"القرآن الكريم، الرعد: 11"},
    {c:"success",t:"الْمُؤْمِنُ الْقَوِيُّ خَيْرٌ وَأَحَبُّ إِلَى اللَّهِ مِنَ الْمُؤْمِنِ الضَّعِيفِ، وَفِي كُلٍّ خَيْرٌ",s:"حديث نبوي، رواه مسلم"}
  ];
  const QCAT={prayer:"🕌",study:"📚",effort:"💪",success:"🌟"};
  function quoteFor(seed,pref){
    let h=0;for(const ch of String(seed))h=(h*31+ch.charCodeAt(0))>>>0;
    const pool=pref?QUOTES.filter(q=>q.c===pref):QUOTES;const list=pool.length?pool:QUOTES;
    return list[h%list.length];
  }
  const quoteHtml=q=>`<figure class="quote"><span class="q-ico" aria-hidden="true">${QCAT[q.c]||"✨"}</span><blockquote>${esc(q.t)}</blockquote><figcaption>${esc(q.s)}</figcaption></figure>`;
  const PEOPLE={
    parent:{name:"الوالدان",icon:"🏠",color:"#4f46e5",sub:"نظرة واحدة على يوم العائلة كلها."},
    yaman:{name:"يَمان",icon:"🦸‍♂️",color:"#0891b2",sub:"خطوة واحدة واضحة في كل مرة."},
    judy:{name:"جودي",icon:"🦸‍♀️",color:"#d6246e",sub:"مهام قصيرة وواضحة."}
  };
  let KIDS=["yaman","judy"];
  const addPerson=(id,name,icon)=>{if(!PEOPLE[id])PEOPLE[id]={name:name||"…",icon:icon||"🌟",color:"#0f8a5f",sub:"خطوة واحدة واضحة في كل مرة."};else{PEOPLE[id].name=name||PEOPLE[id].name;PEOPLE[id].icon=icon||PEOPLE[id].icon}if(!KIDS.includes(id))KIDS.push(id)};
  const syncMembers=list=>{(list||[]).forEach(m=>{if(m.id!=="yaman"&&m.id!=="judy")addPerson(m.id,m.name,m.icon)});KIDS=KIDS.filter(id=>id==="yaman"||id==="judy"||(list||[]).some(m=>m.id===id));Object.keys(PEOPLE).forEach(id=>{if(id!=="parent"&&!KIDS.includes(id))delete PEOPLE[id]});if(area!=="home"&&area!=="parent"&&!PEOPLE[area])area="home"};
  const TIMERS=[0,5,10,15,20,30,45,60];
  const PRAYER_KEYS=[["fajr","الفجر"],["sunrise","الشروق"],["dhuhr","الظهر"],["asr","العصر"],["maghrib","المغرب"],["isha","العشاء"]];

  /* ======================= state ======================= */
  const qs=new URLSearchParams(location.search);
  let stored="";try{stored=localStorage.getItem("hero-area")||""}catch{}
  const isMid=v=>/^u[0-9a-f]{8}$/.test(v||"");
  [qs.get("area"),stored].forEach(v=>{if(isMid(v))addPerson(v)});
  let area=(PEOPLE[qs.get("area")]||qs.get("area")==="home")?qs.get("area"):(PEOPLE[stored]?stored:"home");
  let pview="today";
  const pending=new Map();
  let family={},tick={},dashboard=null,child={},prayer=null,school={},weekly=[],ach=[],kidStats={},apps=null;
  let loading=true,pin="",pinBusy=false,pinError="";
  let focusId={};
  let projects=[],chosenProjects=new Set(),importTasks=[],chosenTasks=new Set();
  let draft=newDraft();
  let help={task:null,member:"",mode:"full",question:"",loading:false,result:null,checked:new Set()};
  let breathTimer=null;
  function newDraft(o={}){return{step:1,who:"yaman",type:"study",points:15,title:"",note:"",time:"",timer:0,sl:[],date:"",editId:null,...o}}

  /* ======================= helpers ======================= */
  const $=id=>document.getElementById(id);
  const iso=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
  const today=()=>iso(new Date());
  let cal={month:today().slice(0,7),sel:today(),events:[],tasks:[],showTasks:true,who:""};
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
  const allTasks=()=>KIDS.flatMap(k=>child[k]?.tasks||[]);
  const findTask=id=>allTasks().find(t=>t.id===id)||(cal.tasks||[]).find(t=>t.id===id);
  const stats=m=>{const l=(child[m]?.tasks||[]).filter(t=>!isPrayer(t));const done=l.filter(t=>t.done).length;return{total:l.length,done,open:l.length-done}};
  function buzz(ms=25){try{navigator.vibrate&&navigator.vibrate(ms)}catch{}}
  /* ---- completion sound (soft two-note chime, no audio files) ---- */
  let soundOn=true;try{soundOn=localStorage.getItem("hero-sound")!=="off"}catch{}
  /* calm mode: no confetti/animation, one soft tone, fewer numbers, neutral wording */
  let lastFocus="";
  const extra={};
  let calm=true;try{calm=localStorage.getItem("hero-calm")!=="off"}catch{}
  let actx=null;
  /* synth engine: oscillator + optional pitch glide, through a light echo for a "sparkly" feel */
  let bus=null;
  function getBus(){
    if(bus)return bus;
    const inp=actx.createGain(),comp=actx.createDynamicsCompressor(),dl=actx.createDelay(),fb=actx.createGain(),wet=actx.createGain();
    dl.delayTime.value=.17;fb.gain.value=.28;wet.gain.value=.22;
    inp.connect(comp);inp.connect(dl);dl.connect(fb);fb.connect(dl);dl.connect(wet);wet.connect(comp);comp.connect(actx.destination);
    return bus=inp;
  }
  function tone(freq,at,len,vol,type,glideTo){
    const o=actx.createOscillator(),g=actx.createGain(),t=actx.currentTime+at;
    o.type=type||"sine";o.frequency.setValueAtTime(freq,t);
    if(glideTo)o.frequency.exponentialRampToValueAtTime(glideTo,t+len*.85);
    g.gain.setValueAtTime(0.0001,t);g.gain.linearRampToValueAtTime(vol,t+0.012);g.gain.exponentialRampToValueAtTime(0.0001,t+len);
    o.connect(g);g.connect(getBus());o.start(t);o.stop(t+len+0.05);
  }
  const N={C4:261.63,D4:293.66,E4:329.63,F4:349.23,G4:392,A4:440,B4:493.88,C5:523.25,D5:587.33,E5:659.25,F5:698.46,G5:783.99,A5:880,B5:987.77,C6:1046.5,D6:1174.66,E6:1318.51,G6:1567.98,C7:2093};
  const seq=(notes,gap,len,vol,type)=>notes.forEach((f,i)=>tone(typeof f==="string"?N[f]:f,i*gap,len,vol,type));
  /* ---- selectable tones (synthesised, no audio files); choice is stored per device ---- */
  const TONES={
    auto:{n:"تلقائي"},
    none:{n:"بدون صوت"},
    coin:{n:"🪙 عملة",p:()=>{tone(N.B5,0,.09,.13,"square");tone(N.E6,.08,.5,.13,"square")}},
    level:{n:"🎮 مستوى جديد",p:()=>seq(["C5","E5","G5","C6","E6"],.075,.28,.15,"triangle")},
    tada:{n:"🎉 تاداا",p:()=>{seq(["G4","C5"],.11,.16,.16,"triangle");["C5","E5","G5","C6"].forEach(f=>tone(f,.28,.9,.1,"triangle"))}},
    star:{n:"⭐ نجمة",p:()=>seq(["E6","C6","G6","E6","C7"],.09,.4,.09)},
    magic:{n:"✨ سحر",p:()=>{tone(400,0,.45,.1,"sine",1800);seq(["C6","E6","G6","C7"],.07,.4,.07)}},
    bubble:{n:"🫧 فقاعة",p:()=>{tone(320,0,.14,.16,"sine",900);tone(500,.12,.16,.13,"sine",1200)}},
    boing:{n:"🦘 نطّة",p:()=>{tone(180,0,.18,.18,"triangle",620);tone(620,.17,.3,.14,"triangle",260)}},
    xylo:{n:"🎶 إكسيليفون",p:()=>seq(["C5","D5","E5","G5","E5","G5","C6"],.09,.35,.17,"triangle")},
    victory:{n:"🏆 نصر",p:()=>{seq(["G4","G4","G4"],.1,.12,.15,"square");tone(N.C5,.34,.16,.15,"square");tone(N.G4,.5,.1,.13,"square");["C5","E5","G5"].forEach(f=>tone(f,.62,.9,.1,"triangle"))}},
    chime:{n:"🔔 جرس",p:()=>{tone(659.25,0,.32,.2);tone(987.77,.09,.42,.2)}},
    bell:{n:"🛎 ناقوس",p:()=>{tone(880,0,.9,.14);tone(1760,0,.6,.05)}},
    soft:{n:"🌙 هادئ",p:()=>tone(660,0,.55,.1)},
    pop:{n:"نقرة",p:()=>tone(520,0,.08,.14)}
  };
  const TONE_EVENTS=[
    {k:"task",n:"إنهاء مهمة",d:"عند الضغط على «تم»"},
    {k:"check",n:"تعليم خطوة (checkbox)",d:"عند تعليم خطوة في القائمة"},
    {k:"prayer",n:"إتمام صلاة",d:"عند تعليم صلاة كمنجزة"},
    {k:"all",n:"إنهاء كل مهام اليوم",d:"عند اكتمال اليوم"}
  ];
  const toneSel={};
  TONE_EVENTS.forEach(e=>{let v="auto";try{v=localStorage.getItem("hero-tone-"+e.k)||"auto"}catch{}toneSel[e.k]=TONES[v]?v:"auto"});
  function playTone(id,force){
    if(id==="none")return;
    try{
      actx=actx||new (window.AudioContext||window.webkitAudioContext)();
      if(actx.state==="suspended")actx.resume();
      TONES[id].p();
    }catch{}
  }
  function playEvent(ev,force){
    if(!soundOn&&!force)return;
    let id=toneSel[ev]||"auto";
    if(id==="auto"){
      if(ev==="prayer"||(calm&&ev!=="check"))id="soft";
      else if(ev==="check"){if(calm)return;id="bubble"}
      else id=ev==="all"?"tada":"coin";
    }
    playTone(id);
  }
  function playDone(kind="task"){playEvent(kind==="soft"?"prayer":kind)}
  function confetti(x,y,n=30){
    if(calm||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
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
    family=f;tick=t;dashboard=null;child={};syncMembers(f.members);
    const jobs=[];
    if(f.parentAuthenticated)jobs.push(api(`/api/family/dashboard?date=${today()}`).then(d=>dashboard=d).catch(()=>null));
    if(f.parentAuthenticated)jobs.push(api("/api/family/stats").then(d=>ach=d.members||[]).catch(()=>null));
    for(const m of KIDS)if(!f.parentAuthenticated&&f[`${m}Authenticated`])jobs.push(api(`/api/family/stats?member=${m}`).then(d=>kidStats[m]=(d.members||[])[0]).catch(()=>null));
    if(f.parentAuthenticated)jobs.push(api("/api/family/weekly").then(d=>weekly=d.items||[]).catch(()=>null));
    if(f.parentAuthenticated)jobs.push(api("/api/family/school").then(d=>school=d.settings||{}).catch(()=>null));
    for(const m of KIDS)if(f.parentAuthenticated||f[`${m}Authenticated`])jobs.push(api(`/api/family/child/${m}?date=${today()}`).then(d=>child[m]=d).catch(()=>null));
    await Promise.all(jobs);
    for(const id of pending.keys()){const t=findTask(id);if(t)t.done=true}
  }
  async function refresh(){await load();loading=false;render();if(pview==="events"&&family.parentAuthenticated)loadCal()}

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
    if(who!=="parent"&&!family[`${who}PinConfigured`])return `<article class="card login"><div class="avatar" aria-hidden="true">${p.icon}</div><h2>رمز الدخول غير مهيأ</h2><p class="muted">${who==="yaman"||who==="judy"?`أضف ${who.toUpperCase()}_PIN في Railway أولاً.`:"لم يُحدَّد رمز دخول لهذا المستخدم. غيّره من الإعدادات في لوحة الوالدين."}</p></article>`;
    const n=Math.max(4,pin.length);
    return `<article class="card login"><div class="avatar" aria-hidden="true">${p.icon}</div><h2>${who==="parent"?"منطقة الوالدين":`أهلاً ${p.name}!`}</h2><p class="muted">${who==="parent"?"اكتب رمز الوالدين لإدارة مهام العائلة.":"اكتب رمزك السري لتفتح مهامك."}</p><div class="dots" id="dots" aria-label="عدد الأرقام: ${pin.length}">${Array.from({length:n},(_,i)=>`<i class="${i<pin.length?"f":""}"></i>`).join("")}</div><p class="err" id="pinErr" role="alert">${esc(pinError)}</p>${keypad()}</article>`;
  }
  function skeleton(){return `<div class="stack"><div class="skel" style="height:110px"></div><div class="skel"></div><div class="skel" style="height:80px"></div></div>`}
  function topbar(){
    const parentIn=family.parentAuthenticated;
    const lockable=area==="parent"?parentIn:(area!=="home"&&!parentIn&&family[`${area}Authenticated`]);
    const back=(area!=="parent"&&parentIn&&area!=="home")?`<button class="pill" data-area="parent">→ لوحة الوالدين</button>`:`<button class="pill" data-area="home">👥 من أنا؟</button>`;
    return `<div class="topbar">${back}<button class="pill pill-sm" data-action="prefs" aria-label="الإعدادات">⚙️</button>${lockable?`<button class="pill" data-action="lock">🔒 قفل</button>`:""}</div>`;
  }
  const ckHtml=(t,force)=>{const l=t.checklist||[];if(!l.length||(t.done&&!force))return"";const n=l.filter(x=>x.done).length;return `<div class="cklist" role="list" aria-label="خطوات المهمة"><div class="ck-h"><b>الخطوات</b><span>${n}/${l.length}</span></div>${l.map((x,i)=>`<button type="button" role="listitem" class="stp ${x.done?"on":""}" data-action="ck" data-id="${t.id}" data-i="${i}" aria-pressed="${x.done}"><i>✓</i><span>${esc(x.text)}</span></button>`).join("")}</div>`};
  const timeChip=t=>t.suggestedTime?`<span class="tchip">⏰ ${esc(t.suggestedTime)}</span>`:"";
  const timerChip=t=>t.timerMinutes?`<span class="tchip timer">⏱ ${t.timerMinutes} د</span>`:"";

  /* ---- home ---- */
  function homeView(){
    const tile=m=>{
      const p=PEOPLE[m],ok=family.parentAuthenticated||family[`${m}Authenticated`],s=stats(m);
      const st=!ok?"🔒 اضغط لتفتح مهامك":!s.total?"لا توجد مهام اليوم":s.open?`${s.open} ${s.open===1?"مهمة":"مهام"} بانتظارك`:"أنجزت كل شيء 🎉";
      return `<button class="tile" style="--kc:${p.color}" data-area="${m}"><span class="av" aria-hidden="true">${p.icon}</span><span><h2>${p.name}</h2><span class="st">${st}</span></span><span class="go" aria-hidden="true">←</span></button>`;
    };
    const pOpen=family.parentAuthenticated&&dashboard?KIDS.reduce((n,k)=>n+stats(k).open,0):null;
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
  function membersCard(){
    const ms=KIDS.map(id=>{const p=PEOPLE[id],dyn=id!=="yaman"&&id!=="judy";return `<div class="ev-row"><div class="av" aria-hidden="true" style="width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:var(--tint);font-size:1.4rem">${p.icon}</div><div style="flex:1;min-width:0"><div class="t-title">${esc(p.name)}</div><div class="muted small">${dyn?"مستخدم مضاف":"مستخدم أساسي"} · 🏫 ${esc((school[id]||{start:"07:00",end:"14:00"}).start)}–${esc((school[id]||{start:"07:00",end:"14:00"}).end)}</div></div><button class="icon-btn" data-action="school-edit" data-id="${id}" aria-label="ساعات مدرسة ${esc(p.name)}">🏫</button>${dyn?`<button class="icon-btn" data-action="member-pin" data-id="${id}" aria-label="تغيير رمز ${esc(p.name)}">🔑</button><button class="icon-btn" data-action="member-del" data-id="${id}" aria-label="حذف ${esc(p.name)}">🗑</button>`:""}</div>`}).join("");
    return `<article class="card"><div class="card-title"><h2>👥 المستخدمون</h2><span class="count">${KIDS.length}</span></div>${ms}<button class="btn btn-primary btn-big" style="margin-top:14px" data-action="add-member">＋ مستخدم جديد</button><p class="muted small" style="margin-top:8px">لكل مستخدم جديد برنامج يومي ثابت حسب عمره، ورمز دخول خاص به.</p></article>`;
  }
  /* ---- achievements dashboard ---- */
  const DAY_S=["أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة","سبت"];
  const rateTxt=r=>r===null||r===undefined?"—":r+"%";
  function bigRing(r,color){const v=r||0,C=2*Math.PI*44;return `<svg class="sring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="none" stroke="color-mix(in srgb,${color} 18%,#fff)" stroke-width="10"/><circle cx="50" cy="50" r="44" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C*v/100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>`}
  function weekBars(series,color){return `<div class="wbars" role="img" aria-label="إنجاز الأيام السبعة الأخيرة">${series.map(d=>{const h=d.rate===null?6:Math.max(8,d.rate);return `<div class="wb"><i style="height:${h}%;${d.rate===null?"opacity:.25;":d.pending?"opacity:.45;":""}background:${color}"></i><small>${DAY_S[new Date(d.date+"T12:00:00").getDay()]}</small><em>${d.rate===null?"":d.pending?"اليوم":d.rate+"%"}</em></div>`}).join("")}</div>`}
  function deltaHtml(st){if(st.delta===null)return `<span class="dlt flat">نقارن بالأسبوع الماضي بعد أسبوعين</span>`;if(st.delta>0)return `<span class="dlt up">▲ تحسن ${st.delta} نقطة عن الأسبوع الماضي</span>`;if(st.delta<0)return `<span class="dlt down">▼ ${Math.abs(st.delta)} نقطة أقل من الأسبوع الماضي. نبدأ يومًا جديدًا</span>`;return `<span class="dlt flat">ثبات مثل الأسبوع الماضي</span>`}
  function badgesHtml(st){return `<div class="bdg">${st.badges.map(b=>`<div class="bd ${b.earned?"on":""}" title="${esc(b.hint)}"><span class="bd-i" aria-hidden="true">${b.icon}</span><b>${esc(b.title)}</b><small>${b.earned?"حصلت عليه ✓":esc(b.progress)}</small></div>`).join("")}</div>`}
  function statCard(st){
    const color=PEOPLE[st.id]?.color||"#4f46e5";
    return `<article class="card stat" style="--sc:${color}"><div class="kid-head"><div class="av" aria-hidden="true" style="background:${color}">${st.icon}</div><div style="flex:1;min-width:0"><h3>${esc(st.name)}</h3><div class="muted small">${st.level.icon} ${esc(st.level.label)} · ${st.stars} من ${st.badges.length} نجوم</div></div></div>
      <div class="stat-top"><div class="ringbox">${bigRing(st.week.rate,color)}<b>${rateTxt(st.week.rate)}</b><small>هذا الأسبوع</small></div>
      <div class="stat-side"><div class="sline"><span>اليوم</span><b>${st.today.total?`${st.today.done}/${st.today.total} · ${rateTxt(st.today.rate)}`:"لا مهام"}</b></div><div class="sline"><span>الصلوات (الأسبوع)</span><b>${st.week.prayersTotal?`${st.week.prayersDone}/${st.week.prayersTotal}`:"—"}</b></div><div class="sline"><span>أيام متتالية ممتازة</span><b>🔥 ${st.streak}</b></div></div></div>
      ${deltaHtml(st)}${weekBars(st.series,color)}<h4 class="sh">النجوم</h4>${badgesHtml(st)}</article>`;
  }
  function statsView(){
    if(!ach.length)return `<article class="card"><div class="empty"><b>📊</b>لا توجد بيانات بعد. أنجزوا بعض المهام وسترى النسب هنا.</div></article>`;
    return ach.map(statCard).join("");
  }
  function kidStarsFold(m){
    const st=kidStats[m];if(!st)return "";
    const earned=st.badges.filter(b=>b.earned);
    return `<article class="card"><details class="fold"><summary>⭐ نجومي (${earned.length}/${st.badges.length})</summary><div style="margin-top:10px"><div class="sline"><span>إنجاز هذا الأسبوع</span><b>${rateTxt(st.week.rate)}</b></div>${deltaHtml(st)}${badgesHtml(st)}</div></details></article>`;
  }
  function appsCard(){
    if(!apps)return `<article class="card"><div class="card-title"><h2>🔒 خصوصية تطبيقاتي</h2></div><p class="muted">جارٍ التحميل…</p></article>`;
    if(!apps.configured)return `<article class="card"><div class="card-title"><h2>🔒 خصوصية تطبيقاتي</h2></div><p class="muted">للتحكم في تطبيقاتك على Vercel من هنا، أنشئ رمز وصول من vercel.com/account/tokens وأضفه في Railway باسم <b>VERCEL_TOKEN</b>. إن كان لديك فريق أضف أيضًا <b>VERCEL_TEAM_ID</b>.</p></article>`;
    if(apps.error)return `<article class="card"><div class="card-title"><h2>🔒 خصوصية تطبيقاتي</h2></div><p class="muted">${esc(apps.error)}</p><button class="btn btn-soft btn-sm" data-action="apps-reload">إعادة المحاولة</button></article>`;
    const rows=apps.items.map(a=>`<div class="ev-row"><div style="flex:1;min-width:0"><div class="t-title">${esc(a.name)}</div><div class="muted small">${a.private?"🔒 خاص: يحتاج تسجيل دخول Vercel":"🌐 عام: يفتحه أي شخص لديه الرابط"}</div></div><button class="btn ${a.private?"btn-soft":"btn-danger"} btn-sm" data-action="app-toggle" data-id="${a.id}" data-name="${esc(a.name)}" data-private="${a.private?1:0}">${a.private?"اجعله عامًا":"اجعله خاصًا"}</button></div>`).join("");
    return `<article class="card"><div class="card-title"><h2>🔒 خصوصية تطبيقاتي</h2><span class="count">${apps.items.length}</span></div>${rows||`<div class="empty"><b>📦</b>لا توجد تطبيقات</div>`}<p class="muted small" style="margin-top:8px">الخاص يحميه Vercel بتسجيل الدخول. العام يعني أن أي شخص يملك الرابط يرى التطبيق وبياناته.</p></article>`;
  }
  function weeklyCard(){
    const who=a=>a==="family"?"كل العائلة":(PEOPLE[a]?.name||a);
    const rows=weekly.filter(w=>w.enabled).map(w=>{const ty=typeOf(w.type),days=w.days.length?w.days.map(d=>DAYS_AR[d]).join("، "):"لم تُحدَّد الأيام بعد";
      return `<div class="ev-row"><div class="av" aria-hidden="true" style="width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:color-mix(in srgb,${ty.c} 16%,#fff);font-size:1.4rem">${ty.i}</div><div style="flex:1;min-width:0"><div class="t-title">${esc(w.title)}</div><div class="muted small">${esc(who(w.assignee))} · ${esc(days)} · ${esc(w.time)} · ${w.minutes} د</div></div><button class="icon-btn" data-action="weekly-edit" data-id="${w.id}" aria-label="تعديل: ${esc(w.title)}">✏️</button></div>`}).join("");
    return `<article class="card"><div class="card-title"><h2>🗓 الالتزامات الأسبوعية</h2><span class="count">${weekly.filter(w=>w.enabled).length}</span></div>${rows||`<div class="empty"><b>🗓</b>لا توجد التزامات</div>`}<button class="btn btn-primary btn-big" style="margin-top:14px" data-action="weekly-edit" data-id="">＋ التزام جديد</button><p class="muted small" style="margin-top:8px">دروس خاصة، زيارات، أنشطة ثابتة. تظهر في البرنامج وفي التقويم، ويُرتَّب باقي اليوم حولها تلقائيًا.</p></article>`;
  }
  function weeklyModal(id){
    const w=weekly.find(x=>x.id===id)||{id:"",assignee:"family",title:"",type:"outing",days:[],time:"16:30",minutes:120,note:"",checklist:[],enabled:true};
    window.__wkDays=new Set(w.days);
    const types=["lesson","outing","study","movement","social","other"];
    modal(w.id?"تعديل الالتزام":"التزام أسبوعي جديد",`<form class="form" id="weeklyForm" data-id="${esc(w.id)}">
      <label class="field"><span>لمن؟</span><select id="wkWho"><option value="family" ${w.assignee==="family"?"selected":""}>كل العائلة (يظهر لكل طفل)</option>${KIDS.map(k=>`<option value="${k}" ${w.assignee===k?"selected":""}>${esc(PEOPLE[k].name)}</option>`).join("")}</select></label>
      <label class="field"><span>العنوان</span><input id="wkTitle" type="text" required maxlength="80" value="${esc(w.title)}" autocomplete="off"></label>
      <label class="field"><span>النوع</span><select id="wkType">${types.map(t=>`<option value="${t}" ${w.type===t?"selected":""}>${TYPES[t].i} ${TYPES[t].l}</option>`).join("")}</select></label>
      <div><span class="label">الأيام</span><div class="seg wrap" role="group">${DAYS_AR.map((d,i)=>`<button type="button" class="${w.days.includes(i)?"on":""}" data-action="wk-day" data-v="${i}">${d}</button>`).join("")}</div></div>
      <div class="grid2" style="gap:12px"><label class="field"><span>الوقت</span><input id="wkTime" type="time" value="${esc(w.time)}" required></label><label class="field"><span>المدة (دقائق)</span><input id="wkMin" type="number" min="5" max="600" inputmode="numeric" value="${w.minutes}" required></label></div>
      <label class="field"><span>ملاحظة (اختياري)</span><input id="wkNote" type="text" maxlength="300" value="${esc(w.note)}" autocomplete="off"></label>
      <button class="btn btn-primary btn-big" type="submit">حفظ</button>
      ${w.id?`<button class="btn btn-danger" type="button" data-action="weekly-del" data-id="${esc(w.id)}">🗑 إيقاف الالتزام</button>`:""}</form>`);
  }
  function memberModal(){
    const icons=["🦸","🦸‍♀️","🌟","🚀","🦁","🐼","🎨","📚"];
    modal("مستخدم جديد",`<form class="form" id="memberForm">
      <label class="field"><span>الاسم</span><input id="mName" type="text" required maxlength="24" autocomplete="off"></label>
      <label class="field"><span>العمر</span><input id="mAge" type="number" inputmode="numeric" min="3" max="30" required placeholder="مثال: 11"></label>
      <div><span class="label">الرمز التعبيري</span><div class="seg wrap" role="group" id="mIcons">${icons.map((x,i)=>`<button type="button" class="${i===2?"on":""}" data-action="m-icon" data-v="${x}">${x}</button>`).join("")}</div></div>
      <label class="field"><span>رمز الدخول (4 إلى 8 أرقام)</span><input id="mPin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autocomplete="new-password"></label>
      <p class="hint">يحصل المستخدم على برنامج يومي ثابت يناسب عمره، فيه مراجعة ونظافة وصلوات وراحة، ولكل مهمة خطوات واضحة.</p>
      <button class="btn btn-primary btn-big" type="submit">إضافة</button></form>`);
    window.__mIcon="🌟";
  }
  const DAYS_AR=["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
  const ageOf=id=>(family.members||[]).find(m=>m.id===id)?.age||(id==="judy"?15:id==="yaman"?15:10);
  function schoolModal(id){
    const sc=school[id]||{start:"07:00",end:"14:00",days:[1,2,3,4,6]};
    window.__schoolDays=new Set(sc.days);
    modal(`🏫 ساعات مدرسة ${PEOPLE[id]?.name||""}`,`<form class="form" id="schoolForm" data-id="${id}">
      <label class="field"><span>العمر (يحدد نوع البرنامج)</span><input id="scAge" type="number" min="3" max="30" inputmode="numeric" value="${ageOf(id)}" required></label>
      <div class="grid2" style="gap:12px"><label class="field"><span>الخروج من البيت</span><input id="scStart" type="time" value="${esc(sc.start)}" required></label><label class="field"><span>العودة نحو</span><input id="scEnd" type="time" value="${esc(sc.end)}" required></label></div>
      <div><span class="label">أيام المدرسة</span><div class="seg wrap" role="group" id="scDays">${DAYS_AR.map((d,i)=>`<button type="button" class="${sc.days.includes(i)?"on":""}" data-action="sc-day" data-v="${i}">${d}</button>`).join("")}</div></div>
      <p class="hint">عند الحفظ يُعاد بناء برنامج اليوم والأيام القادمة تلقائيًا. المهام التي أنجزتها أو أضفتها بنفسك لا تُحذف.</p>
      <button class="btn btn-primary btn-big" type="submit">حفظ</button></form>`);
  }
  function memberPinModal(id){
    modal(`تغيير رمز ${PEOPLE[id]?.name||""}`,`<form class="form" id="memberPinForm" data-id="${id}">
      <label class="field"><span>الرمز الجديد (4 إلى 8 أرقام)</span><input id="mNewPin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required autocomplete="new-password"></label>
      <button class="btn btn-primary btn-big" type="submit">حفظ الرمز</button></form>`);
  }
  function tickView(){
    const status=!tick.configured?`<div class="tt"><span class="dot"></span><div><b>TickTick غير مهيأ</b><div class="muted">التطبيق يعمل بشكل طبيعي. أكمل متغيرات TickTick في Railway لتفعيل المزامنة.</div></div></div>`
      :!tick.connected?`<div class="tt"><span class="dot"></span><div style="flex:1"><b>TickTick غير متصل</b><div class="muted">اربطه لاستيراد مهام اليوم وإرسال مهام Hero إليه.</div></div></div><a class="btn btn-primary btn-big" style="margin-top:14px" href="/auth/ticktick">ربط TickTick</a>`
      :`<div class="tt"><span class="dot on"></span><div style="flex:1"><b>TickTick متصل</b><div class="muted">مهمة جديدة هنا تصل إلى TickTick، وإنجازها هنا يُكمّلها هناك.</div></div></div>`;
    const steps=tick.connected?`<ol class="howto" style="margin-top:16px"><li><b>اختر القوائم</b><div class="muted">حدد القوائم التي تريد الاستيراد منها.</div><button class="btn btn-line btn-sm" style="margin-top:8px" data-action="projects">📋 اختيار القوائم</button></li><li><b>استورد مهام اليوم</b><div class="muted">اختر المهام وحدد لمن تُضاف.</div><button class="btn btn-soft btn-sm" style="margin-top:8px" data-action="import">⬇️ استيراد مهام اليوم</button></li></ol>`:"";
    return `<article class="card"><div class="card-title"><h2>🔗 TickTick</h2></div>${status}${steps}</article>`;
  }

  /* ---- parent ---- */
  const ckOpen=new Set();
  document.addEventListener("toggle",e=>{const d=e.target;if(d&&d.matches&&d.matches("details[data-ck]")){d.open?ckOpen.add(d.dataset.ck):ckOpen.delete(d.dataset.ck)}},true);
  function parentTaskRow(t,m){
    const ty=typeOf(t.type);
    const meta=`${timeChip(t)}${timerChip(t)}<span>${ty.l}</span>${isPrayer(t)?"":`<span>⭐ ${t.points}</span>`}${t.status==="in_progress"?"<span>▶ بدأ</span>":""}${t.ticktickTaskId?"<span>TickTick</span>":""}`;
    const note=t.note?`<span class="t-note">${esc(t.note)}</span>`:"";
    return `<div class="trow ${t.done?"is-done":""}"><div class="task ${t.done?"done":""}" style="--tc:${ty.c}"><button class="t-main" data-action="edit-task" data-id="${t.id}" aria-label="تعديل: ${esc(t.title)}"><span class="t-ico" aria-hidden="true">${ty.i}</span><span class="t-body"><span class="t-title">${esc(t.title)}</span><span class="t-meta">${meta}</span>${note}</span></button><div class="t-act">${t.done?`<span class="check on" aria-label="منجزة">✓</span>`:`<button class="check" data-action="complete" data-member="${m}" data-id="${t.id}" aria-label="تأكيد إنجاز: ${esc(t.title)}">✓</button>`}</div></div>${(t.checklist||[]).length?`<details class="fold ck-fold" data-ck="${t.id}" ${ckOpen.has(t.id)?"open":""}><summary><span>☑ الخطوات</span><b>${(t.checklist||[]).filter(x=>x.done).length}/${t.checklist.length}</b></summary>${ckHtml(t,true).replace(/^<div class="cklist"[^>]*>/,m0=>m0)}</details>`:""}</div>`;
  }
  let pkid=null;
  function kidTabs(){
    const cur=KIDS.includes(pkid)?pkid:KIDS[0];
    return `<div class="ktabs" role="tablist">${KIDS.map(k=>{const st=stats(k);return `<button type="button" role="tab" aria-selected="${k===cur}" class="${k===cur?"on":""}" data-action="pkid" data-k="${k}" style="--kc:${PEOPLE[k].color||"var(--brand)"}"><span aria-hidden="true">${PEOPLE[k].icon}</span>${esc(PEOPLE[k].name)}<em>${st.open}</em></button>`}).join("")}</div>`;
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
      :`<div class="empty"><b>🌱</b>لا توجد مهام لـ${p.name} اليوم<div style="margin-top:10px"><button class="btn btn-soft btn-sm" data-action="seed" data-who="${m}">📅 طبّق برنامج اليوم</button></div></div>`;
    return `<article class="card kid-card" data-kid="${m}"><div class="kid-head"><div class="av" aria-hidden="true">${p.icon}</div><div style="flex:1"><h3>${p.name}</h3><div class="muted">${s.total?`${s.done} من ${s.total} منجزة`:"لا توجد مهام اليوم"}</div></div><span class="chip gold">⭐ ${pts}</span><button class="pill pill-sm" data-area="${m}" aria-label="فتح شاشة ${p.name}">فتح ←</button></div><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="--w:${pct}%"></i></div><div class="list">${body}</div><div class="actions"><button class="btn btn-soft btn-sm" data-action="add-task" data-who="${m}">＋ مهمة لـ${p.name}</button><button class="btn btn-line btn-sm" data-area="${m}">شاهد كما يراها ←</button></div><div class="actions"><button class="btn btn-line btn-sm" data-action="program" data-who="${m}">📅 برنامج اليوم</button><button class="btn btn-line btn-sm" data-action="endday" data-member="${m}">🌙 تقرير نهاية اليوم</button></div></article>`;
  }
  const EVC=id=>id==="yaman"?"#0891b2":id==="judy"?"#d6246e":id==="family"?"#e0a100":"#12a37a";
  const evName=id=>id==="family"?"كل العائلة":(PEOPLE[id]?.name||"");
  async function loadCal(){
    const [y,m]=cal.month.split("-").map(Number);
    const from=`${cal.month}-01`,to=`${cal.month}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}`;
    const [e,t]=await Promise.all([api(`/api/family/events?from=${from}&to=${to}`).catch(()=>({})),api(`/api/family/calendar-tasks?from=${from}&to=${to}`).catch(()=>({}))]);
    cal.events=e.events||[];cal.tasks=t.tasks||[];
    render();
  }
  function calendarHtml(){
    const [y,m]=cal.month.split("-").map(Number);
    const first=new Date(y,m-1,1),days=new Date(y,m,0).getDate(),lead=first.getDay();
    const who=cal.who&&(cal.who==="all"||KIDS.includes(cal.who))?cal.who:KIDS[0];
    const by={},tk={};for(const e of cal.events)if(who==="all"||e.assignee===who||e.assignee==="family")(by[e.date]=by[e.date]||[]).push(e);
    if(cal.showTasks)for(const t of cal.tasks)if(who==="all"||t.assignee===who)(tk[t.date]=tk[t.date]||[]).push(t);
    const whoTabs=`<div class="ktabs" role="tablist">${KIDS.map(k=>`<button type="button" role="tab" aria-selected="${who===k}" class="${who===k?"on":""}" data-action="cal-who" data-k="${k}" style="--kc:${EVC(k)}"><span aria-hidden="true">${PEOPLE[k].icon}</span>${esc(PEOPLE[k].name)}</button>`).join("")}<button type="button" role="tab" aria-selected="${who==="all"}" class="${who==="all"?"on":""}" data-action="cal-who" data-k="all" style="--kc:var(--brand)">الكل</button></div>`;
    const names=["أحد","اثنين","ثلاثاء","أربعاء","خميس","جمعة","سبت"];
    let cells=names.map(n=>`<div class="cal-h">${n}</div>`).join("");
    for(let i=0;i<lead;i++)cells+=`<div class="cal-c off"></div>`;
    for(let d=1;d<=days;d++){
      const ds=`${cal.month}-${String(d).padStart(2,"0")}`,ev=by[ds]||[],ts=tk[ds]||[];
      const colors=[...new Set(ev.map(e=>e.assignee))].slice(0,4);
      const fp=t=>t.type==="prayer"&&t.source==="prayer";const prDone=ts.filter(t=>fp(t)&&t.done).length,prAll=ts.filter(fp).length;
      const bars=KIDS.map(k=>{const l=ts.filter(t=>t.assignee===k&&t.type!=="prayer"&&t.type!=="school");if(!l.length)return"";const done=l.filter(t=>t.done).length;return `<u style="--kc:${EVC(k)};--w:${Math.round(done/l.length*100)}%" title="${esc(PEOPLE[k].name)} ${done}/${l.length}"></u>`}).join("");
      cells+=`<button type="button" class="cal-c ${ds===today()?"today":""} ${ds===cal.sel?"sel":""} ${(ev.length||ts.length)?"has":""}" data-action="cal-day" data-d="${ds}" aria-label="${d}، ${ev.length} مواعيد، ${ts.length} مهام"><b>${d}</b><span class="cal-dots">${colors.map(c=>`<i style="background:${EVC(c)}"></i>`).join("")}</span><span class="cal-bars">${bars}</span>${prAll&&who!=="all"?`<small class="cal-pr ${prDone===prAll?"all":""}">🕌${prDone}/${prAll}</small>`:""}</button>`;
    }
    const title=first.toLocaleDateString("ar",{month:"long",year:"numeric"});
    const legend=[["family","كل العائلة"],...KIDS.map(k=>[k,PEOPLE[k].name])].map(([k,l])=>`<span class="cal-lg"><i style="background:${EVC(k)}"></i>${esc(l)}</span>`).join("");
    const dayEv=(by[cal.sel]||[]).map(e=>({k:"ev",time:e.time,o:e})),dayTk=(tk[cal.sel]||[]).map(t=>({k:"tk",time:t.time,o:t}));
    const items=[...dayEv,...dayTk].sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99")||(a.k==="ev"?-1:1));
    const row=it=>{
      if(it.k==="ev"){const e=it.o;return `<div class="cal-ev" style="--ec:${EVC(e.assignee)}"><div class="cal-t">${e.time?esc(e.time):"طوال اليوم"}</div><div style="flex:1;min-width:0"><div class="t-title">📌 ${esc(e.title)}</div><div class="muted small">${esc(evName(e.assignee))}</div></div><button class="icon-btn" data-action="delete-event" data-id="${e.id}" aria-label="حذف الموعد: ${esc(e.title)}">🗑</button></div>`}
      const t=it.o,ty=typeOf(t.type);return `<button type="button" class="cal-ev cal-tk ${t.done?"done":""} ${t.type==="prayer"?"cal-pray":""}" data-action="edit-task" data-id="${t.id}" style="--ec:${EVC(t.assignee)}" aria-label="فتح المهمة: ${esc(t.title)}"><div class="cal-t">${t.time?esc(t.time):"—"}</div><div style="flex:1;min-width:0"><div class="t-title">${ty.i} ${esc(t.title)}</div><div class="muted small">${esc(evName(t.assignee))}${t.timer?` · ${t.timer} د`:""}</div></div><span class="cal-ok" aria-label="${t.done?"منجزة":"غير منجزة"}">${t.done?"✓":""}</span><span class="cal-go" aria-hidden="true">‹</span></button>`};
    const prs=items.filter(x=>x.k==="tk"&&x.o.type==="prayer"&&x.o.source==="prayer"),prDn=prs.filter(x=>x.o.done).length;
    const prSum=prs.length?`<div class="cal-prsum"><span>🕌 الصلوات: ${prDn} من ${prs.length}</span><i aria-hidden="true">${prs.map(x=>`<u class="${x.o.done?"on":""}"></u>`).join("")}</i></div>`:"";
    const dayHtml=items.length?items.map(row).join(""):`<div class="empty" style="padding:14px 0"><b>🗓</b>لا مواعيد ولا مهام في هذا اليوم</div>`;
    return `<article class="card">${whoTabs}<div class="cal-nav" style="margin-top:12px"><button class="icon-btn" data-action="cal-nav" data-n="1" aria-label="الشهر التالي">›</button><h2>${title}</h2><button class="icon-btn" data-action="cal-nav" data-n="-1" aria-label="الشهر السابق">‹</button></div><div class="cal-grid">${cells}</div><div class="cal-legend">${legend}<label class="cal-tg"><input type="checkbox" data-action="cal-tasks" ${cal.showTasks?"checked":""}> إظهار المهام</label></div></article><article class="card"><div class="card-title"><h2>${dayLabel(cal.sel)}</h2><span class="count">${items.length}</span></div>${prSum}${dayHtml}${quoteHtml(quoteFor(cal.sel,"effort"))}<div class="actions" style="margin-top:14px"><button class="btn btn-primary" data-action="add-task" data-who="${who==="all"?KIDS[0]:who}" data-d="${cal.sel}">＋ مهمة</button><button class="btn btn-line" data-action="add-event" data-d="${cal.sel}">＋ موعد</button></div></article>`;
  }
  function eventsView(){
    const events=dashboard.events||[];
    const upcoming=events.length?`<article class="card"><details class="fold"><summary>القادمة (${events.length})</summary><div style="margin-top:8px">${events.map(e=>`<div class="ev-row"><div class="ev-day" style="background:${EVC(e.assignee)}22;color:inherit">${dayLabel(e.date)}${e.time?`<br>${esc(e.time)}`:""}</div><div style="flex:1;min-width:0"><div class="t-title">${esc(e.title)}</div><div class="muted small">${esc(evName(e.assignee))}</div></div></div>`).join("")}</div></details></article>`:"";
    return calendarHtml()+upcoming;
  }
  function parentView(){
    if(!family.parentAuthenticated)return `${topbar()}<div class="stack">${loginCard("parent")}</div>`;
    if(!dashboard)return `${topbar()}<div class="stack"><article class="card login"><h2>تعذر تحميل لوحة العائلة</h2><p class="muted">تحقق من الاتصال بقاعدة البيانات ثم أعد المحاولة.</p><div class="row" style="justify-content:center;margin-top:12px"><button class="btn btn-primary" data-action="reload">إعادة المحاولة</button></div></article></div>`;
    const openAll=KIDS.reduce((n,k)=>n+stats(k).open,0),doneAll=KIDS.reduce((n,k)=>n+stats(k).done,0);
    const events=dashboard.events||[];
    const nextEv=events.find(e=>e.date===today());
    const prev=dashboard.previousIncomplete;
    let body="";
    if(pview==="today"){
      body=`<div class="actions"><button class="btn btn-primary" data-action="add-task">＋ مهمة جديدة</button><button class="btn btn-soft" data-action="plan">✨ خطة اليوم الذكية</button></div>
      ${prev?.total?`<div class="soft-note">🌙 بقيت ${prev.total} ${prev.total===1?"مهمة":"مهام"} من أمس (${KIDS.map(k=>`${PEOPLE[k].name} ${prev.summary?.[k]||0}`).join("، ")}). لا نرحّلها كلها، اختاروا مهمة واحدة سهلة للبداية.</div>`:""}
      ${nextEv?`<div class="event" style="width:100%">📌 اليوم${nextEv.time?` ${esc(nextEv.time)}`:""}: ${esc(nextEv.title)}</div>`:""}${kidTabs()}${kidCard(KIDS.includes(pkid)?pkid:KIDS[0])}<button class="btn btn-line" data-action="bedtime">🌙 رسالة قبل النوم ليَمان</button>`;
    }else if(pview==="events")body=eventsView();
    else if(pview==="stats")body=statsView();
    else body=membersCard()+weeklyCard()+appsCard()+prayerCard()+tickView();
    const head=pview==="today"?hero(greeting(),openAll?`بقي ${openAll} ${openAll===1?"مهمة":"مهام"} مفتوحة لليوم`:(doneAll?"أنجز الجميع كل المهام. يوم رائع!":"لا توجد مهام لليوم بعد."),"🏠"):hero(pview==="events"?"المواعيد":pview==="stats"?"الإنجاز":"الإعدادات",pview==="events"?"جدول العائلة القادم":pview==="stats"?"نسبة الإنجاز والنجوم لكل واحد":"الصلاة والمزامنة","🏠",false);
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
      const ty=typeOf(cur.type),started=cur.status==="in_progress"||cur.startedAt;const needStart=calm&&cur.timerMinutes&&!started;
      focus=`<article class="card focus pop" data-fid="${cur.id}" style="--tc:${ty.c}"><span class="kicker">${calm?"الآن":(rest.length||done.length?"مهمتك الآن":"مهمتك اليوم")}</span><div class="big-icon" aria-hidden="true">${ty.i}</div><h2>${esc(cur.title)}</h2>${calm&&started?"":`<div class="meta">${timeChip(cur)}${timerChip(cur)}<span class="tchip">${ty.l}</span></div>`}${cur.note?`<p class="note"><span aria-hidden="true">💡</span> ${esc(cur.note)}</p>`:""}${started?`<div class="timerbox" data-timer data-tid="${cur.id}" data-start="${esc(cur.startedAt||"")}" data-min="${cur.timerMinutes||0}"><small>${cur.timerMinutes?"الوقت المتبقي":"مرّ منذ البداية"}</small><div class="twrap">${cur.timerMinutes?`<svg class="tring" viewBox="0 0 120 120" aria-hidden="true"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg" cx="60" cy="60" r="52"/></svg>`:""}<b>--:--</b></div>${cur.timerMinutes?`<button type="button" class="more" hidden data-action="more-time" data-id="${cur.id}">＋ 5 دقائق</button>`:""}</div>`:""}${ckHtml(cur)}${calm?(cur.timerMinutes&&!started?`<p class="reward">المدة: ${cur.timerMinutes} دقيقة</p>`:""):`<p class="reward">⭐ تربح ${cur.points} نقطة${started?"":" · ابدأ الآن لتحصل على مكافأة البداية"}</p>`}${needStart?`<button class="btn btn-primary btn-big" data-action="start" data-member="${m}" data-id="${cur.id}">▶ ابدأ</button>`:`<button class="btn btn-ok btn-big" data-action="complete" data-member="${m}" data-id="${cur.id}">✓ أنجزتها!</button>`}<div class="actions" style="margin-top:12px">${(started||calm)?"":`<button class="btn btn-soft btn-sm" data-action="start" data-member="${m}" data-id="${cur.id}">▶ ابدأ الآن</button>`}<button class="btn btn-soft btn-sm" data-action="help" data-member="${m}" data-id="${cur.id}">🤝 ساعدني</button>${cur.type==="breathing"?`<button class="btn btn-soft btn-sm" data-action="breathe">🌬️ نتنفس معاً</button>`:""}${rest.length?`<button class="btn ${calm?"btn-quiet":"btn-line"} btn-sm" data-action="later" data-member="${m}" data-id="${cur.id}">ليس الآن</button>`:""}</div></article>`;
    }else if(tasks.length)focus=`<article class="card celebrate pop"><div class="trophy" aria-hidden="true">🏆</div><h2>أحسنت يا ${p.name}!</h2><p class="muted">ربحت ${pts} نقطة اليوم. استرح، فقد استحققت ذلك.</p><button class="btn btn-soft" style="margin-top:14px" data-action="endday" data-member="${m}">🌙 تقرير يومي</button></article>`;
    const events=(d.events||[]);
    const prevN=d.previousIncomplete?.incomplete||0;
    const row=t=>{const ty=typeOf(t.type);return `<button class="task" style="--tc:${ty.c}" data-action="focus" data-member="${m}" data-id="${t.id}" aria-label="ابدأ: ${esc(t.title)}"><span class="t-ico" aria-hidden="true">${ty.i}</span><span class="t-body"><span class="t-title">${esc(t.title)}</span><span class="t-meta">${timeChip(t)}${timerChip(t)}<span>⭐ ${t.points}</span></span></span><span aria-hidden="true">←</span></button>`};
    return `${topbar()}${calm?`<div class="greet"><span class="g-ico" aria-hidden="true">${p.icon}</span><b>${greeting()} ${p.name}</b></div>`:hero(`${greeting()} ${p.name}`,p.sub,p.icon)}
    <div class="stack">
      ${calm?`<div class="slim" role="status"><b>${done.length?`أنجزت ${done.length}`:"لم نبدأ بعد"}</b>${open.length&&open.length<=5?`<span>بقي ${open.length}</span>`:""}<i class="slim-bar" aria-hidden="true"><u style="width:${tasks.length?Math.round(done.length/tasks.length*100):0}%"></u></i></div>`:`<article class="card"><div class="progress">${ring(done.length,tasks.length)}<div><div class="progress-msg">${msg}</div><div class="chips"><span class="chip gold">⭐ ${pts} نقطة اليوم</span>${done.length?`<span class="chip ok">✓ ${done.length} منجزة</span>`:""}</div></div></div></article>`}
      ${quoteHtml(quoteFor(today()+m,open.length?(prayers.some(t=>!t.done)&&new Date().getHours()>=12?"prayer":["study","effort","success"][new Date().getDate()%3]):"success"))}
      ${prevN&&!done.length&&!calm?`<div class="soft-note">🌙 أمس بقيت بعض المهام. لا بأس! نبدأ اليوم بخطوة صغيرة واحدة.</div>`:""}
      ${focus}
      ${tutorCard(m)}
      ${prayers.length&&calm?`<article class="card"><details class="fold"><summary>🕌 الصلوات (${prayers.filter(t=>t.done).length}/${prayers.length})</summary><div class="prayers" style="margin-top:10px">${prayers.map(t=>`<button class="pr ${t.done?"done":""}" data-action="complete" data-member="${m}" data-id="${t.id}" ${t.done?"disabled":""} aria-label="${esc(t.title)}">${t.done?"✓":"○"} <span>${esc(t.title.replace("صلاة ","").replace(" في وقتها",""))}</span><small>${esc(t.suggestedTime||"")}</small></button>`).join("")}</div></details></article>`:prayers.length?`<article class="card"><div class="card-title"><h2>🕌 الصلوات</h2></div><div class="prayers">${prayers.map(t=>`<button class="pr ${t.done?"done":""}" data-action="complete" data-member="${m}" data-id="${t.id}" ${t.done?"disabled":""} aria-label="${esc(t.title)}">${t.done?"✓":"○"} <span>${esc(t.title.replace("صلاة ","").replace(" في وقتها",""))}</span><small>${esc(t.suggestedTime||"")}</small></button>`).join("")}</div></article>`:""}
      ${kidStarsFold(m)}
      ${events.length?(calm?`<article class="card"><details class="fold"><summary>📅 مواعيدي اليوم (${events.length})</summary><div class="events" style="margin-top:10px">${events.map(e=>`<div class="event">${e.time?`<time>${esc(e.time)}</time>`:"📌"}${esc(e.title)}</div>`).join("")}</div></details></article>`:`<article class="card"><div class="card-title"><h2>مواعيدي اليوم</h2></div><div class="events">${events.map(e=>`<div class="event">${e.time?`<time>${esc(e.time)}</time>`:"📌"}${esc(e.title)}</div>`).join("")}</div></article>`):""}
      ${rest.length?`<article class="card"><div class="card-title"><h2>${calm?"التالي":"بعدها"}</h2>${calm?"":`<span class="count">${rest.length}</span>`}</div><div class="list">${listOrDetails(rest,calm?1:3,row,calm?"باقي اليوم":"عرض الباقي")}</div></article>`:""}
      ${done.length?`<article class="card"><details class="fold" ${open.length?"":"open"}><summary>أنجزت اليوم (${done.length})</summary><div class="list">${done.map(t=>{const ty=typeOf(t.type);return `<div class="task done" style="--tc:${ty.c}"><span class="t-ico" aria-hidden="true">${ty.i}</span><span class="t-body"><span class="t-title">${esc(t.title)}</span><span class="t-meta"><span>⭐ ${gain(t)}</span></span>${(t.badges||[]).length?`<span class="badges">${t.badges.map(b=>`<span>${esc(b.icon)} ${esc(b.label)}</span>`).join("")}</span>`:""}</span><span class="check on" aria-hidden="true">✓</span></div>`}).join("")}</div></details></article>`:""}
      ${tasks.length&&(open.length===0||new Date().getHours()>=17)?`<button class="btn btn-line" data-action="endday" data-member="${m}">🌙 تقرير يومي</button>`:""}
    </div>`;
  }

  /* ======================= render ======================= */
  const foldState=new Map();
  const foldKey=d=>{if(d.dataset.ck)return"ck:"+d.dataset.ck;const sc=d.closest("[data-kid]");const sm=d.querySelector("summary");return area+"|"+pview+"|"+(sc?sc.dataset.kid:"")+"|"+(sm?sm.textContent.replace(/[\d\/()٠-٩\s]+/g," ").trim():"")};
  document.addEventListener("toggle",e=>{const d=e.target;if(d&&d.matches&&d.matches("details.fold"))foldState.set(foldKey(d),d.open)},true);
  function render(){
    const a=area==="home"?"parent":area;
    document.body.dataset.area=a;document.body.classList.toggle("calm",calm);
    $("themeColor").content=PEOPLE[a].color;
    const y=scrollY;
    $("root").style.minHeight=document.documentElement.scrollHeight+"px";
    $("root").innerHTML=loading?skeleton():(area==="home"?homeView():area==="parent"?parentView():childView(area));
    const pm=!loading&&area==="parent"&&family.parentAuthenticated&&dashboard;
    const nav=$("nav");nav.hidden=!pm;
    nav.innerHTML=pm?`<div class="nav-in">${[["today","📋","اليوم"],["stats","📊","الإنجاز"],["events","📅","المواعيد"],["settings","⚙️","الإعدادات"]].map(([k,i,l])=>`<button class="tab ${pview===k?"active":""}" data-pview="${k}" aria-current="${pview===k}"><span>${i}</span>${l}</button>`).join("")}</div>`:"";
    $("fabRoot").innerHTML="";
    document.querySelectorAll("#root details.fold").forEach(d=>{if(foldState.get(foldKey(d))===true&&!d.open)d.open=true});
    scrollTo({top:y,left:0,behavior:"instant"});
    $("root").style.minHeight="";
    const fc=document.querySelector(".focus[data-fid]"),fid=fc?fc.dataset.fid:"";
    if(calm&&fc&&lastFocus&&fid!==lastFocus){fc.style.opacity="0";requestAnimationFrame(()=>requestAnimationFrame(()=>{fc.style.transition="opacity .45s ease";fc.style.opacity="1"}))}
    lastFocus=fid;
    tickTimers();
  }
  function tickTimers(){
    document.querySelectorAll("[data-timer]").forEach(el=>{
      const start=Date.parse(el.dataset.start)||Date.now(),min=(Number(el.dataset.min)||0)+(Number(extra[el.dataset.tid])||0),b=el.querySelector("b");
      const el_s=Math.floor((Date.now()-start)/1000);
      const fmt=s=>{s=Math.abs(s);return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`};
      if(min){const left=min*60-el_s,over=left<0;el.classList.toggle("over",over);b.textContent=over?"انتهى الوقت":fmt(left);el.querySelector("small").textContent=over?"لا مشكلة، أنهِ بهدوء عندما تكون جاهزاً":"الوقت المتبقي";const more=el.querySelector(".more");if(more)more.hidden=!over;const fg=el.querySelector(".tring .fg");if(fg)fg.style.strokeDashoffset=String(326.7*(1-Math.max(0,Math.min(1,left/(min*60)))))}
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
  function syncDraft(){const t=$("taskTitle"),n=$("taskNote"),tm=$("taskTime"),sp=document.querySelectorAll("[data-step]");if(sp.length)draft.sl=[...sp].map((x,i)=>({t:x.value,d:Boolean((draft.sl[i]||{}).d)}));if(t)draft.title=t.value;if(n)draft.note=n.value;if(tm)draft.time=tm.value}

  function taskModal(){
    const ty=typeOf(draft.type),two=draft.step===2,edit=!!draft.editId;
    const steps=`<div class="steps" aria-hidden="true"><i class="on"></i><i class="${two?"on":""}"></i></div>`;
    const ttl=edit?"تعديل المهمة":"مهمة جديدة";
    if(!two){
      const whos=[...KIDS.map(k=>[k,`${PEOPLE[k].icon} ${PEOPLE[k].name}`]),...(edit||KIDS.length<2?[]:[["both","👫 الجميع"]])];
      modal(`${ttl} · 1 من 2`,`${steps}<div class="form" id="taskStep1">
        <div><span class="label">لمن؟</span><div class="seg" role="group">${whos.map(([k,l])=>`<button type="button" class="${draft.who===k?"on":""}" data-action="d-who" data-v="${k}">${l}</button>`).join("")}</div></div>
        <div><span class="label">نوع المهمة</span><div class="types">${Object.entries(TYPES).map(([k,v])=>`<button type="button" class="${draft.type===k?"on":""}" style="--tc:${v.c}" data-action="d-type" data-v="${k}"><span>${v.i}</span>${v.l}</button>`).join("")}</div></div>
        <button class="btn btn-primary btn-big" type="button" data-action="d-next">التالي ←</button></div>`);
      return;
    }
    const whoLbl=draft.who==="both"?"الجميع":PEOPLE[draft.who].name;
    modal(`${ttl} · 2 من 2`,`${steps}<form class="form" id="taskForm">
      <div class="chips" style="margin:0"><span class="chip">${ty.i} ${ty.l}</span><span class="chip">لـ${whoLbl}</span></div>
      <label class="field"><span>ما المطلوب؟</span><input id="taskTitle" type="text" required maxlength="180" placeholder="جملة قصيرة وواضحة" value="${esc(draft.title)}" autocomplete="off">${ty.s.length?`<div class="sugg">${ty.s.map(s=>`<button type="button" data-action="d-sugg" data-v="${esc(s)}">${esc(s)}</button>`).join("")}</div>`:""}</label>
      <label class="field"><span>الوقت المقترح (اختياري)</span><input id="taskTime" type="time" value="${esc(draft.time)}"></label>
      <div><span class="label">مؤقت (دقائق)</span><div class="seg wrap" role="group">${TIMERS.map(n=>`<button type="button" class="${draft.timer===n?"on":""}" data-action="d-timer" data-v="${n}">${n?n+" د":"بلا"}</button>`).join("")}</div></div>
      ${draft.type==="prayer"?`<p class="hint">مهام الصلاة بلا نقاط ولا مكافآت.</p>`:`<div><span class="label">النقاط</span><div class="stepper"><button type="button" data-action="d-pts" data-v="-5" aria-label="أقل">−</button><output>⭐ ${draft.points}</output><button type="button" data-action="d-pts" data-v="5" aria-label="أكثر">＋</button></div></div>`}
      <div class="field"><span>خطوات المهمة (اختياري)</span><div class="edsteps">${(draft.sl||[]).map((x,i)=>`<div class="edrow"><button type="button" class="edbox ${x.d?"on":""}" data-action="step-tick" data-i="${i}" aria-pressed="${Boolean(x.d)}" aria-label="تعليم الخطوة ${i+1} كمنجزة"><span>✓</span></button><input type="text" data-step="${i}" maxlength="90" value="${esc(x.t)}" placeholder="خطوة ${i+1}" autocomplete="off"><button type="button" class="icon-btn" data-action="step-del" data-i="${i}" aria-label="حذف الخطوة ${i+1}">✕</button></div>`).join("")}<button type="button" class="btn btn-soft btn-sm edadd" data-action="step-add">＋ أضف خطوة</button>${(draft.sl||[]).length?"":`<p class="hint">إن لم تضف خطوات، نضيف تلقائيًا خطوات مناسبة لنوع المهمة.</p>`}</div></div>
      <label class="field"><span>ملاحظة للطفل (اختياري)</span><input id="taskNote" type="text" maxlength="500" placeholder="مثال: بعد الغداء مباشرة" value="${esc(draft.note)}" autocomplete="off"></label>
      <div class="actions"><button class="btn btn-primary" type="submit">${edit?"حفظ التعديل":"حفظ المهمة"}</button><button class="btn btn-line" type="button" data-action="d-back">→ رجوع</button></div>
      ${edit?`<button class="btn btn-danger" type="button" data-action="delete-task" data-id="${esc(draft.editId)}" data-title="${esc(draft.title)}">🗑 حذف المهمة</button>`:""}
    </form>`);
  }
  function prefsSheet(){
    const row=(k,on,t,s)=>`<button type="button" class="pick ${on?"on":""}" data-action="pref" data-v="${k}" aria-pressed="${on}"><span class="box">${on?"✓":""}</span><span><b>${t}</b><div class="muted small">${s}</div></span></button>`;
    const tones=soundOn?TONE_EVENTS.map(e=>`<div class="tonebox"><b>${e.n}</b><div class="muted small">${e.d}</div><div class="tonechips">${Object.entries(TONES).map(([id,t])=>`<button type="button" class="chip ${toneSel[e.k]===id?"on":""}" data-action="tone-pick" data-ev="${e.k}" data-id="${id}" aria-pressed="${toneSel[e.k]===id}">${t.n}</button>`).join("")}</div></div>`).join(""):"";
    modal("الإعدادات",`<div class="form">${row("calm",calm,"الوضع الهادئ","بدون حركة أو احتفالات، وبأقل قدر من المعلومات على الشاشة")}${row("sound",soundOn,"الأصوات","تشغيل أصوات الإنجاز والتنبيهات")}${tones?`<h4 class="tonehd">اختيار النغمات</h4><p class="muted small">اضغط على نغمة لسماعها واختيارها. «تلقائي» يتبع الوضع الهادئ.</p>${tones}`:""}</div>`);
  }
  /* ---- AI tutor (math / Hebrew) ---- */
  const tutor={m:"",subject:"math",busy:false,chats:{}};
  const TUTOR_SUBJ={math:{i:"🔢",n:"الرياضيات",chips:["اشرح لي درساً جديداً","أعطني تمريناً","ساعدني في مسألة"]},hebrew:{i:"🗣️",n:"العبرية",chips:["علّمني كلمات جديدة","أعطني تمرين قراءة","لنتحدث بالعبرية","اشرح لي قاعدة"]}};
  const tkey=()=>tutor.m+":"+tutor.subject;
  function tchat(){const k=tkey();if(!tutor.chats[k]){let v=[];try{v=JSON.parse(localStorage.getItem("hero-tutor-"+k)||"[]")}catch{}tutor.chats[k]=Array.isArray(v)?v:[]}return tutor.chats[k]}
  function tsave(){try{localStorage.setItem("hero-tutor-"+tkey(),JSON.stringify(tchat().slice(-24)))}catch{}}
  const tbubble=m=>`<div class="tb ${m.role==="user"?"me":"ai"}"><div class="tt" dir="auto">${esc(m.content)}</div>${m.role==="assistant"?`<button type="button" class="tsay" data-action="tutor-say" aria-label="استمع">🔊</button>`:""}</div>`;
  function tutorCard(m){
    return `<article class="card tutorcard"><div class="card-title"><h2>🧑‍🏫 معلّمي الذكي</h2></div><p class="muted small">اسأل وتعلّم بالخطوة. اختر المادة:</p><div class="tutbtns"><button class="btn btn-soft" data-action="tutor-open" data-member="${m}" data-subject="math">🔢 رياضيات</button><button class="btn btn-soft" data-action="tutor-open" data-member="${m}" data-subject="hebrew">🗣️ עברית</button></div></article>`;
  }
  function tutorModal(){
    const S=TUTOR_SUBJ[tutor.subject],msgs=tchat();
    const sw=Object.entries(TUTOR_SUBJ).map(([k,v])=>`<button type="button" class="${tutor.subject===k?"on":""}" data-action="tutor-open" data-member="${tutor.m}" data-subject="${k}">${v.i} ${v.n}</button>`).join("");
    modal("🧑‍🏫 المعلّم الذكي",`<div class="tutor"><div class="ktabs" role="group">${sw}</div>
      <div class="tlog" id="tlog" aria-live="polite">${msgs.length?msgs.map(tbubble).join(""):`<div class="tempty">${S.i} أهلاً! أنا معلّمك في ${S.n}. اختر ما تريد أو اكتب سؤالك.</div>`}</div>
      <div class="tchips" id="tchips">${S.chips.map(c=>`<button type="button" class="chip" data-action="tutor-chip" data-t="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      <div class="tform"><textarea id="tutIn" rows="2" maxlength="1500" placeholder="اكتب هنا..." dir="auto"></textarea><button type="button" class="btn btn-primary" data-action="tutor-send" aria-label="إرسال">إرسال</button></div>
      ${msgs.length?`<button type="button" class="linkbtn" data-action="tutor-clear">🗑 محادثة جديدة</button>`:""}</div>`);
    const lg=$("tlog");if(lg)lg.scrollTop=lg.scrollHeight;
  }
  async function tutorSend(text){
    text=(text||"").trim();if(!text||tutor.busy)return;
    const msgs=tchat(),lg=$("tlog");if(!lg)return;
    tutor.busy=true;msgs.push({role:"user",content:text});
    if(!lg.querySelector(".tb"))lg.innerHTML="";
    lg.insertAdjacentHTML("beforeend",tbubble(msgs[msgs.length-1])+`<div class="tb ai" id="ttyping"><div class="tt tdots"><i></i><i></i><i></i></div></div>`);
    lg.scrollTop=lg.scrollHeight;const inp=$("tutIn");if(inp)inp.value="";const ch=$("tchips");if(ch)ch.remove();
    const key=tkey();
    try{
      const r=await api("/api/family/tutor",{method:"POST",body:JSON.stringify({assignee:tutor.m,subject:tutor.subject,messages:msgs.slice(-14)})});
      tutor.chats[key].push({role:"assistant",content:r.reply});tsave();
      if(tkey()===key&&$("tlog")){$("ttyping")?.remove();$("tlog").insertAdjacentHTML("beforeend",tbubble(tutor.chats[key][tutor.chats[key].length-1]));$("tlog").scrollTop=$("tlog").scrollHeight;playEvent("check")}
    }catch(err){
      tutor.chats[key].pop();
      $("ttyping")?.remove();
      if($("tlog"))$("tlog").insertAdjacentHTML("beforeend",`<div class="tb ai"><div class="tt terr">${esc(err.message||"تعذّر الاتصال بالمعلّم")}</div></div>`);
    }finally{tutor.busy=false}
  }
  function tutorSay(text){
    try{
      const ss=window.speechSynthesis;if(!ss)return;ss.cancel();
      String(text).split(/\n+/).map(l=>l.trim()).filter(Boolean).forEach(l=>{
        const he=/[֐-׿]/.test(l)&&!/[؀-ۿ]/.test(l);
        const u=new SpeechSynthesisUtterance(l);u.lang=he?"he-IL":"ar-SA";u.rate=.9;ss.speak(u);
      });
    }catch{}
  }

  document.addEventListener("keydown",e=>{if(e.target&&e.target.id==="tutIn"&&e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();tutorSend(e.target.value)}});
  /* ---- bedtime message via WhatsApp (opens WhatsApp with the text ready; the parent presses send) ---- */
  const WA_DEFAULT="0515800799";
  /* plain, literal, predictable wording for a 15-year-old on the autism spectrum: numbered steps, no idioms, no pressure, same structure every night */
  const bedMsgs=n=>[
    `مساء الخير يا ${n}.\nحان وقت التحضير للنوم. الخطوات بالترتيب:\n1. اذكر الله بأذكار النوم.\n2. اقرأ ما تيسّر من القرآن.\n3. أطفئ الشاشة وانم.\nإذا كنت متعباً يكفي ذكر قصير. أنت لا تحتاج إلى الرد. تصبح على خير.`,
    `مرحباً يا ${n}.\nهذه رسالة قبل النوم، بدون أسئلة.\nما نفعله الآن:\n1. أذكار النوم.\n2. قراءة من القرآن، صفحة واحدة أو أقل.\n3. النوم.\nلقد بذلت جهدك اليوم، ويمكنك أن ترتاح. تصبح على خير.`,
    `مساء النور يا ${n}.\nالوقت الآن مناسب للنوم. أقترح:\n1. اقرأ آية الكرسي.\n2. اذكر الله، تسبيح وحمد.\n3. اقرأ من القرآن إن استطعت.\n4. نم.\nيوم جديد غداً، وكل شيء على ما يرام.`,
    `يا ${n}، تصبح على خير.\nقبل النوم: أذكار، ثم قرآن، ثم نوم. هذا كل شيء.\nلا تستعجل، وخذ وقتك. الله يحفظك.`
  ];

  const waNumber=()=>{let v=WA_DEFAULT;try{v=localStorage.getItem("hero-wa")||WA_DEFAULT}catch{}return v};
  const waIntl=v=>{let d=String(v).replace(/\D/g,"");if(d.startsWith("00"))d=d.slice(2);if(d.startsWith("0"))d="972"+d.slice(1);return d};
  function bedtimeModal(){
    const msgs=bedMsgs("يَمان"),i=new Date().getDate()%msgs.length;
    modal("🌙 رسالة قبل النوم",`<div class="form">
      <label class="field"><span>رقم الواتساب</span><input id="waNum" type="tel" inputmode="tel" dir="ltr" value="${esc(waNumber())}" autocomplete="off"></label>
      <label class="field"><span>الرسالة</span><textarea id="waMsg" rows="5">${esc(msgs[i])}</textarea></label>
      <button type="button" class="btn btn-soft" data-action="wa-other">🔄 رسالة أخرى</button>
      <button type="button" class="btn btn-primary btn-big" data-action="wa-send">إرسال عبر واتساب</button>
      <p class="muted small">يفتح واتساب والرسالة جاهزة، وعليك فقط الضغط على إرسال.</p>
    </div>`);
    window.__waIdx=i;
  }
  function eventModal(d){
    modal("موعد جديد",`<form class="form" id="eventForm">
      <label class="field"><span>لمن؟</span><select id="eventMember"><option value="family">كل العائلة</option>${KIDS.map(k=>`<option value="${k}">${esc(PEOPLE[k].name)}</option>`).join("")}</select></label>
      <label class="field"><span>العنوان</span><input id="eventTitle" type="text" required maxlength="140" placeholder="مثال: زيارة الجدة" autocomplete="off"></label>
      <div class="grid2" style="gap:12px"><label class="field"><span>التاريخ</span><input id="eventDate" type="date" value="${d||today()}" required></label><label class="field"><span>الوقت (اختياري)</span><input id="eventTime" type="time"></label></div>
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
      <div class="sugg" style="margin-top:-6px">${(r?["لا أفهم، اشرح بطريقة أبسط","أعطني مثالاً صغيراً","ما الخطوة التالية؟","أنهيت، كيف أتأكد؟"]:["من أين أبدأ؟","لا أفهم المطلوب","أعطني مثالاً صغيراً","كيف أعرف أنني أنهيت؟"]).map(q=>`<button type="button" data-action="h-quick" data-v="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      <button class="btn btn-primary btn-big ${help.loading?"busy":""}" data-action="h-ask">${help.loading?`<span class="spin"></span>أفكر معك…`:(r?"اسأل سؤالاً آخر":"اسأل Hero")}</button>
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
    if(calm){toast(all?"انتهت مهام اليوم ✓":`تم ✓ +${est}`,"ok",undo,4000);return}
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
  async function loadApps(){
    try{apps=await api("/api/apps")}catch(e){apps={configured:true,items:[],error:e.message}}
    if(pview==="settings"&&area==="parent")render();
  }
  async function loadPrayer(){
    prayer=null;if(pview==="settings")render();
    try{const r=await api(`/api/prayer/today?date=${today()}`);prayer={prayerTimes:r.prayerTimes||{},warning:r.warning||""}}
    catch(e){prayer={prayerTimes:{},warning:e.message}}
    if(pview==="settings"&&area==="parent")render();
  }
  function taskBody(){
    return{title:draft.title.trim(),type:draft.type,points:draft.type==="prayer"?0:draft.points,date:draft.date||today(),note:draft.note,suggestedTime:draft.time,timerMinutes:draft.timer,checklist:(draft.sl||[]).filter(x=>x.t.trim()).slice(0,8).map(x=>x.t.trim()),checklistDone:(draft.sl||[]).filter(x=>x.t.trim()).slice(0,8).map((x,i)=>x.d?i:-1).filter(i=>i>=0)};
  }

  document.addEventListener("keydown",e=>{const el=e.target;if(e.key==="Enter"&&el&&el.matches&&el.matches("[data-step]")){e.preventDefault();syncDraft();if(draft.sl.length<8){draft.sl.push({t:"",d:false});taskModal();const all=document.querySelectorAll("[data-step]");all[all.length-1]?.focus()}}});
  /* ======================= events ======================= */
  document.addEventListener("click",async e=>{
    const kb=e.target.closest("[data-key]");if(kb)return pinKey(kb.dataset.key);
    let b=e.target.closest("[data-area],[data-action],[data-pview]");if(b===document.body)b=null;
    if(!b){if(e.target.id==="modalRoot")close();return}
    if(b.dataset.pview){pview=b.dataset.pview;render();scrollTo(0,0);if(pview==="settings"&&!prayer)loadPrayer();if(pview==="settings"&&!apps)loadApps();if(pview==="events")loadCal();return}
    if(b.dataset.area&&!b.dataset.action){
      area=b.dataset.area;pin="";pinError="";
      if(area!=="home"){try{localStorage.setItem("hero-area",area)}catch{}}
      history.replaceState(null,"",`?area=${area}`);render();scrollTo(0,0);return;
    }
    const a=b.dataset.action;
    switch(a){
      case "close":return close();
      case "reload":return guard(b,()=>refresh());
      case "add-task":draft=newDraft({who:b.dataset.who||"yaman",date:b.dataset.d||""});return taskModal();
      case "edit-task":{const t=findTask(b.dataset.id);if(!t)return;draft=newDraft({step:2,who:t.assignee,type:t.type,points:t.points,title:t.title,note:t.note,time:t.suggestedTime||"",timer:t.timerMinutes||0,sl:(t.checklist||[]).map(x=>({t:x.text,d:Boolean(x.done)})),date:t.date||"",editId:t.id});return taskModal()}
      case "add-event":return eventModal(b.dataset.d);
      case "pkid":pkid=b.dataset.k;return render();
      case "cal-who":cal.who=b.dataset.k;return render();
      case "cal-tasks":cal.showTasks=!cal.showTasks;return render();
      case "cal-day":cal.sel=b.dataset.d;return render();
      case "cal-nav":{const [y,m]=cal.month.split("-").map(Number),dt=new Date(y,m-1+Number(b.dataset.n),1);cal.month=iso(dt).slice(0,7);cal.sel=cal.month===today().slice(0,7)?today():`${cal.month}-01`;return loadCal()}
      case "d-who":syncDraft();draft.who=b.dataset.v;return taskModal();
      case "d-type":syncDraft();draft.type=b.dataset.v;draft.points=TYPES[draft.type].p;return taskModal();
      case "d-next":draft.step=2;taskModal();return;
      case "step-add":{syncDraft();if((draft.sl||[]).length>=8)return toast("الحد الأقصى 8 خطوات");draft.sl=[...(draft.sl||[]),{t:"",d:false}];taskModal();const all=document.querySelectorAll("[data-step]");all[all.length-1]?.focus();return}
      case "step-tick":{syncDraft();const i=Number(b.dataset.i),it=draft.sl[i];if(!it)return;it.d=!it.d;taskModal();
        // an existing task saves the tick right away (no need to press save), as long as this row is unchanged
        const t=draft.editId?findTask(draft.editId):null,saved=t&&t.checklist&&t.checklist[i];
        if(saved&&saved.text===it.t.trim()){const nv=it.d,prev=Boolean(saved.done);saved.done=nv;
          try{await api(`/api/family/tasks/${t.id}/check`,{method:"PATCH",body:JSON.stringify({index:i,done:nv})});refresh()}
          catch(err){saved.done=prev;it.d=prev;taskModal();onErr(err)}}
        return}
      case "step-del":{syncDraft();draft.sl.splice(Number(b.dataset.i),1);taskModal();return}
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
        Object.assign(t,r.task||{status:"in_progress",startedAt:new Date().toISOString()});render();calm?toast("بدأنا ✓","ok",null,2500):toast("بدأت! مكافأة البداية +2 ⭐","gold");
      });
      case "prefs":return prefsSheet();
      case "bedtime":return bedtimeModal();
      case "wa-other":{const m=bedMsgs("يَمان");window.__waIdx=((window.__waIdx||0)+1)%m.length;const t=$("waMsg");if(t)t.value=m[window.__waIdx];return}
      case "wa-send":{const num=$("waNum")?.value||waNumber(),txt=($("waMsg")?.value||"").trim();if(!txt)return;try{localStorage.setItem("hero-wa",num)}catch{}window.open("https://wa.me/"+waIntl(num)+"?text="+encodeURIComponent(txt),"_blank","noopener");return}
      case "pref":{
        if(b.dataset.v==="calm"){calm=!calm;try{localStorage.setItem("hero-calm",calm?"on":"off")}catch{}}
        else{soundOn=!soundOn;try{localStorage.setItem("hero-sound",soundOn?"on":"off")}catch{}if(soundOn)playDone("task")}
        render();return prefsSheet();
      }
      case "tutor-open":{tutor.m=b.dataset.member||tutor.m;tutor.subject=b.dataset.subject||"math";return tutorModal()}
      case "tutor-chip":return tutorSend(b.dataset.t);
      case "tutor-send":return tutorSend($("tutIn")?.value);
      case "tutor-say":{const t=b.closest(".tb")?.querySelector(".tt");if(t)tutorSay(t.textContent);return}
      case "tutor-clear":{tutor.chats[tkey()]=[];tsave();return tutorModal()}
      case "tone-pick":{const ev=b.dataset.ev,id=b.dataset.id;if(!TONES[id])return;toneSel[ev]=id;try{localStorage.setItem("hero-tone-"+ev,id)}catch{}
        if(id==="auto"){playEvent(ev,true)}else playTone(id);
        return prefsSheet()}
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
      case "program":return modal(`برنامج اليوم لـ${PEOPLE[b.dataset.who].name}`,`<p class="muted" style="margin-bottom:14px">تطبيق البرنامج اليومي الثابت. المهام التي أضفتموها بأنفسكم أو استوردتموها من TickTick والمهام المنجزة تبقى كما هي.</p><div class="actions"><button class="btn btn-primary" data-action="program-go" data-who="${b.dataset.who}" data-replace="1">استبدل المهام المفتوحة</button><button class="btn btn-soft" data-action="program-go" data-who="${b.dataset.who}">أضف فقط</button></div><button class="btn btn-line" style="margin-top:10px" data-action="close">إلغاء</button>`);
      case "program-go":return guard(b,async()=>{
        const r=await api(`/api/family/child/${b.dataset.who}/program`,{method:"POST",body:JSON.stringify({date:today(),replace:b.dataset.replace==="1"})});
        close();await refresh();toast(`تم تطبيق برنامج اليوم لـ${PEOPLE[b.dataset.who].name} ✓`,"ok");
      });
      case "seed":return guard(b,async()=>{
        const r=await api(`/api/family/child/${b.dataset.who}/seed-today`,{method:"POST",body:JSON.stringify({date:today()})});
        await refresh();toast(r.skipped?(r.reason||"توجد مهام بالفعل."):`جُهّز يوم ${PEOPLE[b.dataset.who].name} ✓`,r.skipped?"":"ok");
      });
      case "add-member":return memberModal();
      case "m-icon":{window.__mIcon=b.dataset.v;document.querySelectorAll("#mIcons button").forEach(x=>x.classList.toggle("on",x===b));return}
      case "school-edit":return schoolModal(b.dataset.id);
      case "apps-reload":apps=null;render();return loadApps();
      case "app-toggle":{const toPrivate=b.dataset.private!=="1";const name=b.dataset.name;
        if(toPrivate)return guard(b,async()=>{await api(`/api/apps/${b.dataset.id}/visibility`,{method:"PUT",body:JSON.stringify({private:true})});await loadApps();toast(`${name} صار خاصًا 🔒`,"ok")});
        return modal(`جعل ${name} عامًا؟`,`<p class="muted" style="margin-bottom:16px">سيستطيع أي شخص يملك الرابط أن يفتح «${esc(name)}» دون تسجيل دخول. لا تفعل ذلك إن كان فيه بيانات خاصة.</p><div class="actions"><button class="btn btn-danger" data-action="app-public-go" data-id="${esc(b.dataset.id)}" data-name="${esc(name)}">نعم، اجعله عامًا</button><button class="btn btn-line" data-action="close">تراجع</button></div>`)}
      case "app-public-go":return guard(b,async()=>{await api(`/api/apps/${b.dataset.id}/visibility`,{method:"PUT",body:JSON.stringify({private:false})});close();await loadApps();toast(`${b.dataset.name} صار عامًا 🌐`,"ok")});
      case "weekly-edit":return weeklyModal(b.dataset.id);
      case "wk-day":{const d=Number(b.dataset.v);const set=window.__wkDays;set.has(d)?set.delete(d):set.add(d);b.classList.toggle("on",set.has(d));return}
      case "weekly-del":return guard(b,async()=>{const r=await api(`/api/family/weekly/${b.dataset.id}`,{method:"DELETE"});weekly=r.items||[];close();await refresh();toast("تم الإيقاف ✓")});
      case "sc-day":{const d=Number(b.dataset.v);const set=window.__schoolDays;set.has(d)?set.delete(d):set.add(d);b.classList.toggle("on",set.has(d));return}
      case "member-pin":return memberPinModal(b.dataset.id);
      case "member-del":return confirmModal(`حذف ${PEOPLE[b.dataset.id]?.name||"المستخدم"}؟`,"ستُحذف كل مهامه ومواعيده ولا يمكن التراجع.","do-member-del",b.dataset.id);
      case "do-member-del":return guard(b,async()=>{await api(`/api/family/members/${b.dataset.id}`,{method:"DELETE"});if(area===b.dataset.id)area="parent";close();await refresh();toast("تم حذف المستخدم")});
      case "prayer-edit":return prayerModal();
      case "endday":return guard(b,()=>endDayModal(b.dataset.member));
      case "help":{const t=findTask(b.dataset.id);if(!t)return;help={task:t,member:b.dataset.member,mode:t.type==="youtube"?"youtube":"full",question:"",loading:false,result:null,checked:new Set()};return helpModal()}
      case "ck":{const t=findTask(b.dataset.id);if(!t||!t.checklist)return;const i=Number(b.dataset.i),it=t.checklist[i];if(!it)return;const nv=!it.done;it.done=nv;render();try{if(nv)playEvent("check");await api(`/api/family/tasks/${t.id}/check`,{method:"PATCH",body:JSON.stringify({index:i,done:nv})})}catch(err){it.done=!nv;render();onErr(err)}return}
      case "h-mode":help.question=$("helpQ")?.value||help.question;help.mode=b.dataset.v;return helpModal();
      case "h-check":{const i=Number(b.dataset.i);help.checked.has(i)?help.checked.delete(i):help.checked.add(i);help.question=$("helpQ")?.value||help.question;return helpModal()}
      case "h-quick":{const q=$("helpQ");if(q)q.value=b.dataset.v;help.question=b.dataset.v;return document.querySelector('[data-action="h-ask"]')?.click()}
      case "h-ask":{
        help.question=$("helpQ")?.value||"";help.loading=true;helpModal();
        try{
          const t=help.task;
          help.result=await api("/api/ai/task-help",{method:"POST",body:JSON.stringify({assignee:help.member,mode:help.mode,question:help.question,context:help.result?[help.result.answer,...(help.result.steps||[]).slice(0,4)].filter(Boolean).join(" | ").slice(0,850):"",task:{title:t.title,type:t.type,note:t.note,suggestedTime:t.suggestedTime,timerMinutes:t.timerMinutes,points:t.points,done:t.done,status:t.status}})});
          help.checked=new Set();
        }catch(err){help.loading=false;helpModal();return onErr(err)}
        help.loading=false;if($("modalRoot").firstChild)helpModal();return;
      }
      case "more-time":extra[b.dataset.id]=(extra[b.dataset.id]||0)+5;return tickTimers();
      case "breathe":return breathe();
      case "breathe-stop":return breatheStop();
    }
  });

  document.addEventListener("submit",async e=>{
    const id=e.target.id;if(!["taskForm","eventForm","planForm","prayerForm","memberForm","memberPinForm","schoolForm"].includes(id))return;
    e.preventDefault();const btn=e.target.querySelector("[type=submit]");
    if(id==="taskForm")return guard(btn,async()=>{
      syncDraft();if(!draft.title.trim())return toast("اكتب المهمة أولاً.","err");
      if(draft.editId){
        const r0=await api(`/api/family/tasks/${draft.editId}`,{method:"PATCH",body:JSON.stringify({...taskBody(),assignee:draft.who==="both"?"yaman":draft.who})});
        close();await refresh();return toast(r0?.task&&draft.time&&r0.task.suggestedTime&&r0.task.suggestedTime!==draft.time?`نُقلت إلى ${r0.task.suggestedTime} لتجنب التعارض ✓`:"تم تحديث المهمة ✓","ok");
      }
      const who=draft.who==="both"?KIDS:[draft.who];
      let moved=null;
      for(const w of who){const r1=await api("/api/family/tasks",{method:"POST",body:JSON.stringify({...taskBody(),assignee:w,source:"parent"})});if(r1?.timeMoved)moved=r1.timeMoved}
      close();await refresh();toast(moved?`أُضيفت المهمة وانتقلت من ${moved.from} إلى ${moved.to} لتجنب التعارض ✓`:"تمت إضافة المهمة ✓","ok");
    });
    if(id==="memberForm")return guard(btn,async()=>{
      const r=await api("/api/family/members",{method:"POST",body:JSON.stringify({name:$("mName").value,age:Number($("mAge").value),icon:window.__mIcon||"🌟",pin:$("mPin").value})});
      close();await refresh();toast(`أُضيف ${r.member.name} ✓`,"ok");
    });
    if(id==="weeklyForm")return guard(btn,async()=>{
      const wid=e.target.dataset.id,body=JSON.stringify({assignee:$("wkWho").value,title:$("wkTitle").value,type:$("wkType").value,days:[...window.__wkDays].sort(),time:$("wkTime").value,minutes:Number($("wkMin").value),note:$("wkNote").value});
      const r=await api(wid?`/api/family/weekly/${wid}`:"/api/family/weekly",{method:wid?"PUT":"POST",body});
      weekly=r.items||[];close();await refresh();toast("تم الحفظ ✓ وأُعيد بناء البرنامج","ok");
    });
    if(id==="schoolForm")return guard(btn,async()=>{
      const mid=e.target.dataset.id;
      const r=await api(`/api/family/school/${mid}`,{method:"PUT",body:JSON.stringify({start:$("scStart").value,end:$("scEnd").value,days:[...window.__schoolDays].sort(),age:Number($("scAge").value)})});
      school[mid]=r.school;close();await refresh();toast("تم الحفظ ✓ أُعيد بناء البرنامج","ok");
    });
    if(id==="memberPinForm")return guard(btn,async()=>{
      await api(`/api/family/members/${e.target.dataset.id}/pin`,{method:"POST",body:JSON.stringify({pin:$("mNewPin").value})});
      close();toast("تم تغيير الرمز ✓","ok");
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

