import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import emailjs from "@emailjs/browser";
import "./App.css";

/* ═══════════════════════════════════════════════════
   ⚙️  SUPABASE CONFIG — shared project, dedicated lax tables
   ═══════════════════════════════════════════════════ */
const SUPABASE_URL = "https://xewcjyjmgjqbvjbjhjkv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uRrFJUQoU5GoYg5umXc7bg_st0jeRJV";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const ENTRIES_TABLE = "lax_entries";
const MESSAGES_TABLE = "lax_messages";

/* ── LocalStorage keys ── */
const DRAFT_KEY = "lax_draft";
const CHAT_NAME_KEY = "lax_chat_name";

/* ── EmailJS Config ── */
const EMAILJS_SERVICE_ID = "service_m1c3jet";
const EMAILJS_TEMPLATE_ID = "template_h3iyw4n";
const EMAILJS_PUBLIC_KEY = "mygZSHcNMwpngL4Ya";
emailjs.init(EMAILJS_PUBLIC_KEY);

const YEAR = 2026;
const NCAA_API = `https://ncaa-api.henrygd.me/brackets/lacrosse-men/d1/${YEAR}`;

// Fetch with a hard timeout so a slow/hanging proxy never blocks the app
// Fetch JSON with a hard deadline covering BOTH headers AND body streaming.
// The abort signal stays armed until r.json() finishes, so a stalled body
// is cancelled just like a stalled connection.
async function fetchJSON(url, ms=8000){
  const ctrl=new AbortController();
  const tid=setTimeout(()=>ctrl.abort(),ms);
  try{
    const r=await fetch(url,{signal:ctrl.signal});
    if(!r.ok) throw new Error(r.status);
    const data=await r.json();      // abort still active here
    clearTimeout(tid);
    return data;
  }catch(e){clearTimeout(tid);throw e;}
}

async function fetchNCAA(){
  // 1. Dedicated Cloudflare Worker — fast edge cache, set after deploying worker/index.js
  const WORKER = "https://lax-proxy.drpync.workers.dev/";
  try{return await fetchJSON(WORKER);}catch{}
  // 2. allorigins public CORS proxy (~5-6 s, used as fallback)
  const proxied=`https://api.allorigins.win/raw?url=${encodeURIComponent(NCAA_API)}`;
  try{return await fetchJSON(proxied);}catch{}
  return null;
}

// Wrap any promise with a hard timeout that resolves to `fallback` instead of hanging.
function withTimeout(p,ms,fallback){
  return Promise.race([p,new Promise(r=>setTimeout(()=>r(fallback),ms))]);
}

const POINTS = [0,1,1,1,1,1,1,1,1,2,2,2,2,4,4,8];
const MAX_PTS = POINTS.reduce((a,b)=>a+b,0);
const ROUND_LABEL = g => g<=8?"First Round":g<=12?"Quarterfinals":g<=14?"Semifinals":"Championship";

// Brackets stay locked until first-round games actually begin (May 9).
// This prevents premature unlock if the API returns stale/early data.
const FIRST_ROUND_MS = new Date("2026-05-09T00:00:00-04:00").getTime();

/* posIds 101-116 are the opening round — we skip them and map only First Round onwards */
const POS_TO_GAME = {
  201:1, 202:2, 203:3, 204:4, 205:5, 206:6, 207:7, 208:8,
  301:9, 302:10, 303:11, 304:12,
  401:13, 402:14,
  501:15,
};

/*
 * BRACKET — 2026 NCAA Men's D1 Lacrosse Championship (First Round through Final)
 *
 * Games 1 & 5 have one TBD slot filled by the Opening Round (May 6):
 *   Game 1 (posId 201): Princeton (1) vs. winner of Marist / Stony Brook
 *   Game 5 (posId 205): Notre Dame (2) vs. winner of Robert Morris / Jacksonville
 *
 * openingCandidates = the two teams competing in the opening round for that slot.
 * Once the API returns teams for these games, the actual opponent is shown.
 */
const BRACKET = {
  1: {top:"Princeton",      seedTop:1,  bottom:null,              openingCandidates:["Marist","Stony Brook"],  openingSeeds:[16,16]},
  2: {top:"Penn St.",       seedTop:8,  bottom:"Army West Point", seedBottom:9},
  3: {top:"Virginia",       seedTop:5,  bottom:"Georgetown",      seedBottom:12},
  4: {top:"Richmond",       seedTop:4,  bottom:"Duke",            seedBottom:13},
  5: {top:"Notre Dame",     seedTop:2,  bottom:null,              openingCandidates:["Robert Morris","Jacksonville"], openingSeeds:[15,15]},
  6: {top:"Cornell",        seedTop:7,  bottom:"Johns Hopkins",   seedBottom:10},
  7: {top:"Syracuse",       seedTop:6,  bottom:"Yale",            seedBottom:11},
  8: {top:"North Carolina", seedTop:3,  bottom:"UAlbany",         seedBottom:14},
  9:{from:[1,2]},10:{from:[3,4]},11:{from:[5,6]},12:{from:[7,8]},
  13:{from:[9,10]},14:{from:[11,12]},
  15:{from:[13,14]},
};

// Seed lookup — built automatically from BRACKET so seeds travel with teams in later rounds
const TEAM_SEEDS = {};
for(const cfg of Object.values(BRACKET)){
  if(cfg.top    && cfg.seedTop)    TEAM_SEEDS[cfg.top]    = cfg.seedTop;
  if(cfg.bottom && cfg.seedBottom) TEAM_SEEDS[cfg.bottom] = cfg.seedBottom;
  if(cfg.openingCandidates && cfg.openingSeeds)
    cfg.openingCandidates.forEach((t,i)=>{ if(cfg.openingSeeds[i]) TEAM_SEEDS[t]=cfg.openingSeeds[i]; });
}

/* ESPN CDN logos — errors are handled gracefully (shows empty span) */
const LOGOS = {
  "Princeton":       "https://a.espncdn.com/i/teamlogos/ncaa/500/163.png",
  "Penn St.":        "https://a.espncdn.com/i/teamlogos/ncaa/500/213.png",
  "Virginia":        "https://a.espncdn.com/i/teamlogos/ncaa/500/258.png",
  "Georgetown":      "https://a.espncdn.com/i/teamlogos/ncaa/500/46.png",
  "Richmond":        "https://a.espncdn.com/i/teamlogos/ncaa/500/257.png",
  "Duke":            "https://a.espncdn.com/i/teamlogos/ncaa/500/150.png",
  "Notre Dame":      "https://a.espncdn.com/i/teamlogos/ncaa/500/87.png",
  "Robert Morris":   "https://a.espncdn.com/i/teamlogos/ncaa/500/2523.png",
  "Jacksonville":    "https://a.espncdn.com/i/teamlogos/ncaa/500/294.png",
  "Cornell":         "https://a.espncdn.com/i/teamlogos/ncaa/500/172.png",
  "Johns Hopkins":   "https://a.espncdn.com/i/teamlogos/ncaa/500/118.png",
  "Syracuse":        "https://a.espncdn.com/i/teamlogos/ncaa/500/183.png",
  "Yale":            "https://a.espncdn.com/i/teamlogos/ncaa/500/43.png",
  "North Carolina":  "https://a.espncdn.com/i/teamlogos/ncaa/500/153.png",
  "UAlbany":         "https://a.espncdn.com/i/teamlogos/ncaa/500/399.png",
  "Army West Point": "https://a.espncdn.com/i/teamlogos/ncaa/500/349.png",
  "Marist":          "https://a.espncdn.com/i/teamlogos/ncaa/500/2368.png",
  "Stony Brook":     "https://a.espncdn.com/i/teamlogos/ncaa/500/2571.png",
};

const BROADCASTER_STYLE = {
  "ESPN":   {bg:"#d00",    color:"#fff"},
  "ESPN2":  {bg:"#edeae3", color:"#5c5c72"},
  "ESPNU":  {bg:"#edeae3", color:"#5c5c72"},
  "ESPN+":  {bg:"#edeae3", color:"#5c5c72"},
  "TNT":    {bg:"#00318a", color:"#fff"},
  "TBS":    {bg:"#00318a", color:"#fff"},
  "truTV":  {bg:"#5c2d91", color:"#fff"},
};

/* ═══════════════════════════════════════════════════
   DEV PREVIEW MOCK DATA
   ═══════════════════════════════════════════════════ */
const MOCK_ENTRIES = [
  {name:"Drew's Picks",   email:"drew@example.com",  tiebreak:22, submittedAt:"2026-05-05T18:00:00Z", pin:"1234",
   picks:{1:"Princeton",2:"Penn St.",3:"Virginia",4:"Richmond",5:"Notre Dame",6:"Cornell",7:"Syracuse",8:"North Carolina",
          9:"Princeton",10:"Virginia",11:"Notre Dame",12:"Syracuse",13:"Princeton",14:"Notre Dame",15:"Princeton"}},
  {name:"Jake's Bracket", email:"jake@example.com",  tiebreak:18, submittedAt:"2026-05-05T19:30:00Z", pin:"5678",
   picks:{1:"Princeton",2:"Army West Point",3:"Georgetown",4:"Duke",5:"Notre Dame",6:"Johns Hopkins",7:"Yale",8:"UAlbany",
          9:"Princeton",10:"Georgetown",11:"Notre Dame",12:"Yale",13:"Princeton",14:"Notre Dame",15:"Notre Dame"}},
  {name:"Sara's Bracket", email:"sara@example.com",  tiebreak:14, submittedAt:"2026-05-05T09:15:00Z", pin:"9012",
   picks:{1:"Marist/Stony Brook",2:"Penn St.",3:"Virginia",4:"Richmond",5:"Robert Morris/Jacksonville",6:"Cornell",7:"Syracuse",8:"North Carolina",
          9:"Penn St.",10:"Virginia",11:"Cornell",12:"Syracuse",13:"Virginia",14:"Cornell",15:"Cornell"}},
];
const MOCK_RESULTS = {
  1:{winner:"Princeton",   final:true, period:"FINAL", scores:[14,8],  teams:["Princeton","Marist"],         startDate:"05/09/2026",startTime:"14:30",hasStartTime:true,broadcaster:"ESPNU"},
  2:{winner:"Penn St.",    final:true, period:"FINAL", scores:[11,9],  teams:["Penn St.","Army West Point"],  startDate:"05/09/2026",startTime:"12:00",hasStartTime:true,broadcaster:"ESPNU"},
  3:{winner:"Virginia",    final:true, period:"FINAL", scores:[12,10], teams:["Virginia","Georgetown"],       startDate:"05/09/2026",startTime:"19:30",hasStartTime:true,broadcaster:"ESPNU"},
  4:{winner:"Richmond",    final:true, period:"FINAL", scores:[10,8],  teams:["Richmond","Duke"],             startDate:"05/09/2026",startTime:"17:00",hasStartTime:true,broadcaster:"ESPNU"},
  5:{winner:"Notre Dame",  final:true, period:"FINAL", scores:[13,7],  teams:["Notre Dame","Robert Morris"],  startDate:"05/10/2026",startTime:"12:00",hasStartTime:true,broadcaster:"ESPNU"},
  6:{winner:"Cornell",     final:true, period:"FINAL", scores:[9,8],   teams:["Cornell","Johns Hopkins"],     startDate:"05/09/2026",startTime:"17:00",hasStartTime:true,broadcaster:"ESPNU"},
  7:{winner:null,          live:true,  period:"2ND",   scores:[6,5],   teams:["Syracuse","Yale"],             startDate:"05/10/2026",startTime:"17:00",hasStartTime:true,broadcaster:"ESPNU"},
  8:{winner:null,          live:false, period:null,    scores:[null,null], teams:["North Carolina","UAlbany"],startDate:"05/10/2026",startTime:"19:30",hasStartTime:true,broadcaster:"ESPNU"},
  9:{winner:null,          live:false, period:null,    scores:[null,null],                                    startDate:"05/16/2026",startTime:"14:00",hasStartTime:true,broadcaster:"ESPNU"},
  10:{winner:null,         live:false, period:null,    scores:[null,null],                                    startDate:"05/16/2026",startTime:"16:30",hasStartTime:true,broadcaster:"ESPN2"},
  11:{winner:null,         live:false, period:null,    scores:[null,null],                                    startDate:"05/16/2026",startTime:"14:00",hasStartTime:true,broadcaster:"ESPN2"},
  12:{winner:null,         live:false, period:null,    scores:[null,null],                                    startDate:"05/17/2026",startTime:"14:00",hasStartTime:true,broadcaster:"ESPN2"},
  13:{winner:null,         live:false, period:null,    scores:[null,null],                                    startDate:"05/23/2026",startTime:"12:30",hasStartTime:true,broadcaster:"ESPN"},
  14:{winner:null,         live:false, period:null,    scores:[null,null],                                    startDate:"05/23/2026",startTime:"15:00",hasStartTime:true,broadcaster:"ESPN"},
  15:{winner:null,         live:false, period:null,    scores:[null,null],                                    startDate:"05/25/2026",startTime:"13:00",hasStartTime:true,broadcaster:"ESPN"},
};

/* ═══════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════ */
function norm(s){return(s||"").trim().toLowerCase();}
function eq(a,b){return norm(a)===norm(b);}
function generatePin(){return String(Math.floor(1000+Math.random()*9000));}

function cascade(picks){
  const p={...picks};
  for(let g=9;g<=15;g++){
    const[f1,f2]=BRACKET[g].from;
    if(p[g]&&p[g]!==p[f1]&&p[g]!==p[f2]) p[g]=null;
  }
  return p;
}

function isComplete(picks){for(let g=1;g<=15;g++){if(!picks[g])return false;}return true;}

function parseAPI(data){
  const r={};
  if(!data?.championships?.[0]?.games)return{results:r};
  for(const gm of data.championships[0].games){
    const g=POS_TO_GAME[gm.bracketPositionId];
    if(!g)continue;
    const w=gm.teams?.find(t=>t.isWinner);
    r[g]={
      state:gm.gameState, period:gm.currentPeriod||"",
      final:gm.gameState==="F", live:gm.gameState==="I",
      teams:gm.teams?.map(t=>t.nameShort)||[],
      scores:gm.teams?.map(t=>t.score)||[],
      winner:w?w.nameShort:null,
      startDate:gm.startDate, startTime:gm.startTime,
      hasStartTime:gm.hasStartTime,
      broadcaster:typeof gm.broadcaster==="string"?gm.broadcaster:(gm.broadcaster?.name||null),
    };
  }
  return{results:r};
}

function fmtDate(d){
  if(!d)return null;
  const[m,day,y]=d.split("/");
  return new Date(y,m-1,day).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
}
function fmtTime(t){
  if(!t||t==="TBA")return null;
  const[h,min]=t.split(":");
  const hr=parseInt(h);
  return `${hr%12||12}:${min} ${hr>=12?"PM":"AM"}`;
}

function scoreEntry(entry,results){
  const elim=getEliminated(results);
  let total=0,max=0; const d={};
  for(let g=1;g<=15;g++){
    const pick=entry.picks[g],r=results[g],pts=POINTS[g];
    if(r?.winner){const c=pick?.includes("/")?pick.split("/").some(t=>eq(t,r.winner)):eq(pick,r.winner);d[g]={pick,correct:c,pts:c?pts:0};if(c)total+=pts;}
    else{d[g]={pick,correct:null,pts:0};if(!elim.has(norm(pick)))max+=pts;}
  }
  return{total,maxPossible:total+max,details:d};
}

function getEliminated(results){
  const s=new Set();
  for(let g=1;g<=15;g++){
    const r=results[g];
    if(r?.winner&&r.teams?.length>=2){
      r.teams.forEach(t=>{if(!eq(t,r.winner))s.add(norm(t));});
      // Mark opening round candidates who didn't make it into this game as eliminated
      const cfg=BRACKET[g];
      if(cfg?.openingCandidates){
        for(const c of cfg.openingCandidates){
          if(!r.teams.some(t=>eq(t,c)))s.add(norm(c));
        }
      }
    }
  }
  // Add combined opening-round pick strings to eliminated once all their parts are out
  for(const cfg of Object.values(BRACKET)){
    if(cfg.openingCandidates){
      const combined=norm(cfg.openingCandidates.join("/"));
      if(cfg.openingCandidates.every(c=>s.has(norm(c)))) s.add(combined);
    }
  }
  return s;
}

/* ═══════════════════════════════════════════════════
   SUPABASE DATA FUNCTIONS
   ═══════════════════════════════════════════════════ */
async function loadEntries(){
  try{
    let{data,error}=await supabase.from(ENTRIES_TABLE).select("name,email,tiebreak,picks,submitted_at,paid");
    if(error){
      ({data,error}=await supabase.from(ENTRIES_TABLE).select("name,email,tiebreak,picks,submitted_at"));
      if(error)throw error;
    }
    return(data||[]).map(row=>({name:row.name,email:row.email||"",tiebreak:row.tiebreak,picks:row.picks,submittedAt:row.submitted_at,paid:!!row.paid}));
  }catch(e){console.error("loadEntries error",e);return[];}
}

async function loadEntriesWithPins(){
  try{
    let{data,error}=await supabase.from(ENTRIES_TABLE).select("name,email,tiebreak,picks,submitted_at,pin,paid");
    if(error){
      ({data,error}=await supabase.from(ENTRIES_TABLE).select("name,email,tiebreak,picks,submitted_at,pin"));
      if(error)throw error;
    }
    return(data||[]).map(row=>({name:row.name,email:row.email||"",tiebreak:row.tiebreak,picks:row.picks,submittedAt:row.submitted_at,pin:row.pin||null,paid:!!row.paid}));
  }catch(e){console.error("loadEntriesWithPins error",e);return[];}
}

async function saveEntry(entry,{retries=3,isEdit=false}={}){
  for(let attempt=1;attempt<=retries;attempt++){
    try{
      const row={name:entry.name,email:entry.email||null,tiebreak:entry.tiebreak,picks:entry.picks,submitted_at:entry.submittedAt,pin:entry.pin};
      let error;
      if(isEdit){
        ({error}=await supabase.from(ENTRIES_TABLE).upsert(row,{onConflict:"name"}));
      } else {
        ({error}=await supabase.from(ENTRIES_TABLE).insert(row));
        if(error?.code==="23505") return{ok:false,duplicate:true};
      }
      if(error)throw error;
      const{data}=await supabase.from(ENTRIES_TABLE).select("name").eq("name",entry.name).single();
      if(!data)throw new Error("Verification failed — entry not found after save");
      localStorage.removeItem(DRAFT_KEY);
      return{ok:true};
    }catch(e){
      console.error(`saveEntry attempt ${attempt}/${retries}`,e);
      if(attempt<retries) await new Promise(r=>setTimeout(r,1000*attempt));
    }
  }
  return{ok:false};
}

async function sendBracketEmail(entry,isEdit=false){
  try{
    const p=entry.picks||{};
    await emailjs.send(EMAILJS_SERVICE_ID,EMAILJS_TEMPLATE_ID,{
      pool_name: "Lax Pool 2026",
      bracket_name: entry.name,
      submitter_email: entry.email,
      champion: p[15]||"N/A",
      tiebreak: entry.tiebreak,
      submitted_at: new Date(entry.submittedAt).toLocaleString("en-US",{dateStyle:"medium",timeStyle:"short"}),
      type: isEdit?"✏️ Edit":"🆕 New Submission",
      pick_1:  p[1]||"—",  // Princeton vs OR winner
      pick_2:  p[2]||"—",  // Penn St. vs Army West Point
      pick_3:  p[3]||"—",  // Virginia vs Georgetown
      pick_4:  p[4]||"—",  // Richmond vs Duke
      pick_5:  p[5]||"—",  // Notre Dame vs OR winner
      pick_6:  p[6]||"—",  // Cornell vs Johns Hopkins
      pick_7:  p[7]||"—",  // Syracuse vs Yale
      pick_8:  p[8]||"—",  // North Carolina vs UAlbany
      pick_9:  p[9]||"—",
      pick_10: p[10]||"—",
      pick_11: p[11]||"—",
      pick_12: p[12]||"—",
      pick_13: p[13]||"—",
      pick_14: p[14]||"—",
    });
  }catch(e){console.error("EmailJS error:",e.text||e.message||e);}
}

function saveDraft(data){try{localStorage.setItem(DRAFT_KEY,JSON.stringify({...data,savedAt:Date.now()}))}catch(e){}}
function loadDraft(){try{const d=JSON.parse(localStorage.getItem(DRAFT_KEY));if(d&&Date.now()-d.savedAt<86400000)return d;localStorage.removeItem(DRAFT_KEY);return null;}catch(e){return null;}}
function clearDraft(){try{localStorage.removeItem(DRAFT_KEY)}catch(e){}}

async function verifyEntryPin(name,pin){
  try{
    const{data,error}=await supabase.from(ENTRIES_TABLE)
      .select("name,email,tiebreak,picks,submitted_at")
      .eq("name",name).eq("pin",pin).single();
    if(error||!data)return null;
    return{name:data.name,email:data.email||"",tiebreak:data.tiebreak,picks:data.picks,submittedAt:data.submitted_at};
  }catch{return null;}
}

async function resetEntryPin(name){
  const pin=generatePin();
  try{
    const{error}=await supabase.from(ENTRIES_TABLE).update({pin}).eq("name",name);
    if(error)throw error; return pin;
  }catch(e){console.error("resetEntryPin error",e);return null;}
}

async function deleteEntry(name){
  try{
    const{error}=await supabase.from(ENTRIES_TABLE).delete().eq("name",name);
    if(error)throw error; return true;
  }catch(e){console.error("deleteEntry error",e);return false;}
}

async function updatePaidStatus(name,paid){
  try{
    const{error}=await supabase.from(ENTRIES_TABLE).update({paid}).eq("name",name);
    if(error)throw error; return true;
  }catch(e){console.error("updatePaidStatus error",e);return false;}
}

async function loadMessages(){
  try{
    const{data,error}=await supabase.from(MESSAGES_TABLE)
      .select("id,author,body,created_at")
      .order("created_at",{ascending:true})
      .limit(200);
    if(error)throw error;
    return(data||[]);
  }catch(e){console.error("loadMessages error",e);return null;}
}

async function postMessage(author,body){
  try{
    const{error}=await supabase.from(MESSAGES_TABLE)
      .insert({author:author.trim(),body:body.trim()});
    if(error)throw error; return true;
  }catch(e){console.error("postMessage error",e);return false;}
}

async function deleteMessage(id){
  try{
    const{error}=await supabase.from(MESSAGES_TABLE).delete().eq("id",id);
    if(error)throw error; return true;
  }catch(e){console.error("deleteMessage error",e);return false;}
}

/* ═══════════════════════════════════════════════════
   DESIGN TOKENS — FOREST GREEN THEME
   ═══════════════════════════════════════════════════ */
const C = {
  bg:"#f0f5f1",
  bgCard:"#ffffff",
  bgCardAlt:"#f5f9f6",
  bgInset:"#e4ede6",
  border:"#c2d4c4",
  borderAccent:"#27ae60",

  headerBg:"#1e3a28",

  text:"#162216",
  textMid:"#3d614a",
  textLight:"#6a9478",

  red:"#27ae60",
  redDark:"#1e8449",
  redBg:"rgba(39,174,96,0.07)",
  redBorder:"rgba(39,174,96,0.25)",

  navy:"#0e7340",
  navyBg:"rgba(14,115,64,0.07)",
  navyBorder:"rgba(14,115,64,0.25)",

  green:"#2ecc71",
  greenBg:"rgba(46,204,113,0.07)",
  greenBorder:"rgba(46,204,113,0.25)",

  gold:"#e8b420",
  goldBg:"rgba(232,180,32,0.08)",

  lilac:"#3a9e6a",
  lilacBg:"rgba(58,158,106,0.07)",
  lilacBorder:"rgba(58,158,106,0.25)",

  shadow:"0 1px 3px rgba(0,0,0,0.04), 0 4px 14px rgba(0,0,0,0.03)",
  shadowLg:"0 4px 24px rgba(0,0,0,0.07)",
};

const FONTS = {
  display:"'Bebas Neue', impact, sans-serif",
  body:"'Barlow Condensed', 'Barlow', sans-serif",
  mono:"'Share Tech Mono', 'Courier New', monospace",
};

const GlobalStyles = () => (
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@300;400;500;600;700&family=Barlow:wght@400;500;600&family=Share+Tech+Mono&display=swap" rel="stylesheet"/>
);

/* ═══════════════════════════════════════════════════
   SHARED COMPONENTS
   ═══════════════════════════════════════════════════ */
function BroadcasterBadge({name}){
  const s=BROADCASTER_STYLE[name]||{bg:C.bgInset,color:C.textMid};
  return(
    <span style={{
      display:"inline-block",fontSize:12,fontWeight:800,fontFamily:FONTS.mono,
      letterSpacing:0.8,padding:"2px 6px",borderRadius:10,marginTop:2,
      background:s.bg,color:s.color,
    }}>{name}</span>
  );
}

function TeamLogo({team,size=20,style={}}){
  const[err,setErr]=useState(false);
  const src=LOGOS[team];
  if(!src||err) return <span style={{width:size,height:size,display:"inline-block",...style}}/>;
  return <img src={src} alt={team} width={size} height={size} onError={()=>setErr(true)} style={{objectFit:"contain",flexShrink:0,...style}}/>;
}

function Card({children,style={},onClick,onMouseEnter,onMouseLeave}){
  return <div className="retro-card" style={{padding:16,...style}} onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>{children}</div>;
}

function SectionHeader({children,style={}}){
  return(
    <div className="section-rule" style={{marginBottom:16,...style}}>
      <span style={{fontFamily:FONTS.display,fontSize:22,color:C.navy,letterSpacing:"3px",whiteSpace:"nowrap"}}>{children}</span>
    </div>
  );
}

function Fld({label,flex,children}){
  return(
    <div style={{flex}}>
      <label style={{fontSize:13,color:C.textLight,fontWeight:700,letterSpacing:"2px",textTransform:"uppercase",display:"block",marginBottom:5,fontFamily:FONTS.body}}>{label}</label>
      {children}
    </div>
  );
}

function ScoringKey(){
  const rounds=[
    {r:"1ST RD",p:1,color:C.green},
    {r:"QUARTERS",p:2,color:C.navy},
    {r:"SEMIS",p:4,color:C.lilac},
    {r:"FINAL",p:8,color:C.red},
  ];
  return(
    <Card style={{padding:"12px 20px",display:"flex",gap:20,flexWrap:"wrap",alignItems:"center",borderLeftColor:C.gold}}>
      <span style={{fontFamily:FONTS.display,fontSize:18,color:C.navy,letterSpacing:"3px"}}>SCORING KEY</span>
      {rounds.map(x=>(
        <div key={x.r} style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{
            display:"inline-flex",alignItems:"center",justifyContent:"center",
            width:28,height:28,borderRadius:"50%",
            background:x.color,color:"#fff",
            fontFamily:FONTS.mono,fontSize:17,fontWeight:700,
            boxShadow:`0 2px 8px ${x.color}33`,
          }}>{x.p}</span>
          <span style={{fontSize:14,color:C.textMid,fontFamily:FONTS.body,fontWeight:700,letterSpacing:"1.5px"}}>{x.r}</span>
        </div>
      ))}
      <span style={{fontFamily:FONTS.mono,fontSize:16,color:C.gold,marginLeft:"auto",fontWeight:700,letterSpacing:2}}>{MAX_PTS} MAX PTS</span>
    </Card>
  );
}

const primaryBtn = {
  background:C.red,
  color:"#fff",
  border:"none",
  borderRadius:8,
  padding:"13px 36px",
  fontSize:18,
  fontFamily:FONTS.display,
  cursor:"pointer",
  letterSpacing:"3px",
  boxShadow:"0 2px 12px rgba(39,174,96,0.25)",
  transition:"all 0.15s",
};

const secondaryBtn = {
  background:"rgba(235,248,239,0.8)",
  color:C.navy,
  border:`2px solid ${C.navyBorder}`,
  borderRadius:8,
  padding:"8px 16px",
  fontSize:15,
  fontFamily:FONTS.body,
  cursor:"pointer",
  fontWeight:700,
  letterSpacing:"1.5px",
  transition:"all 0.15s",
};

const navyBtn = {
  background:C.navy,
  color:"#fff",
  border:"none",
  borderRadius:8,
  padding:"11px 28px",
  fontSize:17,
  fontFamily:FONTS.display,
  cursor:"pointer",
  letterSpacing:"2px",
  boxShadow:"0 2px 12px rgba(14,115,64,0.25)",
  transition:"all 0.15s",
};

/* ═══════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════ */
export default function App(){
  const[view,setView]=useState("bracket");
  const[viewBracket,setViewBracket]=useState(null);
  const[entries,setEntries]=useState([]);
  const[results,setResults]=useState({});
  const[loading,setLoading]=useState(true);
  const[lastFetch,setLastFetch]=useState(null);
  const[messages,setMessages]=useState([]);
  const[msgTableMissing,setMsgTableMissing]=useState(false);
  const initialLoad=useRef(true);

  const isAdmin=useMemo(()=>{
    try{return new URLSearchParams(window.location.search).get("admin")==="true";}
    catch{return false;}
  },[]);

  const previewMode=useMemo(()=>{
    if(!import.meta.env.DEV)return null;
    try{return new URLSearchParams(window.location.search).get("preview");}
    catch{return null;}
  },[]);

  const refresh=useCallback(async()=>{
    if(initialLoad.current)setLoading(true);
    try{
      const[ents,res]=await Promise.all([
        withTimeout(loadEntries(),10000,[]),
        withTimeout(fetchNCAA().then(d=>parseAPI(d||{}).results).catch(()=>({})),10000,{}),
      ]);
      setEntries(ents); setResults(res); setLastFetch(new Date());
    }catch{}finally{setLoading(false);initialLoad.current=false;}
  },[]);

  useEffect(()=>{
    refresh();
    const iv=setInterval(refresh,60000);
    return()=>clearInterval(iv);
  },[refresh]);

  const refreshMessages=useCallback(async()=>{
    const msgs=await loadMessages();
    if(msgs===null){setMsgTableMissing(true);return;}
    setMsgTableMissing(false);
    setMessages(msgs);
  },[]);
  useEffect(()=>{
    refreshMessages();
    let channel;
    try{
      channel=supabase.channel("lax-messages-changes")
        .on("postgres_changes",{event:"INSERT",schema:"public",table:MESSAGES_TABLE},payload=>{
          setMessages(prev=>[...prev,payload.new]);
        })
        .subscribe();
    }catch{}
    const iv=setInterval(refreshMessages,60000);
    return()=>{clearInterval(iv);if(channel)supabase.removeChannel(channel);};
  },[refreshMessages]);

  const displayEntries=previewMode==="empty"?[]:previewMode==="entries"||previewMode==="live"?MOCK_ENTRIES:entries;
  const displayResults=previewMode==="live"?MOCK_RESULTS:previewMode==="entries"||previewMode==="empty"?{}:results;

  const pastLockDate=previewMode==="live"||Date.now()>=FIRST_ROUND_MS;
  const started=pastLockDate&&Object.values(displayResults).some(r=>r.final||r.live);
  const anyLive=pastLockDate&&Object.values(displayResults).some(r=>r.live);

  const handleSubmit=async(entry,{isEdit=false}={})=>{
    saveDraft(entry);
    const res=await saveEntry(entry,{isEdit});
    if(res.duplicate) throw new Error("DUPLICATE_NAME");
    if(!res.ok) throw new Error("Save failed after 3 attempts. Your picks are saved locally and will be restored when you reload.");
    sendBracketEmail(entry,isEdit);
    setEntries(prev=>[...prev.filter(e=>e.name!==entry.name),{...entry,paid:prev.find(x=>x.name===entry.name)?.paid||false}]);
  };
  const handleDelete=async name=>{
    await deleteEntry(name);
    setEntries(prev=>prev.filter(e=>e.name!==name));
  };

  const tabs=[
    ...(!started?[{key:"bracket",label:"Submit Picks"}]:[]),
    ...(!started?[{key:"edit",label:"Edit Bracket"}]:[]),
    {key:"standings",label:"Standings"},
    {key:"browse",label:"Brackets"},
    ...(started?[{key:"master",label:"Live Bracket"}]:[]),
    {key:"chat",label:"Friendly Banter"},
    {key:"rules",label:"Rules"},
    ...(isAdmin?[{key:"manage",label:"Admin"}]:[]),
  ];

  useEffect(()=>{
    if(started&&(view==="bracket"||view==="edit"))setView("master");
  },[started,view]);

  return(
    <div className="program-bg" style={{minHeight:"100vh",color:C.text,fontFamily:FONTS.body}}>
      <GlobalStyles/>

      {/* ── HEADER ── */}
      <header style={{background:C.headerBg}}>
        <div style={{height:4,background:`linear-gradient(90deg, ${C.green}, ${C.gold}, #1e8449, #d4edda, ${C.red})`}}/>
        <div style={{maxWidth:1340,margin:"0 auto",padding:"18px 24px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,paddingBottom:4}}>
            <div onClick={()=>setView(started?"master":"bracket")} style={{fontFamily:FONTS.display,fontSize:38,lineHeight:1,color:"#fff",letterSpacing:"2px",cursor:"pointer"}}>
              LAX POOL {YEAR}
            </div>
            {anyLive&&<span className="live-badge">● LIVE</span>}
          </div>
        </div>
      </header>

      {/* ── TABS ── */}
      <nav style={{background:C.headerBg,borderBottom:"1px solid rgba(255,255,255,0.1)"}}>
        <div style={{maxWidth:1340,margin:"0 auto",display:"flex",gap:0,justifyContent:"center"}}>
          {tabs.map(t=>(
            <button key={t.key} className="tab-btn" onClick={()=>{setView(t.key);setViewBracket(null);}} style={{
              background:"transparent",
              color:view===t.key?C.green:"rgba(255,255,255,0.55)",
              border:"none",
              borderBottom:view===t.key?`3px solid ${C.green}`:"3px solid transparent",
              padding:"12px 22px",fontSize:16,fontFamily:FONTS.display,
              cursor:"pointer",letterSpacing:"2px",textTransform:"uppercase",
              transition:"color 0.12s, border-color 0.12s",
            }}>{t.label}</button>
          ))}
        </div>
      </nav>

      {/* ── CONTENT ── */}
      <main style={{maxWidth:1340,margin:"0 auto",padding:"28px 24px 80px"}}>
        {previewMode&&(
          <div style={{
            marginBottom:16,padding:"8px 14px",background:C.headerBg,borderRadius:4,
            display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",
            fontFamily:FONTS.mono,fontSize:14,color:"#bbb",letterSpacing:1,
          }}>
            <span style={{color:C.gold,fontWeight:700}}>DEV PREVIEW: {previewMode}</span>
            {["empty","entries","live"].map(s=>(
              <a key={s} href={`?preview=${s}`} style={{
                color:previewMode===s?C.gold:C.textLight,
                textDecoration:"none",padding:"2px 8px",
                border:`1px solid ${previewMode===s?C.gold:"#555"}`,borderRadius:3,
              }}>{s}</a>
            ))}
            <a href="/" style={{color:C.textLight,textDecoration:"none",padding:"2px 8px",border:"1px solid #555",borderRadius:3}}>off</a>
          </div>
        )}
        {loading&&(
          <div style={{textAlign:"center",padding:80}}>
            <div style={{fontFamily:FONTS.display,fontSize:48,letterSpacing:"6px",color:C.navy}}>LOADING…</div>
          </div>
        )}
        {!loading&&view==="master"&&<MasterBracket results={displayResults} entries={displayEntries}/>}
        {!loading&&view==="bracket"&&<PickForm onSubmit={handleSubmit} entries={displayEntries} started={started} results={displayResults}/>}
        {!loading&&view==="edit"&&<EditBracket onSubmit={handleSubmit} entries={displayEntries} started={started} results={displayResults}/>}
        {!loading&&view==="standings"&&<Standings entries={displayEntries} results={displayResults} started={started} viewBracket={viewBracket} setViewBracket={setViewBracket}/>}
        {!loading&&view==="browse"&&<BrowseBrackets entries={displayEntries} results={displayResults} started={started}/>}
        {!loading&&view==="chat"&&<MessageBoard messages={messages} onPost={async(author,body)=>{const ok=await postMessage(author,body);if(ok)await refreshMessages();return ok;}} onDelete={isAdmin?async(id)=>{await deleteMessage(id);await refreshMessages();}:null} tableMissing={msgTableMissing}/>}
        {!loading&&view==="rules"&&<Rules/>}
        {!loading&&view==="manage"&&isAdmin&&<Manage entries={displayEntries} onDelete={handleDelete} onRefresh={refresh}/>}
      </main>

      {lastFetch&&(
        <div style={{textAlign:"center",padding:"10px 16px",fontSize:13,color:C.textLight,fontFamily:FONTS.mono,letterSpacing:"2px",borderTop:"1px solid rgba(255,255,255,0.08)"}}>
          UPDATED {lastFetch.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PICK FORM
   ═══════════════════════════════════════════════════ */
function PickForm({onSubmit,entries,started,results}){
  const draft=loadDraft();
  const[name,setName]=useState(draft?.name||"");
  const[email,setEmail]=useState(draft?.email||"");
  const[tiebreak,setTiebreak]=useState(draft?.tiebreak||"");
  const[picks,setPicks]=useState(draft?.picks||{});
  const[submitted,setSubmitted]=useState(false);
  const[saving,setSaving]=useState(false);
  const[chosenPin,setChosenPin]=useState("");
  const[showPinPrompt,setShowPinPrompt]=useState(false);
  const[saveError,setSaveError]=useState(null);
  const[nameError,setNameError]=useState(null);
  const[showDraftBanner,setShowDraftBanner]=useState(!!draft);

  useEffect(()=>{
    if(name||email||Object.keys(picks).length>0)
      saveDraft({name,email,tiebreak,picks});
  },[name,email,tiebreak,picks]);

  const doPick=(g,team)=>setPicks(cascade({...picks,[g]:team}));

  const lockIn=()=>{
    const dup=entries.find(e=>e.name.trim().toLowerCase()===name.trim().toLowerCase());
    if(dup){
      setNameError(`"${dup.name}" is already taken — choose a different name. If this is your bracket and you want to make changes, use the Edit Bracket tab at the top.`);
      return;
    }
    setNameError(null);
    setShowPinPrompt(true);
  };

  const submit=async()=>{
    if(!name.trim())return alert("Please enter a bracket name.");
    if(!email.trim())return alert("Please enter your email.");
    if(!isComplete(picks))return alert("Please fill out all 15 picks.");
    if(!tiebreak)return alert("Please enter a tiebreaker (total goals in both semifinals + championship).");
    if(chosenPin.length!==4)return alert("Please choose a 4-digit PIN.");
    const dup=entries.find(e=>e.name.trim().toLowerCase()===name.trim().toLowerCase());
    if(dup){setSaveError(`"${dup.name}" is already taken — choose a different name, or use the Edit Bracket tab at the top.`);return;}
    setShowPinPrompt(false);
    setSaving(true);
    setSaveError(null);
    try{
      await onSubmit({name:name.trim(),email:email.trim(),tiebreak:Number(tiebreak),picks,submittedAt:new Date().toISOString(),pin:chosenPin});
      setSubmitted(true);
    }catch(e){
      if(e.message==="DUPLICATE_NAME") setSaveError(`"${name.trim()}" is already taken — choose a different name, or use the Edit Bracket tab at the top.`);
      else setSaveError(e.message||"Save failed. Your picks are backed up locally — try again.");
    }
    finally{setSaving(false);}
  };

  const reset=()=>{
    setName("");setEmail("");setTiebreak("");setPicks({});
    setSubmitted(false);setChosenPin("");setShowPinPrompt(false);
    setSaveError(null);clearDraft();
  };

  if(submitted) return(
    <Card style={{textAlign:"center",padding:"60px 24px",borderTop:`4px solid ${C.red}`}}>
      <div style={{fontSize:56,marginBottom:16}}>🎉</div>
      <div style={{fontFamily:FONTS.display,fontSize:52,color:C.navy,letterSpacing:"4px",marginBottom:8}}>
        BRACKET LOCKED IN
      </div>
      <p style={{color:C.textMid,fontSize:18,marginBottom:4}}>
        <strong style={{color:C.text}}>{name}</strong>'s picks are saved.
      </p>
      <p style={{color:C.textMid,fontSize:17,marginBottom:4}}>
        Champion: <strong style={{color:C.red}}>{picks[15]}</strong>
      </p>
      <p style={{color:C.textMid,fontSize:17,marginBottom:36}}>
        Tiebreaker: <strong style={{color:C.navy,fontFamily:FONTS.mono}}>{tiebreak} total goals</strong>
      </p>
      <div style={{
        display:"inline-block",margin:"0 auto 36px",
        padding:"28px 48px",background:C.goldBg,
        border:`3px solid ${C.gold}`,borderRadius:1,
        boxShadow:"4px 4px 0 rgba(184,140,16,0.18)",
      }}>
        <div style={{fontFamily:FONTS.display,fontSize:28,color:C.gold,letterSpacing:"3px",marginBottom:10}}>
          COMPLETE YOUR ENTRY
        </div>
        <div style={{fontFamily:FONTS.body,fontSize:18,color:C.text,marginBottom:8,lineHeight:1.5}}>
          Send <strong style={{fontSize:20}}>$10</strong> via Venmo to
        </div>
        <div style={{fontFamily:FONTS.mono,fontSize:28,color:C.navy,fontWeight:700,letterSpacing:2,marginBottom:8}}>
          @drew-pynchon
        </div>
        <div style={{fontFamily:FONTS.body,fontSize:15,color:C.textLight,letterSpacing:1}}>
          YOUR ENTRY IS NOT OFFICIAL UNTIL PAYMENT IS RECEIVED
        </div>
      </div>
      <div style={{
        display:"inline-block",margin:"0 auto 24px",
        padding:"20px 40px",background:C.navyBg,
        border:`2px solid ${C.navyBorder}`,borderRadius:1,
      }}>
        <div style={{fontFamily:FONTS.display,fontSize:22,color:C.navy,letterSpacing:"2px",marginBottom:8}}>YOUR PIN</div>
        <div style={{fontFamily:FONTS.mono,fontSize:36,color:C.navy,fontWeight:700,letterSpacing:8}}>{chosenPin}</div>
        <div style={{fontFamily:FONTS.body,fontSize:14,color:C.textMid,marginTop:8,letterSpacing:1}}>
          SAVE THIS — YOU'LL NEED IT TO EDIT YOUR PICKS
        </div>
      </div>
      <div style={{marginTop:8}}>
        <button onClick={reset} style={primaryBtn}>SUBMIT ANOTHER BRACKET</button>
      </div>
    </Card>
  );

  if(showPinPrompt) return(
    <div style={{animation:"fadeIn 0.2s ease"}}>
      <Card style={{maxWidth:400,margin:"40px auto",padding:"40px 32px",textAlign:"center",borderTop:`4px solid ${C.red}`}}>
        <div style={{fontSize:40,marginBottom:16}}>🔐</div>
        <div style={{fontFamily:FONTS.display,fontSize:30,color:C.navy,letterSpacing:"3px",marginBottom:6}}>CHOOSE A PIN</div>
        <p style={{color:C.textMid,fontSize:17,marginBottom:24,lineHeight:1.5}}>
          Pick a 4-digit PIN to protect your bracket. You'll need this to edit your picks later.
        </p>
        <input
          className="pin-input"
          value={chosenPin}
          onChange={e=>{setChosenPin(e.target.value.replace(/\D/g,"").slice(0,4));}}
          maxLength={4}
          autoFocus
          onKeyDown={e=>e.key==="Enter"&&chosenPin.length===4&&submit()}
        />
        <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:20}}>
          <button onClick={submit} disabled={chosenPin.length!==4||saving} style={{
            ...primaryBtn,
            opacity:chosenPin.length!==4||saving?0.4:1,
            cursor:chosenPin.length!==4||saving?"not-allowed":"pointer",
          }}>
            {saving?"SAVING…":"SUBMIT BRACKET"}
          </button>
          <button onClick={()=>{setShowPinPrompt(false);setChosenPin("");setSaveError(null);}} style={secondaryBtn}>CANCEL</button>
        </div>
        {saveError&&(
          <div style={{marginTop:16,padding:"12px 16px",background:C.redBg,border:`1px solid ${C.redBorder}`,borderRadius:8,color:C.red,fontSize:15,fontWeight:600}}>
            {saveError}
            <button onClick={submit} style={{...primaryBtn,marginLeft:12,fontSize:13,padding:"6px 16px"}}>RETRY</button>
          </div>
        )}
      </Card>
    </div>
  );

  const cnt=Object.values(picks).filter(Boolean).length+(tiebreak?1:0);
  const complete=isComplete(picks)&&!!tiebreak;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {showDraftBanner&&(
        <Card style={{padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,borderLeftColor:C.gold,background:C.goldBg}}>
          <span style={{fontSize:15,color:C.text,fontWeight:600}}>We restored your unsaved picks from last session.</span>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setShowDraftBanner(false)} style={{...secondaryBtn,fontSize:13,padding:"5px 14px"}}>GOT IT</button>
            <button onClick={()=>{reset();setShowDraftBanner(false);}} style={{fontSize:13,padding:"5px 14px",background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.textMid,cursor:"pointer"}}>START FRESH</button>
          </div>
        </Card>
      )}
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{flex:1,height:6,background:C.bgInset,borderRadius:1,overflow:"hidden",border:`1px solid ${C.border}`}}>
          <div style={{
            width:`${(cnt/16)*100}%`,height:"100%",
            background:complete?C.green:C.red,
            borderRadius:1,transition:"width 0.3s",
          }}/>
        </div>
        <span style={{fontFamily:FONTS.mono,fontSize:16,color:complete?C.green:C.red,minWidth:40,fontWeight:700}}>{cnt}/16</span>
        {complete&&<span style={{fontFamily:FONTS.display,fontSize:16,color:C.green,letterSpacing:2}}>COMPLETE ✓</span>}
      </div>

      <BracketVis picks={picks} onPick={doPick} results={results} interactive tiebreak={tiebreak} setTiebreak={setTiebreak}/>

      <Card style={{padding:"16px 20px"}}>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
          <Fld label="Bracket Name *" flex="1 1 160px">
            <input value={name} onChange={e=>{setName(e.target.value);setNameError(null);}}/>
            {nameError&&(
              <div style={{marginTop:6,color:C.red,fontSize:14,fontWeight:600,lineHeight:1.4}}>
                {nameError}
              </div>
            )}
          </Fld>
          <Fld label="Email *" flex="1 1 180px">
            <input value={email} onChange={e=>setEmail(e.target.value)}/>
          </Fld>
          <div style={{display:"flex",flexDirection:"column",gap:4,alignSelf:"flex-end"}}>
            {started&&(
              <div style={{
                padding:"6px 14px",background:C.redBg,border:`1px solid ${C.redBorder}`,borderRadius:1,
                fontSize:14,color:C.red,fontWeight:700,letterSpacing:1.5,textAlign:"center",
              }}>
                ⚠ TOURNAMENT HAS STARTED
              </div>
            )}
            <button onClick={lockIn}
              disabled={!complete||!name.trim()||!email.trim()||!tiebreak||saving||started}
              style={{
                ...primaryBtn,
                opacity:(!complete||!name.trim()||!email.trim()||!tiebreak||saving||started)?0.35:1,
                cursor:(!complete||!name.trim()||!email.trim()||!tiebreak||saving||started)?"not-allowed":"pointer",
                fontSize:17,padding:"10px 28px",letterSpacing:"3px",whiteSpace:"nowrap",
              }}>
              {saving?"SAVING…":"LOCK IN BRACKET ›"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MASTER BRACKET
   ═══════════════════════════════════════════════════ */
function MasterBracket({results,entries}){
  const picks={};
  for(let g=1;g<=15;g++){if(results[g]?.winner)picks[g]=results[g].winner;}
  return <BracketVis picks={picks} onPick={null} results={results} entries={entries} noPickColors/>;
}

/* ═══════════════════════════════════════════════════
   BRACKET VISUALIZATION
   ═══════════════════════════════════════════════════ */
const FIELD_BG_LANDSCAPE=`
  radial-gradient(circle 52px at 50% 50%, transparent 0%, transparent 50px, rgba(255,255,255,0.35) 50px, rgba(255,255,255,0.35) 53px, transparent 53px),
  radial-gradient(circle 44px at 10.5% 50%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.06) 88%, rgba(255,255,255,0.28) 90%, rgba(255,255,255,0.28) 94%, transparent 100%),
  radial-gradient(circle 44px at 89.5% 50%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.06) 88%, rgba(255,255,255,0.28) 90%, rgba(255,255,255,0.28) 94%, transparent 100%),
  linear-gradient(90deg, transparent 49.7%, rgba(255,255,255,0.45) 49.7%, rgba(255,255,255,0.45) 50.3%, transparent 50.3%),
  linear-gradient(90deg, transparent 19.7%, rgba(255,255,255,0.22) 19.7%, rgba(255,255,255,0.22) 20.3%, transparent 20.3%, transparent 79.7%, rgba(255,255,255,0.22) 79.7%, rgba(255,255,255,0.22) 80.3%, transparent 80.3%),
  repeating-linear-gradient(180deg, rgba(0,0,0,0.035) 0%, rgba(0,0,0,0.035) 12.5%, transparent 12.5%, transparent 25%),
  linear-gradient(180deg, #1b6033 0%, #154d28 100%)
`.trim();

const FIELD_BG_PORTRAIT=`
  radial-gradient(circle 52px at 50% 50%, transparent 0%, transparent 50px, rgba(255,255,255,0.35) 50px, rgba(255,255,255,0.35) 53px, transparent 53px),
  radial-gradient(circle 44px at 50% 10.5%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.06) 88%, rgba(255,255,255,0.28) 90%, rgba(255,255,255,0.28) 94%, transparent 100%),
  radial-gradient(circle 44px at 50% 89.5%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.06) 88%, rgba(255,255,255,0.28) 90%, rgba(255,255,255,0.28) 94%, transparent 100%),
  linear-gradient(180deg, transparent 49.7%, rgba(255,255,255,0.45) 49.7%, rgba(255,255,255,0.45) 50.3%, transparent 50.3%),
  linear-gradient(180deg, transparent 19.7%, rgba(255,255,255,0.22) 19.7%, rgba(255,255,255,0.22) 20.3%, transparent 20.3%, transparent 79.7%, rgba(255,255,255,0.22) 79.7%, rgba(255,255,255,0.22) 80.3%, transparent 80.3%),
  repeating-linear-gradient(90deg, rgba(0,0,0,0.035) 0%, rgba(0,0,0,0.035) 12.5%, transparent 12.5%, transparent 25%),
  linear-gradient(90deg, #1b6033 0%, #154d28 100%)
`.trim();

function BracketVis({picks,onPick,results,interactive,tiebreak,setTiebreak,entries,noPickColors}){
  const eliminated=getEliminated(results);
  const cardRef=useRef(null);
  const[fieldBg,setFieldBg]=useState(FIELD_BG_LANDSCAPE);

  useEffect(()=>{
    const el=cardRef.current;
    if(!el)return;
    const ro=new ResizeObserver(([entry])=>{
      const{width,height}=entry.contentRect;
      setFieldBg(height>width?FIELD_BG_PORTRAIT:FIELD_BG_LANDSCAPE);
    });
    ro.observe(el);
    return()=>ro.disconnect();
  },[]);

  const pickPct=useMemo(()=>{
    if(!entries||entries.length===0) return {};
    const total=entries.length;
    const map={};
    for(let g=1;g<=15;g++){
      map[g]={};
      for(const e of entries){
        const t=e.picks?.[g];
        if(t) map[g][t]=(map[g][t]||0)+1;
      }
      for(const t of Object.keys(map[g])) map[g][t]=Math.round(map[g][t]/total*100);
    }
    return map;
  },[entries]);

  const Team=({team,seed,gameNum,scoreVal})=>{
    if(!team) return(
      <div style={{
        padding:"6px 10px",fontSize:15,color:C.textLight,fontStyle:"italic",
        background:"rgba(200,215,200,0.7)",borderRadius:6,marginBottom:2,minWidth:140,
        border:`1px dashed ${C.border}`,textAlign:"center",fontFamily:FONTS.body,
      }}>TBD</div>
    );
    const rw=results[gameNum]?.winner;
    const isRound1=gameNum<=8;
    const isEliminated=eliminated.has(norm(team));
    const combinedParts=team.includes("/")?team.split("/"):null;
    const correct=rw&&(combinedParts?combinedParts.some(t=>eq(t,rw)):eq(team,rw));
    const feederGame=!isRound1?BRACKET[gameNum]?.from?.find(f=>eq(picks[f],team)):null;
    const feederWinner=feederGame?results[feederGame]?.winner:null;
    const feederPlayed=!!feederWinner;
    const teamMadeItHere=feederPlayed&&eq(feederWinner,team);
    const deadPick=!isRound1&&!feederPlayed&&isEliminated;

    // Highlight selected pick in round 1 interactive mode (esp. for opening candidates)
    const isSelected=interactive&&isRound1&&!rw&&eq(team,picks[gameNum]);

    let bg="#1e3a28",border="rgba(255,255,255,0.15)",color="#fff",weight=400;
    if(isRound1){
      if(correct){weight=700;}
      else if(isSelected){weight=700;border="rgba(255,255,255,0.5)";}
    } else if(!noPickColors){
      if(teamMadeItHere)              {bg="#27ae60";border="#1e8449";color="#fff";}
      else if(feederPlayed||deadPick)  {bg="rgba(180,30,30,0.85)";border="#c0392b";color="#fff";}
      // Interactive pick mode: use opaque white so text is readable on dark field background
      else if(interactive)             {bg=C.bgCard;border=C.navyBorder;color=C.text;weight=600;}
    }
    if(!isRound1&&rw){weight=correct?700:400;}

    const strikeThrough=!isRound1&&(deadPick||(feederPlayed&&!teamMadeItHere));
    const dim=isRound1&&rw&&!correct;
    const logoFilter=dim?'grayscale(1) opacity(0.35)':strikeThrough?'grayscale(1) opacity(0.5)':"none";

    return(
      <div className={interactive?"team-btn":""} onClick={()=>interactive&&onPick&&onPick(gameNum,team)} style={{
        padding:"6px 8px",fontSize:15,fontWeight:weight,color,background:bg,
        border:`1.5px solid ${border}`,borderRadius:6,marginBottom:2,
        cursor:interactive?"pointer":"default",
        display:"flex",flexDirection:"column",justifyContent:"flex-start",
        minWidth:140,fontFamily:FONTS.body,
        boxShadow:isRound1&&isSelected&&!rw?"inset 0 0 0 2px #27ae60":undefined,
      }}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{display:"flex",alignItems:"center",gap:6}}>
            {combinedParts?(
              <span style={{display:"flex",alignItems:"center",gap:3}}>
                {combinedParts.map((t,i)=>(
                  <span key={t} style={{display:"flex",alignItems:"center",gap:2}}>
                    {i>0&&<span style={{color:C.textLight,fontSize:11,fontWeight:600}}>/</span>}
                    <TeamLogo team={t} size={16} style={{filter:logoFilter}}/>
                  </span>
                ))}
              </span>
            ):(
              <TeamLogo team={team} size={18} style={{filter:logoFilter}}/>
            )}
            {seed!=null&&<span style={{color:seed<=8?C.gold:"rgba(255,255,255,0.55)",fontSize:seed<=8?12:11,fontWeight:seed<=8?800:600,fontFamily:FONTS.mono,minWidth:16}}>{seed}</span>}
            <span style={{textDecoration:strikeThrough?"line-through":"none",opacity:dim?0.4:1}}>{team}</span>
            {pickPct[gameNum]?.[team]!=null&&(
              <span style={{fontSize:11,fontWeight:600,fontFamily:FONTS.mono,color:"rgba(255,255,255,0.6)",opacity:dim?0.4:1}}>
                {pickPct[gameNum][team]}%
              </span>
            )}
          </span>
          <span style={{display:"flex",alignItems:"center",gap:4}}>
            {scoreVal!=null&&(
              <span style={{fontFamily:FONTS.mono,fontSize:14,padding:"1px 5px",borderRadius:1,background:C.bgInset,color:C.text}}>{scoreVal}</span>
            )}
            {!noPickColors&&!isRound1&&teamMadeItHere&&<span style={{color:"#fff",fontSize:12}}>✓</span>}
            {!noPickColors&&!isRound1&&(deadPick||(feederPlayed&&!teamMadeItHere))&&<span style={{color:"#fff",fontSize:12}}>✗</span>}
          </span>
        </div>
        {combinedParts&&isRound1&&(
          <div style={{fontSize:10,color:C.textLight,fontFamily:FONTS.mono,letterSpacing:1,marginTop:2}}>OPENING RD · MAY 6</div>
        )}
        {!noPickColors&&!isRound1&&feederPlayed&&!teamMadeItHere&&feederWinner&&(
          <div style={{
            marginTop:3,paddingTop:3,borderTop:`1px solid rgba(255,255,255,0.2)`,
            display:"flex",alignItems:"center",gap:5,
            fontSize:13,color:"rgba(255,255,255,0.7)",fontWeight:500,fontFamily:FONTS.body,
          }}>
            <TeamLogo team={feederWinner} size={14} style={{filter:"grayscale(0.3) opacity(0.7)"}}/>
            <span>{feederWinner}</span>
          </div>
        )}
      </div>
    );
  };

  const Game=({g})=>{
    const cfg=BRACKET[g]; const r=results[g];
    let top,bottom,seedT,seedB;
    let bottomCandidates=null;
    const openingSeeds=cfg?.openingSeeds||[];

    if(g<=8){
      top=cfg.top; seedT=cfg.seedTop;
      if(cfg.openingCandidates){
        // Check if API has filled in actual teams for this game
        if(r?.teams?.length>=2){
          const nonTop=r.teams.find(t=>!eq(t,cfg.top));
          bottom=nonTop||cfg.openingCandidates[0];
          seedB=null;
        } else if(interactive){
          // Show both opening round candidates as pick options
          bottomCandidates=cfg.openingCandidates;
          bottom=null;
        } else {
          bottom=null; // TBD in non-interactive view
        }
      } else {
        bottom=cfg.bottom; seedB=cfg.seedBottom;
      }
    } else {
      const[f1,f2]=cfg.from;
      top=picks[f1]||null; bottom=picks[f2]||null;
      seedT=top?TEAM_SEEDS[top]??null:null;
      seedB=bottom?TEAM_SEEDS[bottom]??null:null;
    }

    return(
      <div style={{marginBottom:g<=8?4:8}}>
        <div style={{
          fontSize:12,fontWeight:700,letterSpacing:"1.5px",marginBottom:3,
          display:"flex",justifyContent:"space-between",alignItems:"center",
          fontFamily:FONTS.mono,textTransform:"uppercase",color:"rgba(255,255,255,0.75)",
        }}>
          <span>{POINTS[g]}PT</span>
          {r?.live&&<span style={{display:"flex",alignItems:"center",gap:3}}>
            <span style={{color:C.red,animation:"pulse 1.5s infinite"}}>●</span>
            <span style={{color:C.red}}>LIVE{r.period?` · ${r.period}`:""}</span>
          </span>}
          {r?.final&&<span style={{color:C.green}}>{r.period?.includes("OT")?r.period:"FINAL"}</span>}
        </div>
        <Team team={top} seed={seedT} gameNum={g} scoreVal={r?.scores?.[0]}/>
        {bottomCandidates?(
          <Team team={bottomCandidates.join("/")} seed={openingSeeds[0]??null} gameNum={g} scoreVal={null}/>
        ):(
          <Team team={bottom} seed={seedB} gameNum={g} scoreVal={r?.scores?.[1]}/>
        )}
        {r?.broadcaster&&r.live&&!r.final&&<BroadcasterBadge name={r.broadcaster}/>}
        {r?.startDate&&!r.final&&!r.live&&(
          <div style={{display:"flex",alignItems:"center",gap:4,marginTop:3,flexWrap:"wrap"}}>
            <span style={{fontFamily:FONTS.mono,fontSize:12,color:"rgba(255,255,255,0.7)",letterSpacing:0.5}}>
              {fmtDate(r.startDate)}{r.hasStartTime?` · ${fmtTime(r.startTime)}`:""}
            </span>
            {r.broadcaster&&<BroadcasterBadge name={r.broadcaster}/>}
          </div>
        )}
      </div>
    );
  };

  return(
    <div ref={cardRef}>
    <Card className="bracket-field" style={{overflow:"auto",padding:14,background:fieldBg}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gridTemplateRows:"1fr 1fr",gap:"0 10px",minWidth:1000}}>

        <div style={{gridRow:"1",gridColumn:"1",display:"flex",flexDirection:"column",justifyContent:"center",minHeight:320}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center"}}><Game g={1}/></div>
          <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center"}}><Game g={2}/></div>
        </div>
        <VCol jc="center" h={320} style={{gridRow:"1",gridColumn:"2"}}><Game g={9}/></VCol>

        <div style={{gridRow:"2",gridColumn:"1",display:"flex",flexDirection:"column",justifyContent:"center",minHeight:320}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center"}}><Game g={3}/></div>
          <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center"}}><Game g={4}/></div>
        </div>
        <VCol jc="center" h={320} style={{gridRow:"2",gridColumn:"2"}}><Game g={10}/></VCol>

        <div style={{gridRow:"1 / 3",gridColumn:"3",display:"flex",flexDirection:"column",justifyContent:"center"}}><Game g={13}/></div>
        <div style={{gridRow:"1 / 3",gridColumn:"4",display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center"}}>
          {(()=>{
            const champ=picks[15];
            const champElim=champ&&eliminated.has(norm(champ));
            const champColor=champElim?C.red:champ?"#fff":C.textLight;
            const champBorder=champElim?C.redBorder:champ?C.redDark:C.border;
            const champBg=champElim?C.redBg:champ?C.redDark:"rgba(200,215,200,0.7)";
            return(
              <div style={{textAlign:"center",marginBottom:20}}>
                <div style={{fontFamily:FONTS.display,fontSize:16,color:"rgba(255,255,255,0.8)",letterSpacing:"5px",marginBottom:10}}>🏆 CHAMPION</div>
                <div style={{
                  fontFamily:FONTS.display,fontSize:34,letterSpacing:2,
                  color:champColor,
                  padding:"16px 22px",minWidth:180,
                  border:`2px solid ${champBorder}`,
                  background:champBg,
                  borderRadius:8,
                  boxShadow:champ&&!champElim?`0 0 24px rgba(30,132,73,0.6)`:"none",
                  animation:champ&&!champElim?"champGlow 3s ease-in-out infinite":"none",
                  display:"flex",alignItems:"center",justifyContent:"center",gap:10,
                }}>
                  {champ&&<TeamLogo team={champ} size={36} style={champElim?{filter:"grayscale(1) opacity(0.5)"}:{filter:"brightness(0) invert(1)"}}/>}
                  <span style={{textDecoration:champElim?"line-through":"none"}}>{champ||"?"}</span>
                </div>
                {champ&&<div style={{fontFamily:FONTS.mono,fontSize:15,color:champElim?C.red:"#fff",marginTop:8,letterSpacing:2,fontWeight:700}}>8 POINTS</div>}
              </div>
            );
          })()}
          <Game g={15}/>
          {(tiebreak!=null||setTiebreak)&&(
            <div style={{marginTop:12,display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
              <span style={{fontFamily:FONTS.body,fontSize:14,fontWeight:700,color:"rgba(255,255,255,0.8)",letterSpacing:"2px",textTransform:"uppercase"}}>
                TIEBREAKER
              </span>
              <span style={{fontFamily:FONTS.body,fontSize:13,color:"rgba(255,255,255,0.6)",letterSpacing:"1px",textAlign:"center"}}>
                total goals · semis + final
              </span>
              {setTiebreak?(
                <input
                  value={tiebreak||""}
                  onChange={e=>setTiebreak(e.target.value.replace(/\D/g,""))}
                  placeholder="0"
                  style={{width:80,textAlign:"center",fontFamily:FONTS.mono,fontSize:28,fontWeight:700,marginTop:2}}
                />
              ):(
                <span style={{fontFamily:FONTS.mono,fontSize:28,fontWeight:700,color:C.navy,textAlign:"center"}}>
                  {tiebreak||"—"}
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{gridRow:"1 / 3",gridColumn:"5",display:"flex",flexDirection:"column",justifyContent:"center"}}><Game g={14}/></div>

        <VCol jc="center" h={320} style={{gridRow:"1",gridColumn:"6"}}><Game g={11}/></VCol>
        <div style={{gridRow:"1",gridColumn:"7",display:"flex",flexDirection:"column",justifyContent:"center",minHeight:320}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center"}}><Game g={5}/></div>
          <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center"}}><Game g={6}/></div>
        </div>

        <VCol jc="center" h={320} style={{gridRow:"2",gridColumn:"6"}}><Game g={12}/></VCol>
        <div style={{gridRow:"2",gridColumn:"7",display:"flex",flexDirection:"column",justifyContent:"center",minHeight:320}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center"}}><Game g={7}/></div>
          <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center"}}><Game g={8}/></div>
        </div>
      </div>
    </Card>
    </div>
  );
}

function VCol({children,jc,ai,h,style={}}){
  return <div style={{display:"flex",flexDirection:"column",justifyContent:jc||"center",alignItems:ai||"stretch",minHeight:h,...style}}>{children}</div>;
}

/* ═══════════════════════════════════════════════════
   EDIT BRACKET
   ═══════════════════════════════════════════════════ */
function EditBracket({onSubmit,entries,started,results}){
  const[editTarget,setEditTarget]=useState("");
  const[editMode,setEditMode]=useState(false);
  const[pinInput,setPinInput]=useState("");
  const[pinError,setPinError]=useState(false);
  const[verifying,setVerifying]=useState(false);
  const[entryData,setEntryData]=useState(null);

  const handleSelectEdit=e=>{
    const n=e.target.value;
    setEditTarget(n);
    if(n){setEditMode(true);setPinInput("");setPinError(false);setEntryData(null);}
    else{setEditMode(false);setEntryData(null);}
  };

  const verifyPin=async()=>{
    if(pinInput.length!==4){setPinError(true);return;}
    setVerifying(true);
    const entry=await verifyEntryPin(editTarget,pinInput);
    setVerifying(false);
    if(!entry){setPinError(true);return;}
    setEntryData(entry);
    setEditMode(false);
    setPinError(false);
  };

  if(entryData){
    return <PickFormEdit entry={entryData} pin={pinInput} onSubmit={onSubmit} started={started} results={results}/>;
  }

  if(editMode) return(
    <div style={{animation:"fadeIn 0.2s ease"}}>
      <Card style={{maxWidth:400,margin:"40px auto",padding:"40px 32px",textAlign:"center",borderLeftColor:C.navy}}>
        <div style={{fontSize:40,marginBottom:16}}>🔐</div>
        <div style={{fontFamily:FONTS.display,fontSize:30,color:C.navy,letterSpacing:"3px",marginBottom:6}}>ENTER YOUR PIN</div>
        <p style={{color:C.textMid,fontSize:17,marginBottom:24,lineHeight:1.5}}>
          Enter the 4-digit PIN you chose when you submitted{" "}
          <strong style={{color:C.text}}>{editTarget}</strong>'s bracket.
        </p>
        <input
          className="pin-input"
          value={pinInput}
          onChange={e=>{setPinInput(e.target.value.replace(/\D/g,"").slice(0,4));setPinError(false);}}
          placeholder="····"
          maxLength={4}
          autoFocus
          onKeyDown={e=>e.key==="Enter"&&pinInput.length===4&&verifyPin()}
        />
        {pinError&&(
          <p style={{color:C.red,fontSize:16,fontWeight:700,letterSpacing:1,marginTop:8,marginBottom:0}}>
            Incorrect PIN — try again.
          </p>
        )}
        <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:20}}>
          <button onClick={verifyPin} disabled={pinInput.length!==4||verifying} style={{
            ...navyBtn,
            opacity:pinInput.length!==4||verifying?0.4:1,
            cursor:pinInput.length!==4||verifying?"not-allowed":"pointer",
          }}>
            {verifying?"CHECKING…":"UNLOCK PICKS"}
          </button>
          <button onClick={()=>{setEditMode(false);setEditTarget("");setPinInput("");}} style={secondaryBtn}>CANCEL</button>
        </div>
        <p style={{marginTop:20,fontSize:14,color:C.textLight,fontFamily:FONTS.mono,letterSpacing:1}}>
          Lost your PIN? Ask the pool admin to reset it.
        </p>
      </Card>
    </div>
  );

  if(!entries.length) return(
    <Card style={{textAlign:"center",padding:60}}>
      <div style={{fontFamily:FONTS.display,fontSize:32,color:C.navy,letterSpacing:"4px"}}>NO ENTRIES YET</div>
      <div style={{color:C.textLight,marginTop:8}}>Submit a bracket first!</div>
    </Card>
  );

  return(
    <Card style={{maxWidth:500,margin:"40px auto",padding:"40px 32px",textAlign:"center",borderTop:`4px solid ${C.navy}`}}>
      <div style={{fontSize:40,marginBottom:16}}>✏️</div>
      <div style={{fontFamily:FONTS.display,fontSize:30,color:C.navy,letterSpacing:"3px",marginBottom:6}}>EDIT YOUR BRACKET</div>
      <p style={{color:C.textMid,fontSize:17,marginBottom:24,lineHeight:1.5}}>
        Select your bracket name to edit your picks.
      </p>
      <Fld label="Select your bracket" flex="1">
        <select onChange={handleSelectEdit} value={editTarget} style={{maxWidth:300,margin:"0 auto"}}>
          <option value="">Select name…</option>
          {[...entries].sort((a,b)=>a.name.localeCompare(b.name)).map(e=>(
            <option key={e.name} value={e.name}>{e.name}</option>
          ))}
        </select>
      </Fld>
    </Card>
  );
}

function PickFormEdit({entry,pin,onSubmit,started,results}){
  const[name]=useState(entry.name);
  const[email,setEmail]=useState(entry.email||"");
  const[tiebreak,setTiebreak]=useState(entry.tiebreak?String(entry.tiebreak):"");
  const[picks,setPicks]=useState(entry.picks);
  const[submitted,setSubmitted]=useState(false);
  const[saving,setSaving]=useState(false);
  const[saveError,setSaveError]=useState(null);

  const doPick=(g,team)=>setPicks(cascade({...picks,[g]:team}));

  const submit=async()=>{
    if(!email.trim())return alert("Please enter your email.");
    if(!isComplete(picks))return alert("Please fill out all 15 picks.");
    if(!tiebreak)return alert("Please enter a tiebreaker.");
    setSaving(true);
    setSaveError(null);
    try{
      await onSubmit({name,email:email.trim(),tiebreak:Number(tiebreak),picks,submittedAt:new Date().toISOString(),pin},{isEdit:true});
      setSubmitted(true);
    }catch(e){setSaveError(e.message||"Save failed. Try again.");}
    finally{setSaving(false);}
  };

  if(submitted) return(
    <Card style={{textAlign:"center",padding:"60px 24px",borderTop:`4px solid ${C.navy}`}}>
      <div style={{fontSize:56,marginBottom:16}}>🎉</div>
      <div style={{fontFamily:FONTS.display,fontSize:52,color:C.navy,letterSpacing:"4px",marginBottom:8}}>PICKS UPDATED</div>
      <p style={{color:C.textMid,fontSize:18,marginBottom:4}}>
        <strong style={{color:C.text}}>{name}</strong>'s picks are saved.
      </p>
    </Card>
  );

  const cnt=Object.values(picks).filter(Boolean).length;
  const complete=isComplete(picks);

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card style={{padding:"16px 20px"}}>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{
            padding:"8px 14px",background:C.navyBg,
            border:`1px solid ${C.navyBorder}`,borderRadius:1,
            fontSize:15,fontFamily:FONTS.body,color:C.navy,
            letterSpacing:1,fontWeight:700,alignSelf:"flex-end",
          }}>
            ✏️ EDITING {name.toUpperCase()}
          </div>
          <Fld label="Email *" flex="1 1 180px">
            <input value={email} onChange={e=>setEmail(e.target.value)}/>
          </Fld>
          <button onClick={submit}
            disabled={!complete||!email.trim()||!tiebreak||saving}
            style={{
              ...primaryBtn,
              opacity:(!complete||!email.trim()||!tiebreak||saving)?0.35:1,
              cursor:(!complete||!email.trim()||!tiebreak||saving)?"not-allowed":"pointer",
              fontSize:17,padding:"10px 28px",letterSpacing:"3px",whiteSpace:"nowrap",alignSelf:"flex-end",
            }}>
            {saving?"SAVING…":"UPDATE PICKS ›"}
          </button>
        </div>
        {saveError&&(
          <div style={{marginTop:12,padding:"12px 16px",background:C.redBg,border:`1px solid ${C.redBorder}`,borderRadius:8,color:C.red,fontSize:15,fontWeight:600}}>
            {saveError}
            <button onClick={submit} style={{...primaryBtn,marginLeft:12,fontSize:13,padding:"6px 16px"}}>RETRY</button>
          </div>
        )}
      </Card>

      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{flex:1,height:6,background:C.bgInset,borderRadius:1,overflow:"hidden",border:`1px solid ${C.border}`}}>
          <div style={{
            width:`${(cnt/15)*100}%`,height:"100%",
            background:complete?C.green:C.red,
            borderRadius:1,transition:"width 0.3s",
          }}/>
        </div>
        <span style={{fontFamily:FONTS.mono,fontSize:16,color:complete?C.green:C.red,minWidth:40,fontWeight:700}}>{cnt}/15</span>
        {complete&&<span style={{fontFamily:FONTS.display,fontSize:16,color:C.green,letterSpacing:2}}>COMPLETE ✓</span>}
      </div>

      <BracketVis picks={picks} onPick={doPick} results={results} interactive tiebreak={tiebreak} setTiebreak={setTiebreak}/>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MESSAGE BOARD
   ═══════════════════════════════════════════════════ */
function MessageBoard({messages,onPost,onDelete,tableMissing}){
  const[author,setAuthor]=useState(()=>localStorage.getItem(CHAT_NAME_KEY)||"");
  const[body,setBody]=useState("");
  const[posting,setPosting]=useState(false);
  const[postError,setPostError]=useState(null);
  const bottomRef=useRef(null);
  const MAX_BODY=500;

  useEffect(()=>{
    bottomRef.current?.scrollIntoView({behavior:"smooth"});
  },[messages]);

  const submit=async e=>{
    e.preventDefault();
    if(!author.trim())return setPostError("Enter your name.");
    if(!body.trim())return setPostError("Message can't be empty.");
    if(body.length>MAX_BODY)return setPostError(`Max ${MAX_BODY} characters.`);
    setPosting(true);setPostError(null);
    localStorage.setItem(CHAT_NAME_KEY,author.trim());
    const ok=await onPost(author,body);
    setPosting(false);
    if(ok)setBody("");
    else setPostError("Couldn't post — try again.");
  };

  if(tableMissing) return(
    <Card style={{textAlign:"center",padding:48}}>
      <div style={{fontFamily:FONTS.display,fontSize:28,color:C.navy,letterSpacing:3,marginBottom:12}}>CHAT NOT SET UP YET</div>
      <p style={{color:C.textMid,fontSize:15,maxWidth:480,margin:"0 auto"}}>
        Run this SQL in your Supabase dashboard to create the messages table:
      </p>
      <pre style={{
        marginTop:16,textAlign:"left",background:C.bgInset,border:`1px solid ${C.border}`,
        borderRadius:6,padding:"14px 18px",fontSize:13,fontFamily:FONTS.mono,
        color:C.navy,overflowX:"auto",display:"inline-block",maxWidth:"100%",
      }}>{`create table lax_messages (\n  id bigint generated always as identity primary key,\n  author text not null,\n  body text not null,\n  created_at timestamptz default now()\n);\nalter table lax_messages enable row level security;\ncreate policy "read" on lax_messages for select using (true);\ncreate policy "insert" on lax_messages for insert with check (true);`}</pre>
    </Card>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card style={{padding:"16px 20px",borderLeftColor:C.lilac}}>
        <div style={{fontFamily:FONTS.display,fontSize:28,color:C.navy,letterSpacing:3,marginBottom:4}}>FRIENDLY BANTER 🥍</div>
        <div style={{color:C.textLight,fontSize:13}}>Updates every 60 seconds · {messages.length} message{messages.length!==1?"s":""}</div>
      </Card>

      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{maxHeight:480,overflowY:"auto",padding:"8px 0"}}>
          {messages.length===0&&(
            <div style={{textAlign:"center",padding:"40px 20px",color:C.textLight,fontStyle:"italic",fontSize:15}}>
              No messages yet — be the first to talk trash.
            </div>
          )}
          {messages.map((m,i)=>(
            <div key={m.id} style={{
              padding:"12px 20px",
              borderBottom:i<messages.length-1?`1px solid rgba(100,180,130,0.25)`:"none",
              background:i%2===0?"rgba(255,255,255,0.4)":"rgba(235,248,239,0.4)",
              display:"flex",gap:12,alignItems:"flex-start",
            }}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap",marginBottom:4}}>
                  <span style={{fontFamily:FONTS.display,fontSize:18,color:C.navy,letterSpacing:0.5,lineHeight:1}}>{m.author}</span>
                  <span style={{fontFamily:FONTS.mono,fontSize:12,color:C.textLight}}>
                    {new Date(m.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                    {" · "}
                    {new Date(m.created_at).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}
                  </span>
                </div>
                <div style={{fontSize:15,color:C.text,lineHeight:1.5,wordBreak:"break-word"}}>{m.body}</div>
              </div>
              {onDelete&&(
                <button onClick={()=>onDelete(m.id)} style={{
                  background:"none",border:`1px solid ${C.redBorder}`,borderRadius:4,
                  color:C.red,fontSize:12,padding:"2px 8px",cursor:"pointer",flexShrink:0,
                }}>✕</button>
              )}
            </div>
          ))}
          <div ref={bottomRef}/>
        </div>
      </Card>

      <Card style={{padding:"16px 20px"}}>
        <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            <Fld label="Your Name *" flex="0 1 200px">
              <input value={author} onChange={e=>setAuthor(e.target.value)} placeholder="e.g. LaxBro"/>
            </Fld>
            <Fld label={`Message * (${body.length}/${MAX_BODY})`} flex="1 1 300px">
              <input
                value={body}
                onChange={e=>setBody(e.target.value)}
                placeholder="Talk your talk…"
                maxLength={MAX_BODY}
                onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&submit(e)}
              />
            </Fld>
            <div style={{alignSelf:"flex-end"}}>
              <button type="submit" disabled={posting} style={{
                ...primaryBtn,
                opacity:posting?0.5:1,cursor:posting?"not-allowed":"pointer",
                fontSize:15,padding:"9px 24px",letterSpacing:"2px",
              }}>{posting?"POSTING…":"POST"}</button>
            </div>
          </div>
          {postError&&(
            <div style={{color:C.red,fontSize:14,fontWeight:600}}>{postError}</div>
          )}
        </form>
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   STANDINGS
   ═══════════════════════════════════════════════════ */
function Standings({entries,results,started,viewBracket,setViewBracket}){
  const eliminated=getEliminated(results);
  const hasResults=started;
  const[expanded,setExpanded]=useState(null);
  const[sortCol,setSortCol]=useState("Pts");
  const[sortDir,setSortDir]=useState("desc");

  const toggleSort=(col)=>{
    if(sortCol===col) setSortDir(d=>d==="asc"?"desc":"asc");
    else{setSortCol(col);setSortDir(col==="Name"||col==="Champion"?"asc":"desc");}
  };

  const scored=useMemo(()=>{
    const arr=entries.map(e=>{
      const s=scoreEntry(e,results);
      let alive=0;
      for(let g=1;g<=15;g++){if(!results[g]?.winner&&!eliminated.has(norm(e.picks[g])))alive+=POINTS[g];}
      return{...e,...s,alive};
    });
    arr.sort((a,b)=>b.total-a.total||b.maxPossible-a.maxPossible||a.name.localeCompare(b.name));
    let rank=1;
    arr.forEach((p,i)=>{if(i>0&&p.total<arr[i-1].total)rank=i+1;p.rank=rank;});
    const dir=sortDir==="asc"?1:-1;
    arr.sort((a,b)=>{
      switch(sortCol){
        case"#":return(a.rank-b.rank)*dir;
        case"Name":return a.name.localeCompare(b.name)*dir;
        case"Pts":return(a.total-b.total)*dir||(a.maxPossible-b.maxPossible)*dir;
        case"Max":return(a.maxPossible-b.maxPossible)*dir;
        case"Champion":return(a.picks[15]||"").localeCompare(b.picks[15]||"")*dir;
        case"TB":return((a.tiebreak||0)-(b.tiebreak||0))*dir;
        default:return 0;
      }
    });
    return arr;
  },[entries,results,eliminated,sortCol,sortDir]);

  const rankColors={1:C.gold,2:"#a0a5b0",3:"#b87333"};

  if(viewBracket&&!started){
    return(
      <div>
        <button onClick={()=>setViewBracket(null)} style={{...secondaryBtn,marginBottom:16}}>← BACK TO STANDINGS</button>
        <Card style={{textAlign:"center",padding:"40px 20px",borderLeftColor:C.gold}}>
          <div style={{fontFamily:FONTS.display,fontSize:24,color:C.navy,letterSpacing:"3px",marginBottom:8}}>BRACKETS LOCKED</div>
          <div style={{color:C.textLight,fontSize:14}}>Other brackets are hidden until games begin.</div>
        </Card>
      </div>
    );
  }

  if(viewBracket){
    const e=entries.find(x=>x.name===viewBracket);
    if(!e)return null;
    const sc=scored.find(x=>x.name===viewBracket);
    return(
      <div>
        <button onClick={()=>setViewBracket(null)} style={{...secondaryBtn,marginBottom:16}}>← BACK TO STANDINGS</button>
        <Card style={{marginBottom:14,padding:"16px 20px",borderLeftColor:C.lilac}}>
          <div style={{fontFamily:FONTS.display,fontSize:32,color:C.navy,letterSpacing:2,marginBottom:6}}>{e.name}</div>
          <div style={{fontSize:16,fontFamily:FONTS.display,color:C.textMid,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",letterSpacing:0.5}}>
            <span>Champion:</span>
            <TeamLogo team={e.picks[15]} size={18}/>
            <strong style={{color:C.red,fontWeight:700}}>{e.picks[15]}</strong>
            {sc&&hasResults&&<>
              <span style={{color:C.border}}>·</span>
              <span>Rank: <strong style={{color:C.red}}>#{sc.rank}</strong></span>
              <span style={{color:C.border}}>·</span>
              <span>Pts: <strong style={{color:C.red}}>{sc.total}</strong></span>
              <span style={{color:C.border}}>·</span>
              <span>Max: <strong style={{color:C.red}}>{sc.maxPossible}</strong></span>
            </>}
            <span style={{color:C.border}}>·</span>
            <span>Tiebreaker: <strong style={{color:C.red}}>{e.tiebreak} goals</strong></span>
          </div>
        </Card>
        <BracketVis picks={e.picks} onPick={null} results={results}/>
      </div>
    );
  }

  if(!entries.length) return(
    <Card style={{textAlign:"center",padding:60}}>
      <div style={{fontFamily:FONTS.display,fontSize:36,color:C.navy,letterSpacing:"4px"}}>NO ENTRIES YET</div>
      <div style={{color:C.textLight,marginTop:8}}>Submit picks in the bracket tab!</div>
    </Card>
  );

  const semi1=results[13],semi2=results[14],champResult=results[15];
  const allTBGamesFinal=semi1?.final&&semi2?.final&&champResult?.final;
  const tbGoals=allTBGamesFinal?
    (semi1.scores[0]||0)+(semi1.scores[1]||0)+
    (semi2.scores[0]||0)+(semi2.scores[1]||0)+
    (champResult.scores[0]||0)+(champResult.scores[1]||0):null;

  if(!hasResults) return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card style={{textAlign:"center",padding:"32px 20px"}}>
        <div style={{fontFamily:FONTS.display,fontSize:28,color:C.navy,letterSpacing:"4px",marginBottom:8}}>TOURNAMENT HASN'T STARTED</div>
        <div style={{color:C.textLight,fontSize:14,marginBottom:8}}>Standings will update live once games begin.</div>
        <div style={{fontSize:40,marginTop:16}}>🥍</div>
      </Card>
      <ScoringKey/>
      <SectionHeader>ALL ENTRIES ({entries.length})</SectionHeader>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
        {[...entries].sort((a,b)=>a.name.localeCompare(b.name)).map((e,i)=>(
          <Card key={e.name} style={{padding:"16px 18px",transform:`rotate(${(i%3-1)*0.5}deg)`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
              <div style={{fontFamily:FONTS.display,fontSize:22,color:C.navy,letterSpacing:1}}>{e.name}</div>
              <span style={{fontSize:11,fontWeight:700,fontFamily:FONTS.mono,letterSpacing:1,padding:"2px 8px",borderRadius:4,
                background:e.paid?C.greenBg:C.redBg,color:e.paid?C.green:C.red,border:`1px solid ${e.paid?C.greenBorder:C.redBorder}`}}>
                {e.paid?"PAID":"UNPAID"}
              </span>
            </div>
            {e.submittedAt&&<div style={{fontFamily:FONTS.mono,fontSize:14,color:C.textLight,marginTop:4}}>{new Date(e.submittedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"})} · {new Date(e.submittedAt).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}</div>}
          </Card>
        ))}
      </div>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card style={{padding:0,overflow:"hidden",borderLeftColor:C.navy,
        background:`
          radial-gradient(ellipse 140px 100px at 50% 50%, rgba(100,200,140,0.15) 0%, transparent 70%),
          linear-gradient(180deg, #ebf7ee 0%, #daeee0 100%)
        `,
      }}>
        {tbGoals!==null&&(
          <div style={{padding:"12px 20px",background:"rgba(184,140,16,0.12)",borderBottom:`1px solid rgba(184,140,16,0.25)`,fontFamily:FONTS.mono,fontSize:16,color:C.gold,letterSpacing:1,fontWeight:700,backdropFilter:"blur(4px)"}}>
            🏆 SEMIS + CHAMPIONSHIP TOTAL GOALS: {tbGoals} — TIEBREAKER TARGET
          </div>
        )}
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{borderBottom:`2px solid rgba(14,115,64,0.2)`,background:"rgba(100,200,140,0.15)"}}>
                {["#","Name","Pts","Max","Champion","TB"].map(h=>(
                  <th key={h} onClick={()=>toggleSort(h)} style={{textAlign:h==="Name"?"left":"center",padding:"11px 14px",color:C.navy,fontSize:13,fontWeight:700,letterSpacing:"2px",textTransform:"uppercase",whiteSpace:"nowrap",fontFamily:FONTS.body,cursor:"pointer",userSelect:"none"}}>
                    {h}{sortCol===h?(sortDir==="asc"?" ▲":" ▼"):""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scored.map((p,i)=>{
                const cElim=eliminated.has(norm(p.picks[15]));
                const cWon=results[15]?.winner&&eq(p.picks[15],results[15].winner);
                const tbDiff=tbGoals!==null&&p.tiebreak?Math.abs(p.tiebreak-tbGoals):null;
                const isExp=expanded===p.name;
                const rows=[(
                  <tr key={p.name} onClick={()=>setExpanded(isExp?null:p.name)} style={{
                    borderBottom:`1px solid rgba(100,180,130,0.25)`,
                    background:isExp?"rgba(39,174,96,0.08)":i%2===0?"rgba(255,255,255,0.5)":"rgba(235,248,239,0.5)",
                    transition:"background 0.1s",
                    ...(p.rank<=3&&!isExp?{borderLeft:`4px solid ${rankColors[p.rank]}`,boxShadow:p.rank===1?`inset 0 0 30px rgba(184,140,16,0.08)`:"none"}:{}),
                  }}>
                    <td style={{textAlign:"center",padding:"6px 14px"}}>
                      <span style={{fontFamily:FONTS.display,fontSize:16,color:rankColors[p.rank]||C.textMid,letterSpacing:1}}>{p.rank}</span>
                    </td>
                    <td style={{padding:"6px 14px",fontWeight:700,fontFamily:FONTS.body,fontSize:14}}>
                      <span onClick={e=>{e.stopPropagation();setViewBracket(p.name);}} style={{color:C.navy,cursor:"pointer",textDecoration:"underline",textUnderlineOffset:2}}>{p.name}</span>
                    </td>
                    <td style={{textAlign:"center",padding:"6px 14px"}}>
                      <span style={{fontFamily:FONTS.display,fontSize:16,color:C.red,letterSpacing:1}}>{p.total}</span>
                    </td>
                    <td style={{textAlign:"center",padding:"6px 14px",fontFamily:FONTS.mono,fontSize:15,color:C.textLight}}>{p.maxPossible}</td>
                    <td style={{textAlign:"center",padding:"6px 14px"}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:6,fontWeight:700,color:cWon?C.green:cElim?C.red:C.text,textDecoration:cElim?"line-through":"none"}}>
                        <TeamLogo team={p.picks[15]} size={16} style={{filter:cElim?"grayscale(1) opacity(0.4)":"none"}}/>
                        {p.picks[15]}
                      </span>
                    </td>
                    <td style={{textAlign:"center",padding:"6px 14px",fontFamily:FONTS.mono,fontSize:15,color:C.textMid}}>
                      {p.tiebreak||"—"}{tbDiff!==null&&<span style={{fontSize:13,color:C.textLight,marginLeft:3}}>(±{tbDiff})</span>}
                    </td>
                  </tr>
                )];
                if(isExp) rows.push(
                  <tr key={p.name+"_d"}>
                    <td colSpan={8} style={{padding:"8px 14px 16px",background:"rgba(100,200,140,0.1)",borderBottom:`1px solid rgba(100,180,130,0.25)`}}>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:4}}>
                        {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(g=>{
                          const d=p.details[g];const pElim=eliminated.has(norm(d.pick));
                          return(
                            <div key={g} style={{
                              padding:"5px 8px",fontSize:14,borderRadius:1,
                              background:d.correct===true?C.greenBg:d.correct===false?C.redBg:"rgba(255,255,255,0.5)",
                              border:`1px solid ${d.correct===true?C.greenBorder:d.correct===false?C.redBorder:"rgba(100,180,130,0.3)"}`,
                              display:"flex",alignItems:"center",gap:5,
                            }}>
                              <span style={{fontFamily:FONTS.mono,color:C.textLight,fontSize:12,minWidth:28}}>G{g}·{POINTS[g]}p</span>
                              <TeamLogo team={d.pick} size={14} style={{filter:pElim&&d.correct===null?"grayscale(1) opacity(0.4)":"none"}}/>
                              <span style={{fontWeight:700,color:d.correct===true?C.green:d.correct===false?C.red:pElim&&d.correct===null?C.textLight:C.text,textDecoration:pElim&&d.correct===null?"line-through":"none"}}>
                                {d.pick}{d.correct===true?" ✓":d.correct===false?" ✗":""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
                return rows;
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <ScoringKey/>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   BROWSE BRACKETS
   ═══════════════════════════════════════════════════ */
function BrowseBrackets({entries,results,started}){
  const sorted=[...entries].sort((a,b)=>a.name.localeCompare(b.name));
  const[selected,setSelected]=useState("");
  const entry=sorted.find(e=>e.name===selected)||null;
  const eliminated=getEliminated(results);
  const hasResults=started;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {!started&&(
        <Card style={{textAlign:"center",padding:"24px 20px",borderLeftColor:C.gold}}>
          <div style={{fontFamily:FONTS.display,fontSize:22,color:C.navy,letterSpacing:"3px",marginBottom:6}}>BRACKETS LOCKED</div>
          <div style={{color:C.textLight,fontSize:14}}>Other brackets are hidden until games begin. Check back once the tournament starts!</div>
        </Card>
      )}
      {started&&(
        <>
          <Card style={{padding:"20px 24px"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <select
                value={selected}
                onChange={e=>setSelected(e.target.value)}
                style={{
                  fontFamily:FONTS.mono,fontSize:15,padding:"8px 12px",
                  border:`1.5px solid rgba(100,180,130,0.4)`,borderRadius:6,
                  background:"rgba(255,255,255,0.6)",color:C.text,cursor:"pointer",minWidth:220,
                }}
              >
                <option value="">— pick a bracket —</option>
                {sorted.map(e=>(
                  <option key={e.name} value={e.name}>{e.name}</option>
                ))}
              </select>
            </div>
          </Card>

          {entry&&(
            <div>
              <Card style={{marginBottom:14,padding:"16px 20px",borderLeftColor:C.lilac}}>
                <div style={{fontFamily:FONTS.display,fontSize:32,color:C.navy,letterSpacing:2,marginBottom:6}}>{entry.name}</div>
                <div style={{fontSize:16,fontFamily:FONTS.display,color:C.textMid,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",letterSpacing:0.5}}>
                  <span>Champion:</span>
                  <TeamLogo team={entry.picks[15]} size={18}/>
                  <strong style={{color:C.red,fontWeight:700}}>{entry.picks[15]}</strong>
                  {hasResults&&(()=>{
                    const sc=scoreEntry(entry,results);
                    const cElim=eliminated.has(norm(entry.picks[15]));
                    return(<>
                      <span style={{color:C.border}}>·</span>
                      <span>Pts: <strong style={{color:C.red}}>{sc.total}</strong></span>
                      <span style={{color:C.border}}>·</span>
                      <span>Max: <strong style={{color:C.red}}>{sc.maxPossible}</strong></span>
                      {cElim&&<span style={{fontSize:13,color:C.red,fontWeight:700}}>· Champion eliminated</span>}
                    </>);
                  })()}
                  <span style={{color:C.border}}>·</span>
                  <span>Tiebreaker: <strong style={{color:C.red}}>{entry.tiebreak} goals</strong></span>
                </div>
              </Card>
              <BracketVis picks={entry.picks} onPick={null} results={results}/>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   RULES
   ═══════════════════════════════════════════════════ */
function Rules(){
  const rules=[
    {title:"BUY IN",text:"$10 per bracket. Venmo @drew-pynchon to complete your entry. Your entry is not official until payment is received."},
    {title:"PAYOUTS",text:"TBD"},
    {title:"BRACKETS DUE",text:"Wednesday, May 6 at 7:00 PM ET (prior to Opening Round)."},
    {title:"SCORING",items:[
      "First Round: 1 point",
      "Quarterfinals: 2 points",
      "Semi-finals: 4 points",
      "Championship: 8 points",
      `Maximum possible: ${MAX_PTS} points`,
    ]},
    {title:"OPENING ROUND NOTE",text:"Two opening round games are played May 6 (Marist/Stony Brook and Robert Morris/Jacksonville). Winners face the #1 and #2 seeds in the First Round. Pick any of these teams — if your pick wins the opening round AND the first round game, you get the point."},
    {title:"TIEBREAKER",text:"Total combined goals scored in both semi-finals and the championship. Whoever guesses closest wins the tiebreaker."},
    {title:"EDITING YOUR PICKS",text:"When you submit your bracket, you'll choose a 4-digit PIN. Use this PIN to edit your picks anytime before the deadline."},
  ];
  return(
    <div style={{display:"flex",flexDirection:"column",gap:16,maxWidth:700,margin:"0 auto"}}>
      <Card style={{textAlign:"center",padding:"32px 20px",borderLeft:`4px solid ${C.lilac}`}}>
        <div style={{fontFamily:FONTS.display,fontSize:36,color:C.navy,letterSpacing:"4px",marginBottom:8}}>POOL RULES</div>
        <div style={{color:C.textMid,fontSize:14}}>NCAA D1 Men's Lacrosse Championship · {YEAR}</div>
      </Card>
      {rules.map(r=>(
        <Card key={r.title} style={{padding:"20px 24px"}}>
          <div style={{fontFamily:FONTS.display,fontSize:20,color:C.navy,letterSpacing:2,marginBottom:10}}>{r.title}</div>
          {r.text&&<div style={{fontSize:17,color:C.textMid,lineHeight:1.6}}>{r.text}</div>}
          {r.items&&(
            <ul style={{margin:0,paddingLeft:20,fontSize:17,color:C.textMid,lineHeight:1.8}}>
              {r.items.map((item,i)=><li key={i}>{item}</li>)}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ADMIN
   ═══════════════════════════════════════════════════ */
function Manage({entries,onDelete,onRefresh}){
  const[confirm,setConfirm]=useState(null);
  const[adminEntries,setAdminEntries]=useState([]);
  const[loadingPins,setLoadingPins]=useState(true);
  const[resetResult,setResetResult]=useState(null);
  const[paidMap,setPaidMap]=useState({});

  useEffect(()=>{
    setLoadingPins(true);
    loadEntriesWithPins().then(data=>{
      setAdminEntries(data);
      setLoadingPins(false);
      const pm={};data.forEach(e=>{pm[e.name]=!!e.paid;});setPaidMap(pm);
    });
  },[entries]);

  const togglePaid=async(name)=>{
    const newVal=!paidMap[name];
    setPaidMap(prev=>({...prev,[name]:newVal}));
    await updatePaidStatus(name,newVal);
  };

  const doResetPin=async name=>{
    const pin=await resetEntryPin(name);
    if(pin){
      setResetResult({name,pin});
      setAdminEntries(prev=>prev.map(e=>e.name===name?{...e,pin}:e));
    }
  };

  const exportCSV=()=>{
    let csv="Name,Email,Tiebreaker,Submitted";
    for(let g=1;g<=15;g++)csv+=`,Game ${g} (${ROUND_LABEL(g)} ${POINTS[g]}pt)`;
    csv+="\n";
    entries.forEach(e=>{
      csv+=`"${e.name}","${e.email||""}",${e.tiebreak||""},"${e.submittedAt}"`;
      for(let g=1;g<=15;g++)csv+=`,"${e.picks[g]||""}"`;
      csv+="\n";
    });
    dl(csv,"mlax_2026_entries.csv","text/csv");
  };

  const exportJSON=()=>dl(JSON.stringify(entries,null,2),"mlax_2026.json","application/json");
  const dl=(c,f,t)=>{const b=new Blob([c],{type:t});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=f;a.click();URL.revokeObjectURL(u);};
  const clearAll=async()=>{if(!window.confirm("Delete ALL entries? This cannot be undone."))return;for(const e of entries)await onDelete(e.name);};

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <Card>
        <SectionHeader>⚙️ ADMIN PANEL</SectionHeader>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[{l:"↓ CSV",f:exportCSV},{l:"↓ JSON",f:exportJSON},{l:"↻ REFRESH",f:onRefresh}].map(b=>(
            <button key={b.l} onClick={b.f} style={secondaryBtn}>{b.l}</button>
          ))}
          <button onClick={clearAll} style={{...secondaryBtn,color:C.red,borderColor:C.redBorder}}>🗑 DELETE ALL</button>
        </div>
      </Card>

      {resetResult&&(
        <Card style={{borderTop:`4px solid ${C.gold}`,padding:"16px 20px"}}>
          <div style={{fontFamily:FONTS.display,fontSize:18,color:C.gold,letterSpacing:2,marginBottom:8}}>PIN RESET</div>
          <p style={{color:C.textMid,fontSize:17,margin:0}}>
            <strong style={{color:C.text}}>{resetResult.name}</strong>'s new PIN:{" "}
            <strong style={{fontFamily:FONTS.mono,fontSize:22,color:C.red,letterSpacing:6}}>{resetResult.pin}</strong>
          </p>
          <button onClick={()=>setResetResult(null)} style={{...secondaryBtn,marginTop:10,fontSize:11}}>DISMISS</button>
        </Card>
      )}

      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{
          padding:"14px 20px",borderBottom:`2px solid ${C.navy}`,
          display:"flex",alignItems:"center",justifyContent:"space-between",
          background:C.bgInset,
        }}>
          <span style={{fontFamily:FONTS.display,fontSize:20,color:C.navy,letterSpacing:2}}>ENTRIES & PINS ({entries.length})</span>
          {loadingPins&&<span style={{fontSize:14,color:C.textLight,fontFamily:FONTS.mono}}>LOADING…</span>}
        </div>
        {!entries.length?(
          <div style={{padding:"24px 20px",color:C.textLight,fontSize:13}}>No entries yet.</div>
        ):(
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr style={{background:C.bgInset,borderBottom:`1px solid ${C.border}`}}>
                  {["Name","Email","Champion","TB","PIN","Paid","Submitted","Actions"].map(h=>(
                    <th key={h} style={{
                      padding:"10px 14px",
                      textAlign:h==="Name"||h==="Actions"?"left":"center",
                      color:C.navy,fontSize:13,fontWeight:700,letterSpacing:"2px",
                      fontFamily:FONTS.body,textTransform:"uppercase",whiteSpace:"nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...entries].sort((a,b)=>a.name.localeCompare(b.name)).map((e,i)=>{
                  const ae=adminEntries.find(x=>x.name===e.name);
                  return(
                    <tr key={e.name} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?C.bgCard:C.bgCardAlt}}>
                      <td style={{padding:"10px 14px",fontWeight:700,color:C.text}}>{e.name}</td>
                      <td style={{padding:"10px 14px",color:C.textLight,fontSize:12}}>{e.email||"—"}</td>
                      <td style={{padding:"10px 14px",textAlign:"center"}}>
                        <span style={{display:"inline-flex",alignItems:"center",gap:5,color:C.red,fontWeight:700}}>
                          <TeamLogo team={e.picks[15]} size={14}/>{e.picks[15]}
                        </span>
                      </td>
                      <td style={{padding:"10px 14px",textAlign:"center",fontFamily:FONTS.mono,fontSize:15,color:C.textMid}}>{e.tiebreak}</td>
                      <td style={{padding:"10px 14px",textAlign:"center"}}>
                        <span style={{fontFamily:FONTS.mono,fontSize:18,color:ae?.pin?C.red:C.textLight,letterSpacing:4,fontWeight:700}}>
                          {loadingPins?"…":ae?.pin||"—"}
                        </span>
                      </td>
                      <td style={{padding:"10px 14px",textAlign:"center"}}>
                        <button onClick={()=>togglePaid(e.name)} style={{
                          background:paidMap[e.name]?C.greenBg:"transparent",
                          border:`1.5px solid ${paidMap[e.name]?C.greenBorder:C.border}`,
                          borderRadius:1,padding:"4px 12px",cursor:"pointer",
                          fontFamily:FONTS.mono,fontSize:15,fontWeight:700,
                          color:paidMap[e.name]?C.green:C.textLight,
                        }}>
                          {paidMap[e.name]?"PAID ✓":"UNPAID"}
                        </button>
                      </td>
                      <td style={{padding:"10px 14px",textAlign:"center",fontFamily:FONTS.mono,fontSize:14,color:C.textLight}}>
                        {e.submittedAt?new Date(e.submittedAt).toLocaleDateString():"—"}
                      </td>
                      <td style={{padding:"10px 14px"}}>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <button onClick={()=>doResetPin(e.name)} style={{...secondaryBtn,fontSize:14,padding:"5px 10px",color:C.gold,borderColor:`rgba(184,140,16,0.4)`}}>
                            RESET PIN
                          </button>
                          {confirm===e.name?(
                            <>
                              <button onClick={()=>{onDelete(e.name);setConfirm(null);}} style={{...secondaryBtn,fontSize:14,padding:"5px 10px",color:C.red,borderColor:C.redBorder,fontWeight:700}}>CONFIRM</button>
                              <button onClick={()=>setConfirm(null)} style={{...secondaryBtn,fontSize:14,padding:"5px 10px"}}>CANCEL</button>
                            </>
                          ):(
                            <button onClick={()=>setConfirm(e.name)} style={{...secondaryBtn,fontSize:14,padding:"5px 10px",color:C.red,borderColor:C.redBorder}}>DELETE</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
