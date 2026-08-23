(() => {
"use strict";

const C = window.ROOM_ISP_CONFIG || {};
const $ = (s,p=document) => p.querySelector(s);
const $$ = (s,p=document) => [...p.querySelectorAll(s)];
const app = $("#app");
const LOCALE = C.LOCALE || "es-PE";
const CURRENCY = C.CURRENCY || "PEN";

if (!C.SUPABASE_URL || !C.SUPABASE_PUBLISHABLE_KEY || C.SUPABASE_PUBLISHABLE_KEY.includes("PEGA_AQUI")) {
  app.innerHTML = `<div class="boot"><div class="card" style="max-width:620px"><h2>Configuración pendiente</h2><p class="muted">Completa <b>config.js</b> con la URL y Publishable key de Supabase. Nunca uses service_role ni secret keys en la web.</p></div></div>`;
  return;
}

const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
});

const state = {
  session:null,user:null,role:null,memberRole:null,org:null,orgs:[],customer:null,
  page:"dashboard",map:null,charts:[],theme:localStorage.getItem("roomisp-theme") || "light",
  aal:null, factors:[], caches:{}
};

document.documentElement.dataset.theme = state.theme;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const money = (n) => new Intl.NumberFormat(LOCALE,{style:"currency",currency:CURRENCY,maximumFractionDigits:2}).format(Number(n||0));
const date = (v) => v ? new Intl.DateTimeFormat(LOCALE,{dateStyle:"medium"}).format(new Date(String(v).length===10?`${v}T12:00:00`:v)) : "—";
const dt = (v) => v ? new Intl.DateTimeFormat(LOCALE,{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)) : "—";
const mbps = (bps) => `${Math.round(Number(bps||0)/1_000_000)} Mbps`;
const initials = (s) => String(s||"U").split(/[\s@._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
const val = (f,n) => f.elements[n]?.value?.trim?.() ?? "";
const num = (f,n) => Number(f.elements[n]?.value || 0);
const one = (v) => Array.isArray(v) ? (v[0] || {}) : (v || {});

function toast(message,type="ok"){
  const el=document.createElement("div"); el.className=`toast ${type}`; el.textContent=message;
  $("#toast-root").appendChild(el); setTimeout(()=>el.remove(),3800);
}

function badge(status){
  const s=String(status||"—").toUpperCase();
  const ok=["ACTIVE","ONLINE","PAID","APPROVED","COMPLETED","SENT","CONFIRMED","RESOLVED"].includes(s);
  const danger=["SUSPENDED","OFFLINE","REJECTED","FAILED","CANCELLED","DISABLED","CRITICAL"].includes(s);
  return `<span class="badge ${ok?"ok":danger?"danger":"warn"}"><span class="dot"></span>${esc(s)}</span>`;
}
function icon(name){return `<i data-lucide="${esc(name)}"></i>`}
function hydrateIcons(){try{window.lucide?.createIcons()}catch{}}
function destroyVisuals(){state.charts.forEach(c=>{try{c.destroy()}catch{}});state.charts=[];if(state.map){try{state.map.remove()}catch{}state.map=null}}

async function api(url,body){
  if(!url) throw new Error("API no configurada");
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${state.session?.access_token||""}`,"apikey":C.SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok || j.ok===false) throw new Error(j.error?.message||j.error||j.message||`HTTP ${r.status}`);
  return j;
}
const adminApi=(action,payload={})=>api(C.ADMIN_API_URL,{action,organization_id:state.org?.id,...payload});
const superApi=(action,payload={})=>api(C.SUPERADMIN_API_URL,{action,...payload});

function pageHead(title,desc,actions=""){
 return `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(desc)}</p></div><div class="page-actions">${actions}</div></div>`;
}
function table(headers,rows){
 if(!rows.length)return `<div class="empty">${icon("inbox")}<div style="height:8px"></div>Aún no hay registros para mostrar.</div>`;
 return `<div class="table-wrap"><table class="table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function kpi(label,value,iconName,accent="var(--primary)",hint="Datos en tiempo real"){
 return `<div class="card kpi" style="--accent:${accent}"><div class="kpi-icon">${icon(iconName)}</div><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="hint">${esc(hint)}</div></div>`;
}
function modal(title,body,onSave,saveText="Guardar"){
 const back=document.createElement("div"); back.className="modal-back";
 back.innerHTML=`<form class="modal"><div class="modal-head"><h3>${esc(title)}</h3><button class="btn ghost icon sm" type="button" data-close>${icon("x")}</button></div><div class="modal-body">${body}</div><div class="modal-actions"><button class="btn ghost" type="button" data-close>Cancelar</button>${onSave?`<button class="btn primary" type="submit">${esc(saveText)}</button>`:""}</div></form>`;
 document.body.appendChild(back);hydrateIcons();
 $$('[data-close]',back).forEach(b=>b.onclick=()=>back.remove());
 back.addEventListener("mousedown",e=>{if(e.target===back)back.remove()});
 if(onSave){$("form",back).onsubmit=async e=>{e.preventDefault();const b=$("button[type=submit]",back);b.disabled=true;try{await onSave(e.currentTarget);back.remove();toast("Guardado correctamente");await navigate(state.page)}catch(err){toast(err.message,"error");b.disabled=false}}}
 return back;
}
function confirmModal(title,message,actionText,onConfirm){
 return modal(title,`<div class="notice danger">${esc(message)}</div>`,onConfirm,actionText);
}
function renderError(err){return `<div class="notice danger"><b>No se pudo cargar esta sección.</b><br>${esc(err?.message||err)}</div>`}

function setTheme(theme){state.theme=theme;localStorage.setItem("roomisp-theme",theme);document.documentElement.dataset.theme=theme;hydrateIcons()}

function showLogin(){
 destroyVisuals();state.role=null;state.org=null;state.customer=null;
 app.innerHTML=`<div class="auth">
  <section class="auth-visual">
   <div class="brand"><div class="brand-mark">R</div><div class="brand-copy"><strong>ROOM ISP</strong><span>ISP Control Suite</span></div></div>
   <div class="auth-copy">
    <div class="eyebrow">${icon("shield-check")} Plataforma segura para ISP / WISP</div>
    <h1>Control total de tu red. <span>Una sola plataforma.</span></h1>
    <p>Clientes, MikroTik, cobranza, Telegram, NOC, incidencias, técnicos, inventario y mapa. Diseñado para crecer desde un ISP local hasta una operación multiempresa.</p>
   </div>
   <div class="auth-features">
    <div class="auth-feature"><b>Multi ISP + RLS</b><span>Aislamiento real por organización.</span></div>
    <div class="auth-feature"><b>MikroTik seguro</b><span>HTTPS saliente, command queue y ACK.</span></div>
    <div class="auth-feature"><b>Telegram integrado</b><span>Pagos, soporte, avisos y GPS.</span></div>
   </div>
  </section>
  <section class="auth-panel"><form id="login-form" class="login-card">
   <div class="brand mobile-brand"><div class="brand-mark">R</div><div class="brand-copy"><strong style="color:var(--text)">ROOM ISP</strong><span>ISP Control Suite</span></div></div>
   <div class="eyebrow" style="color:var(--primary);border-color:var(--line);background:var(--primary-soft)">${icon("lock-keyhole")} Acceso seguro</div>
   <h2>Bienvenido</h2><p class="muted">Ingresa con tu cuenta de ROOM ISP.</p>
   <div class="field"><label>Correo electrónico</label><div class="input-wrap">${icon("mail")}<input class="input" name="email" type="email" autocomplete="email" required placeholder="tu@empresa.com"></div></div>
   <div class="field"><label>Contraseña</label><div class="input-wrap">${icon("key-round")}<input class="input" name="password" type="password" autocomplete="current-password" required placeholder="••••••••"></div></div>
   <div class="login-actions"><label class="check"><input type="checkbox" checked> Mantener sesión</label><button type="button" class="link-btn" id="forgot">Olvidé mi contraseña</button></div>
   <button class="btn primary block" type="submit">${icon("log-in")} Ingresar al sistema</button>
   <div class="auth-note">Protegido con Supabase Auth, RLS multi-tenant y MFA para operaciones sensibles. ROOM ISP nunca solicita tokens de MikroTik ni secretos de Telegram en esta pantalla.</div>
  </form></section>
 </div>`;
 hydrateIcons();
 $("#login-form").onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=$("button[type=submit]",f);b.disabled=true;b.innerHTML=`${icon("loader-circle")} Ingresando…`;hydrateIcons();const {error}=await sb.auth.signInWithPassword({email:val(f,"email"),password:val(f,"password")});if(error){toast(error.message,"error");b.disabled=false;b.innerHTML=`${icon("log-in")} Ingresar al sistema`;hydrateIcons()}};
 $("#forgot").onclick=async()=>{const email=val($("#login-form"),"email")||prompt("Correo para restablecer contraseña:");if(!email)return;const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin});error?toast(error.message,"error"):toast("Revisa tu correo para continuar")};
}

async function resolveContext(){
 const uid=state.user.id;
 const {data:pa,error:pae}=await sb.from("platform_admins").select("role,active").eq("user_id",uid).eq("active",true).maybeSingle();
 if(pae && pae.code!=="PGRST116") console.warn(pae);
 if(pa){state.role="PLATFORM";state.memberRole="SUPERADMIN";state.page="dashboard";return}
 const {data:members,error:me}=await sb.from("organization_members").select("organization_id,role,organizations(id,name,slug,status)").eq("user_id",uid);
 if(!me && members?.length){state.role="ISP";state.orgs=members.map(x=>({id:x.organization_id,role:x.role,...(x.organizations||{})}));state.org=state.orgs[0];state.memberRole=state.org.role;state.page="dashboard";return}
 const {data:cu}=await sb.from("customer_users").select("customer_id,customers(id,organization_id,code,full_name,phone,whatsapp,email,address,department,province,district,address_reference)").eq("user_id",uid).limit(1).maybeSingle();
 if(cu?.customers){state.role="CUSTOMER";state.memberRole="CUSTOMER";state.customer=cu.customers;state.org={id:cu.customers.organization_id};state.page="internet";return}
 throw new Error("Tu usuario no tiene un perfil de acceso asignado.");
}

async function refreshSecurity(){
 try{const [{data:aal},{data:f}]=await Promise.all([sb.auth.mfa.getAuthenticatorAssuranceLevel(),sb.auth.mfa.listFactors()]);state.aal=aal;state.factors=f?.totp||[]}catch(e){console.warn("MFA",e)}
}
function aal2(){return state.aal?.currentLevel==="aal2"}
async function requireAAL2(){await refreshSecurity();if(aal2())return true;toast("Esta operación requiere MFA/AAL2","warn");openSecurity();return false}

const NAV = {
 PLATFORM:[
  ["GENERAL"],["dashboard","Centro de plataforma","layout-dashboard"],["isps","Proveedores ISP","building-2"],["routers","Routers globales","router"],
  ["CONTROL"],["support","Soporte global","life-buoy"],["audit","Auditoría","scroll-text"]
 ],
 ISP:[
  ["OPERACIÓN"],["dashboard","Dashboard","layout-dashboard"],["customers","Clientes","users"],["services","Servicios","wifi"],["plans","Planes","gauge"],["routers","MikroTik","router"],
  ["GESTIÓN"],["payments","Pagos","wallet-cards"],["map","Mapa","map-pinned"],["incidents","NOC / Incidencias","triangle-alert"],["support","Soporte","headphones"],
  ["CAMPO"],["inventory","Inventario","boxes"],["work","Órdenes técnicas","wrench"],["notifications","Notificaciones","bell"],["settings","Configuración","settings-2"]
 ],
 CUSTOMER:[
  ["MI CUENTA"],["internet","Mi Internet","wifi"],["payments","Pagos","wallet-cards"],["support","Soporte","life-buoy"],["telegram","Telegram","send"],["map","Mi ubicación","map-pin"],["profile","Mis datos","user-round"]
 ]
};
function navItems(){return NAV[state.role]||NAV.CUSTOMER}
function currentLabel(){const row=navItems().find(x=>x[0]===state.page);return row?.[1]||"ROOM ISP"}

function shell(){
 const items=navItems();
 app.innerHTML=`<div class="shell"><aside class="sidebar" id="sidebar">
  <div class="brand"><div class="brand-mark">R</div><div class="brand-copy"><strong>${esc(C.APP_NAME||"ROOM ISP")}</strong><span>${state.role==="PLATFORM"?"Superadministración":state.role==="ISP"?esc(state.org?.name||"ISP"):"Portal del cliente"}</span></div></div>
  <nav class="nav">${items.map(x=>x.length===1?`<div class="nav-section">${esc(x[0])}</div>`:`<button data-page="${x[0]}" class="${state.page===x[0]?"active":""}">${icon(x[2])}<span>${esc(x[1])}</span></button>`).join("")}</nav>
  <div class="sidebar-foot"><div class="user-mini"><div class="avatar">${esc(initials(state.user.email))}</div><div><b>${esc(state.user.email)}</b><span>${esc(state.memberRole||state.role)}</span></div></div><button class="btn ghost block" id="logout">${icon("log-out")} Cerrar sesión</button></div>
 </aside><main class="main"><header class="topbar"><div class="top-left"><button class="btn ghost icon mobile-menu" id="menu">${icon("menu")}</button><div class="crumb"><strong id="top-title">${esc(currentLabel())}</strong><span>${state.role==="ISP"?esc(state.org?.name||""):state.role==="PLATFORM"?"ROOM ISP Platform":"Portal personal"}</span></div></div>
 <div class="top-right">${state.role==="ISP"&&state.orgs.length>1?`<select class="select" id="org-select" style="width:auto;min-width:170px">${state.orgs.map(o=>`<option value="${o.id}" ${o.id===state.org.id?"selected":""}>${esc(o.name)}</option>`).join("")}</select>`:""}<button class="security-pill" id="security"><span class="pulse"></span><span>${aal2()?"MFA verificado":"Seguridad"}</span></button><button class="btn ghost icon" id="theme">${icon(state.theme==="dark"?"sun":"moon")}</button></div></header><div class="content" id="content"></div></main></div>`;
 hydrateIcons();
 $$(".nav button").forEach(b=>b.onclick=()=>navigate(b.dataset.page));
 $("#logout").onclick=()=>sb.auth.signOut();
 $("#menu")?.addEventListener("click",()=>$("#sidebar").classList.toggle("open"));
 $("#theme").onclick=()=>{setTheme(state.theme==="dark"?"light":"dark");shell();navigate(state.page)};
 $("#security").onclick=openSecurity;
 $("#org-select")?.addEventListener("change",e=>{state.org=state.orgs.find(o=>o.id===e.target.value);state.memberRole=state.org.role;navigate("dashboard")});
}

async function navigate(page){
 destroyVisuals();state.page=page;$("#top-title")&&( $("#top-title").textContent=currentLabel());
 $$(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===page));$("#sidebar")?.classList.remove("open");
 const c=$("#content");if(!c)return;c.innerHTML=`<div class="grid kpis">${[1,2,3,4].map(()=>'<div class="skeleton big"></div>').join("")}</div>`;
 try{if(state.role==="PLATFORM")await renderPlatform(page);else if(state.role==="ISP")await renderISP(page);else await renderCustomer(page);hydrateIcons()}catch(e){console.error(e);c.innerHTML=renderError(e);hydrateIcons()}
}

async function renderPlatform(page){
 const c=$("#content");
 if(page==="dashboard"){
  const d=await superApi("summary");
  c.innerHTML=pageHead("Centro de plataforma","Salud global de ROOM ISP y todos los proveedores conectados")+`<div class="grid kpis">${kpi("ISP registrados",d.organizations||0,"building-2","#2563eb")}${kpi("ISP activos",d.active_organizations||0,"circle-check-big","#16a34a")}${kpi("Clientes totales",d.customers||0,"users","#7c3aed")}${kpi("Routers online",`${d.routers_online||0}/${d.routers||0}`,"router","#06b6d4")}</div><div style="height:16px"></div><div class="grid two"><div class="card"><h3>Operación global</h3><div class="status-row"><span>Tickets abiertos</span><b>${d.open_tickets||0}</b></div><div class="status-row"><span>Comprobantes pendientes</span><b>${d.pending_reports||0}</b></div><div class="status-row"><span>Arquitectura multi-tenant</span>${badge("ACTIVE")}</div></div><div class="card"><h3>ROOM ISP Security Core</h3><div class="status-row"><span>RLS por organization_id</span>${badge("ACTIVE")}</div><div class="status-row"><span>Edge Functions privilegiadas</span>${badge("ACTIVE")}</div><div class="status-row"><span>MFA para acciones críticas</span>${badge(aal2()?"ACTIVE":"PENDING")}</div></div></div>`;return;
 }
 if(page==="isps"){
  const d=await superApi("organizations"), arr=d.organizations||[];
  c.innerHTML=pageHead("Proveedores ISP","Crea, administra y controla las cuentas ISP de ROOM ISP",`<button class="btn primary" id="new-isp">${icon("building-2")} Crear ISP</button>`)+`<div class="toolbar"><div class="search">${icon("search")}<input class="input" id="isp-search" placeholder="Buscar por ISP, slug, OWNER o correo"></div><select class="select" id="isp-status" style="width:auto;min-width:160px"><option value="">Todos los estados</option><option value="ACTIVE">Activos</option><option value="TRIAL">Prueba</option><option value="SUSPENDED">Suspendidos</option></select></div><div id="isp-table"></div>`;

  const draw=()=>{
   const q=String($("#isp-search")?.value||"").toLowerCase().trim(), st=$("#isp-status")?.value||"";
   const rows=arr.filter(o=>{const hay=[o.name,o.slug,o.owner_name,o.owner_email].join(" ").toLowerCase();return (!q||hay.includes(q))&&(!st||o.status===st)}).map(o=>{const sub=one(o.organization_subscriptions);return `<tr><td><b>${esc(o.name)}</b><br><span class="muted">${esc(o.slug||"")}</span></td><td><b>${esc(o.owner_name||"—")}</b><br><span class="muted">${esc(o.owner_email||"Sin OWNER")}</span></td><td>${badge(o.status)}</td><td>${o.customer_count||0}</td><td>${o.router_count||0}</td><td>${o.routers_online||0}</td><td><b>${esc(sub.plan_code||"—")}</b><br><span class="muted">${esc(sub.status||"—")}</span></td><td>${date(sub.current_period_ends_at||sub.trial_ends_at)}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn ghost sm" data-edit="${o.id}">${icon("pencil")} Editar</button><button class="btn ghost sm" data-sub="${o.id}">${icon("credit-card")} Plan</button><button class="btn ghost sm" data-status="${o.id}">${icon("power")} Estado</button><button class="btn soft sm" data-reset="${o.id}">${icon("key-round")} OWNER</button></div></td></tr>`});
   $("#isp-table").innerHTML=table(["ISP","OWNER","Estado","Clientes","Routers","Online","Suscripción","Vence","Acciones"],rows);hydrateIcons();
   $$('[data-edit]',c).forEach(b=>b.onclick=()=>editISP(arr.find(o=>o.id===b.dataset.edit)));
   $$('[data-sub]',c).forEach(b=>b.onclick=()=>editSubscription(arr.find(o=>o.id===b.dataset.sub)));
   $$('[data-status]',c).forEach(b=>b.onclick=()=>editISPStatus(arr.find(o=>o.id===b.dataset.status)));
   $$('[data-reset]',c).forEach(b=>b.onclick=()=>resetOwner(arr.find(o=>o.id===b.dataset.reset)));
  };

  const showCredentials=(title,email,password)=>setTimeout(()=>{const m=modal(title,`<div class="notice info">Entrega estas credenciales al OWNER por un canal seguro. ROOM ISP no guarda la contraseña en texto plano.</div><div style="height:12px"></div><div class="field"><label>Correo OWNER</label><div class="code-box">${esc(email||"—")}</div></div><div class="field"><label>Contraseña inicial</label><div class="code-box" id="owner-pass">${esc(password||"—")}</div></div><button type="button" class="btn soft" id="copy-owner">${icon("copy")} Copiar credenciales</button>`,null);$("#copy-owner",m).onclick=async()=>{await navigator.clipboard.writeText(`Correo: ${email}
Contraseña: ${password}`);toast("Credenciales copiadas")};hydrateIcons()},350);

  const createISP=async()=>{if(!(await requireAAL2()))return;modal("Crear nuevo ISP",`<div class="modal-grid"><div class="field span-2"><label>Nombre del ISP</label><input class="input" name="name" required placeholder="Fibra Perú SAC"></div><div class="field span-2"><label>Slug</label><input class="input" name="slug" placeholder="fibra-peru (opcional)"></div><div class="field span-2"><label>Nombre del OWNER</label><input class="input" name="owner_name" required placeholder="Administrador principal"></div><div class="field"><label>Correo del OWNER</label><input class="input" type="email" name="owner_email" required></div><div class="field"><label>Contraseña inicial</label><input class="input" type="password" minlength="10" name="owner_password" placeholder="Vacío = generar automáticamente"></div><div class="field"><label>Estado inicial</label><select class="select" name="org_status"><option value="TRIAL">TRIAL / Prueba</option><option value="ACTIVE">ACTIVE</option></select></div><div class="field"><label>Plan ROOM ISP</label><input class="input" name="plan_code" value="STARTER" required></div><div class="field"><label>Límite de routers</label><input class="input" type="number" min="0" name="router_limit" value="3" required></div><div class="field"><label>Límite de clientes</label><input class="input" type="number" min="0" name="customer_limit" value="500" required></div><div class="field"><label>Días de prueba</label><input class="input" type="number" min="0" max="90" name="trial_days" value="14"></div><div class="field"><label>Fin del periodo</label><input class="input" type="date" name="period_end"></div></div>`,async f=>{const orgStatus=val(f,"org_status");const r=await superApi("create_isp",{isp:{name:val(f,"name"),slug:val(f,"slug"),status:orgStatus},owner:{full_name:val(f,"owner_name"),email:val(f,"owner_email"),password:val(f,"owner_password")},subscription:{plan_code:val(f,"plan_code"),status:orgStatus,router_limit:num(f,"router_limit"),customer_limit:num(f,"customer_limit"),trial_days:num(f,"trial_days"),current_period_ends_at:val(f,"period_end")||null}});showCredentials("ISP creado correctamente",r.owner?.email,r.owner?.initial_password)} ,"Crear ISP")};

  const editISP=async o=>{if(!o||!(await requireAAL2()))return;modal("Editar ISP",`<div class="field"><label>Nombre</label><input class="input" name="name" value="${esc(o.name)}" required></div><div class="field"><label>Slug</label><input class="input" name="slug" value="${esc(o.slug||"")}" required></div>`,async f=>superApi("update_organization",{organization_id:o.id,name:val(f,"name"),slug:val(f,"slug")}),"Guardar cambios")};

  const editISPStatus=async o=>{if(!o||!(await requireAAL2()))return;modal("Estado del ISP",`<div class="notice info">Suspender la cuenta ROOM ISP no debe cortar directamente el Internet de sus abonados.</div><div style="height:14px"></div><div class="field"><label>Estado</label><select class="select" name="status"><option value="ACTIVE" ${o.status==="ACTIVE"?"selected":""}>ACTIVE</option><option value="TRIAL" ${o.status==="TRIAL"?"selected":""}>TRIAL</option><option value="SUSPENDED" ${o.status==="SUSPENDED"?"selected":""}>SUSPENDED</option></select></div>`,async f=>superApi("set_org_status",{organization_id:o.id,status:val(f,"status")}),"Actualizar estado")};

  const editSubscription=async o=>{if(!o||!(await requireAAL2()))return;const s=one(o.organization_subscriptions);const dval=v=>v?String(v).slice(0,10):"";modal("Suscripción ROOM ISP",`<div class="modal-grid"><div class="field"><label>Plan</label><input class="input" name="plan_code" value="${esc(s.plan_code||"STARTER")}" required></div><div class="field"><label>Estado</label><select class="select" name="status">${["TRIAL","ACTIVE","PAST_DUE","SUSPENDED","CANCELLED"].map(x=>`<option value="${x}" ${s.status===x?"selected":""}>${x}</option>`).join("")}</select></div><div class="field"><label>Límite routers</label><input class="input" type="number" min="0" name="router_limit" value="${Number(s.router_limit??3)}"></div><div class="field"><label>Límite clientes</label><input class="input" type="number" min="0" name="customer_limit" value="${Number(s.customer_limit??500)}"></div><div class="field"><label>Fin trial</label><input class="input" type="date" name="trial_end" value="${esc(dval(s.trial_ends_at))}"></div><div class="field"><label>Fin periodo actual</label><input class="input" type="date" name="period_end" value="${esc(dval(s.current_period_ends_at))}"></div><div class="field span-2"><label>Notas internas</label><textarea class="textarea" name="notes" rows="3">${esc(s.notes||"")}</textarea></div></div>`,async f=>superApi("set_subscription",{organization_id:o.id,subscription:{plan_code:val(f,"plan_code"),status:val(f,"status"),router_limit:num(f,"router_limit"),customer_limit:num(f,"customer_limit"),trial_ends_at:val(f,"trial_end")||null,current_period_ends_at:val(f,"period_end")||null,notes:val(f,"notes")}}),"Guardar suscripción")};

  const resetOwner=async o=>{if(!o||!(await requireAAL2()))return;modal("Restablecer contraseña OWNER",`<div class="notice danger">Esta acción cambia la contraseña de acceso del OWNER principal de <b>${esc(o.name)}</b>.</div><div style="height:14px"></div><div class="field"><label>Nueva contraseña</label><input class="input" type="password" minlength="10" name="password" placeholder="Vacío = generar automáticamente"></div>`,async f=>{const r=await superApi("reset_owner_password",{organization_id:o.id,password:val(f,"password")});showCredentials("Credenciales OWNER actualizadas",r.owner_email,r.initial_password)},"Cambiar contraseña")};

  $("#new-isp").onclick=createISP;$("#isp-search").oninput=draw;$("#isp-status").onchange=draw;draw();return;
 }
 if(page==="routers"){
  const {data,error}=await sb.from("routers").select("id,name,status,last_seen,routeros_version,model,organizations(name)").order("last_seen",{ascending:false}).limit(500);if(error)throw error;
  c.innerHTML=pageHead("Routers globales","Monitoreo consolidado de MikroTik")+table(["ISP","Router","Estado","Modelo","RouterOS","Último contacto"],(data||[]).map(r=>`<tr><td>${esc(r.organizations?.name||"—")}</td><td><b>${esc(r.name)}</b></td><td>${badge(r.status)}</td><td>${esc(r.model||"—")}</td><td>${esc(r.routeros_version||"—")}</td><td>${dt(r.last_seen)}</td></tr>`));return;
 }
 if(page==="support"){
  const {data,error}=await sb.from("support_tickets").select("id,subject,status,priority,created_at,organizations(name)").order("created_at",{ascending:false}).limit(400);if(error)throw error;
  c.innerHTML=pageHead("Soporte global","Visibilidad de incidencias y tickets de todos los ISP")+table(["ISP","Asunto","Prioridad","Estado","Fecha"],(data||[]).map(t=>`<tr><td>${esc(t.organizations?.name||"—")}</td><td><b>${esc(t.subject)}</b></td><td>${esc(t.priority||"—")}</td><td>${badge(t.status)}</td><td>${dt(t.created_at)}</td></tr>`));return;
 }
 if(page==="audit"){
  const {data,error}=await sb.from("audit_logs").select("*").order("created_at",{ascending:false}).limit(500);if(error)throw error;
  c.innerHTML=pageHead("Auditoría","Trazabilidad de operaciones administrativas")+table(["Fecha","Acción","Entidad","Actor","Organización"],(data||[]).map(x=>`<tr><td>${dt(x.created_at)}</td><td><b>${esc(x.action||x.event_type||"—")}</b></td><td>${esc(x.entity_type||x.resource_type||"—")}</td><td class="mono">${esc(x.actor_user_id||x.user_id||"—")}</td><td class="mono">${esc(x.organization_id||"GLOBAL")}</td></tr>`));return;
 }
}

async function renderISP(page){
 const c=$("#content"),oid=state.org.id;
 if(page==="dashboard"){
  const [cu,sv,ro,pr,tk,pay]=await Promise.all([
   sb.from("customers").select("id",{count:"exact",head:true}).eq("organization_id",oid),
   sb.from("services").select("id,status,service_type,paid_until").eq("organization_id",oid),
   sb.from("routers").select("id,status,name,last_seen,routeros_version").eq("organization_id",oid),
   sb.from("payment_reports").select("id",{count:"exact",head:true}).eq("organization_id",oid).eq("status","PENDING_REVIEW"),
   sb.from("support_tickets").select("id",{count:"exact",head:true}).eq("organization_id",oid).neq("status","CLOSED"),
   sb.from("payments").select("amount,status,paid_at,created_at").eq("organization_id",oid).order("created_at",{ascending:false}).limit(500)
  ]);
  const services=sv.data||[],routers=ro.data||[],payments=pay.data||[];
  c.innerHTML=pageHead("Dashboard",`Operación en vivo · ${state.org.name}`,`<button class="btn soft sm" id="refresh">${icon("refresh-cw")} Actualizar</button>`)+`<div class="grid kpis">${kpi("Clientes",cu.count||0,"users","#2563eb")}${kpi("Servicios activos",services.filter(x=>x.status==="ACTIVE").length,"wifi","#16a34a")}${kpi("MikroTik online",`${routers.filter(x=>x.status==="ONLINE").length}/${routers.length}`,"router","#06b6d4")}${kpi("Pagos por revisar",pr.count||0,"receipt-text","#d97706")}</div><div style="height:16px"></div><div class="grid two"><div class="card"><h3>Estado de servicios</h3><div class="chart-box"><canvas id="service-chart"></canvas></div></div><div class="card"><h3>Red MikroTik</h3>${routers.slice(0,8).map(r=>`<div class="status-row"><div class="status-main"><div class="status-icon">${icon("router")}</div><div><b>${esc(r.name)}</b><small>${esc(r.routeros_version||"RouterOS")} · ${dt(r.last_seen)}</small></div></div>${badge(r.status)}</div>`).join("")||'<div class="empty">Sin routers registrados</div>'}</div></div><div style="height:16px"></div><div class="grid two"><div class="card"><h3>Centro de atención</h3><div class="status-row"><span>Tickets abiertos</span><b>${tk.count||0}</b></div><div class="status-row"><span>Servicios suspendidos</span><b>${services.filter(x=>x.status==="SUSPENDED").length}</b></div><div class="status-row"><span>Comprobantes por validar</span><b>${pr.count||0}</b></div></div><div class="card"><h3>Cobranza reciente</h3>${payments.slice(0,6).map(p=>`<div class="status-row"><span>${dt(p.paid_at||p.created_at)}</span><b>${money(p.amount)}</b></div>`).join("")||'<div class="empty">Sin pagos recientes</div>'}</div></div>`;
  $("#refresh").onclick=()=>navigate("dashboard");
  if(window.Chart){const counts=["ACTIVE","PENDING","SUSPENDED","CANCELLED"].map(s=>services.filter(x=>x.status===s).length);const ch=new Chart($("#service-chart"),{type:"doughnut",data:{labels:["Activos","Pendientes","Suspendidos","Cancelados"],datasets:[{data:counts}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom"}}}});state.charts.push(ch)}
  return;
 }
 if(page==="customers"){
  const {data,error}=await sb.from("customers").select("*").eq("organization_id",oid).order("full_name").limit(1200);if(error)throw error;const arr=data||[];
  c.innerHTML=pageHead("Clientes","Abonados, contacto, dirección y estado comercial",`<button class="btn primary" id="new-customer">${icon("user-plus")} Nuevo cliente</button>`)+`<div class="toolbar"><div class="search">${icon("search")}<input class="input" id="customer-search" placeholder="Buscar por nombre, código, DNI o teléfono"></div><span class="muted small">${arr.length} registros</span></div><div id="customer-table"></div>`;
  const draw=(q="")=>{q=q.toLowerCase();const rows=arr.filter(x=>[x.full_name,x.code,x.document_number,x.phone,x.whatsapp].some(v=>String(v||"").toLowerCase().includes(q))).map(x=>`<tr><td class="mono">${esc(x.code||"—")}</td><td><b>${esc(x.full_name)}</b><br><span class="muted">${esc(x.email||"")}</span></td><td>${esc(x.document_number||"—")}</td><td>${esc(x.whatsapp||x.phone||"—")}</td><td>${esc(x.address||"—")}</td></tr>`);$("#customer-table").innerHTML=table(["Código","Cliente","Documento","WhatsApp","Dirección"],rows);hydrateIcons()};draw();$("#customer-search").oninput=e=>draw(e.target.value);
  $("#new-customer").onclick=()=>modal("Nuevo cliente",`<div class="modal-grid"><div class="field span-2"><label>Nombre completo</label><input class="input" name="full_name" required></div><div class="field"><label>DNI / RUC</label><input class="input" name="document_number"></div><div class="field"><label>Correo</label><input class="input" type="email" name="email"></div><div class="field"><label>Teléfono</label><input class="input" name="phone"></div><div class="field"><label>WhatsApp</label><input class="input" name="whatsapp"></div><div class="field span-2"><label>Dirección</label><input class="input" name="address"></div></div>`,async f=>adminApi("create_customer",{customer:{full_name:val(f,"full_name"),document_number:val(f,"document_number"),email:val(f,"email"),phone:val(f,"phone"),whatsapp:val(f,"whatsapp"),address:val(f,"address")}}));return;
 }
 if(page==="plans"){
  const {data,error}=await sb.from("plans").select("*").eq("organization_id",oid).order("price");if(error)throw error;
  c.innerHTML=pageHead("Planes de Internet","Velocidad, precio y disponibilidad",`<button class="btn primary" id="new-plan">${icon("plus")} Nuevo plan</button>`)+table(["Plan","Descarga","Subida","Precio","Estado"],(data||[]).map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${mbps(x.download_bps)}</td><td>${mbps(x.upload_bps)}</td><td><b>${money(x.price)}</b></td><td>${badge(x.active?"ACTIVE":"DISABLED")}</td></tr>`));
  $("#new-plan").onclick=()=>modal("Nuevo plan",`<div class="modal-grid"><div class="field span-2"><label>Nombre</label><input class="input" name="name" required placeholder="Fibra 200 Mbps"></div><div class="field"><label>Descarga Mbps</label><input class="input" type="number" min="1" name="down" required></div><div class="field"><label>Subida Mbps</label><input class="input" type="number" min="1" name="up" required></div><div class="field"><label>Precio mensual S/</label><input class="input" type="number" min="0" step=".01" name="price" required></div></div>`,async f=>adminApi("create_plan",{plan:{name:val(f,"name"),download_bps:num(f,"down")*1_000_000,upload_bps:num(f,"up")*1_000_000,price:num(f,"price")}}));return;
 }
 if(page==="services"){
  const {data,error}=await sb.from("services").select("id,status,service_type,paid_until,installation_date,customers(full_name,code),plans(name,download_bps,upload_bps),routers(name),service_bindings(fixed_ip,pppoe_username,dhcp_lease_ip,hotspot_username)").eq("organization_id",oid).order("created_at",{ascending:false}).limit(1200);if(error)throw error;
  c.innerHTML=pageHead("Servicios","Cada conexión del cliente, su plan, router y vencimiento",`<button class="btn ghost" id="service-info">${icon("info")} Crear servicio</button>`)+`<div class="notice info" style="margin-bottom:14px">Las acciones de corte, reconexión y cambio de velocidad deben conservar el flujo PENDING → command queue → MikroTik → ACK. No se realizan con un UPDATE directo desde el navegador.</div>`+table(["Cliente","Tipo","Plan","Binding","Router","Vence","Estado"],(data||[]).map(x=>{const b=Array.isArray(x.service_bindings)?x.service_bindings[0]:(x.service_bindings||{});const bind=b?.fixed_ip||b?.pppoe_username||b?.dhcp_lease_ip||b?.hotspot_username||"—";return `<tr><td><b>${esc(x.customers?.full_name||"—")}</b><br><span class="muted">${esc(x.customers?.code||"")}</span></td><td>${esc(x.service_type)}</td><td>${esc(x.plans?.name||"—")}<br><span class="muted">${mbps(x.plans?.download_bps)}</span></td><td class="mono">${esc(bind)}</td><td>${esc(x.routers?.name||"—")}</td><td>${date(x.paid_until)}</td><td>${badge(x.status)}</td></tr>`}));
  $("#service-info").onclick=()=>modal("Creación segura de servicio",`<div class="notice info">La interfaz está preparada, pero antes de activar este botón debemos validar el nombre y payload exactos del contrato de <b>admin-api</b> para crear el servicio y su binding sin inventar una operación peligrosa.</div>`,null);return;
 }
 if(page==="routers"){
  const {data,error}=await sb.from("routers").select("*").eq("organization_id",oid).order("created_at",{ascending:false});if(error)throw error;
  c.innerHTML=pageHead("MikroTik","Routers conectados por HTTPS saliente",`<button class="btn primary" id="enroll-router">${icon("router")} Agregar MikroTik</button>`)+`<div class="grid three">${(data||[]).map(r=>`<div class="card router-card"><div class="router-orb">${icon("router")}</div><div><h4>${esc(r.name)}</h4><p>${esc(r.model||"Modelo pendiente")} · RouterOS ${esc(r.routeros_version||"—")}</p><p>${dt(r.last_seen)}</p></div>${badge(r.status)}</div>`).join("")||'<div class="empty" style="grid-column:1/-1">Aún no hay routers registrados.</div>'}</div>`;
  $("#enroll-router").onclick=async()=>{if(!(await requireAAL2()))return;modal("Agregar MikroTik",`<div class="field"><label>Nombre del router</label><input class="input" name="name" required placeholder="RB-CENTRO-01"></div><div class="notice info">Se creará un enrollment token temporal de un solo uso. El token no debe guardarse en GitHub ni enviarse por chat.</div>`,async f=>{const r=await adminApi("create_router_enrollment",{router_name:val(f,"name"),ttl_minutes:10});const token=r.enrollment_token||r.token;if(token){setTimeout(()=>{const m=modal("Token temporal generado",`<div class="notice info">Cópialo solo para instalar el router. Caduca en pocos minutos.</div><div style="height:12px"></div><div class="code-box" id="temp-token">${esc(token)}</div><div style="height:12px"></div><button type="button" class="btn soft" id="copy-token">${icon("copy")} Copiar token</button>`,null);$("#copy-token",m).onclick=async()=>{await navigator.clipboard.writeText(token);toast("Token copiado")};hydrateIcons()},200)}})};return;
 }
 if(page==="payments"){
  const [{data:p,error:pe},{data:r,error:re}]=await Promise.all([sb.from("payments").select("id,amount,method,status,paid_at,created_at,customers(full_name)").eq("organization_id",oid).order("created_at",{ascending:false}).limit(500),sb.from("payment_reports").select("id,amount,reported_method,status,created_at,customers(full_name)").eq("organization_id",oid).order("created_at",{ascending:false}).limit(500)]);if(pe)throw pe;if(re)throw re;
  const pending=(r||[]).filter(x=>x.status==="PENDING_REVIEW").length;
  c.innerHTML=pageHead("Pagos y cobranza","Pagos confirmados y comprobantes enviados por clientes")+`<div class="grid kpis">${kpi("Pagos registrados",(p||[]).length,"wallet-cards","#2563eb")}${kpi("Por revisar",pending,"receipt-text","#d97706")}${kpi("Confirmados",(p||[]).filter(x=>x.status==="CONFIRMED").length,"badge-check","#16a34a")}${kpi("Total listado",money((p||[]).filter(x=>x.status==="CONFIRMED").reduce((s,x)=>s+Number(x.amount||0),0)),"banknote","#7c3aed","Suma de registros cargados")}</div><div style="height:16px"></div><div class="card"><h3>Pagos</h3>${table(["Cliente","Monto","Método","Estado","Fecha"],(p||[]).map(x=>`<tr><td>${esc(x.customers?.full_name||"—")}</td><td><b>${money(x.amount)}</b></td><td>${esc(x.method)}</td><td>${badge(x.status)}</td><td>${dt(x.paid_at||x.created_at)}</td></tr>`))}</div><div style="height:16px"></div><div class="card"><h3>Comprobantes reportados</h3><p class="card-sub">La aprobación debe ejecutar el flujo endurecido de pago y reconexión.</p>${table(["Cliente","Monto","Método","Estado","Fecha"],(r||[]).map(x=>`<tr><td>${esc(x.customers?.full_name||"—")}</td><td><b>${money(x.amount)}</b></td><td>${esc(x.reported_method||"—")}</td><td>${badge(x.status)}</td><td>${dt(x.created_at)}</td></tr>`))}</div>`;return;
 }
 if(page==="map"){
  const {data,error}=await sb.from("service_locations").select("latitude,longitude,label,address,customers(full_name),services(status)").eq("organization_id",oid).not("latitude","is",null).not("longitude","is",null);if(error)throw error;
  c.innerHTML=pageHead("Mapa de red y clientes","Ubicaciones GPS registradas en OpenStreetMap")+`<div class="card"><div class="map-toolbar"><span class="badge info">${(data||[]).length} ubicaciones</span></div><div id="map"></div></div>`;setTimeout(()=>drawMap(data||[]),0);return;
 }
 if(page==="incidents"){
  const {data,error}=await sb.from("incidents").select("*").eq("organization_id",oid).order("created_at",{ascending:false}).limit(500);if(error)throw error;
  c.innerHTML=pageHead("NOC / Incidencias","Averías, alertas y eventos masivos de red")+table(["Incidencia","Severidad","Estado","Inicio","Resolución"],(data||[]).map(x=>`<tr><td><b>${esc(x.title||"Incidencia")}</b></td><td>${badge(x.severity||"INFO")}</td><td>${badge(x.status)}</td><td>${dt(x.started_at||x.created_at)}</td><td>${dt(x.resolved_at)}</td></tr>`));return;
 }
 if(page==="support"){
  const {data,error}=await sb.from("support_tickets").select("id,subject,status,priority,created_at,customers(full_name)").eq("organization_id",oid).order("created_at",{ascending:false}).limit(600);if(error)throw error;
  c.innerHTML=pageHead("Soporte","Tickets y averías reportadas por los clientes")+table(["Cliente","Asunto","Prioridad","Estado","Fecha"],(data||[]).map(x=>`<tr><td>${esc(x.customers?.full_name||"—")}</td><td><b>${esc(x.subject)}</b></td><td>${esc(x.priority||"—")}</td><td>${badge(x.status)}</td><td>${dt(x.created_at)}</td></tr>`));return;
 }
 if(page==="inventory"){
  const {data,error}=await sb.from("inventory_items").select("*").eq("organization_id",oid).order("created_at",{ascending:false}).limit(800);if(error)throw error;
  c.innerHTML=pageHead("Inventario","ONT/ONU, routers Wi‑Fi, antenas, switches y materiales")+table(["Equipo","Categoría","Marca / Modelo","Serie / MAC","Estado"],(data||[]).map(x=>`<tr><td><b>${esc(x.name||x.item_name||"—")}</b></td><td>${esc(x.category||"—")}</td><td>${esc([x.brand,x.model].filter(Boolean).join(" ")||"—")}</td><td class="mono">${esc(x.serial_number||x.mac_address||"—")}</td><td>${badge(x.status||"AVAILABLE")}</td></tr>`));return;
 }
 if(page==="work"){
  const {data,error}=await sb.from("work_orders").select("*,customers(full_name)").eq("organization_id",oid).order("created_at",{ascending:false}).limit(700);if(error)throw error;
  c.innerHTML=pageHead("Órdenes técnicas","Instalaciones, averías, mantenimiento y visitas")+table(["Cliente","Tipo","Estado","Programado","Técnico"],(data||[]).map(x=>`<tr><td>${esc(x.customers?.full_name||"—")}</td><td><b>${esc(x.type||x.order_type||"—")}</b></td><td>${badge(x.status)}</td><td>${dt(x.scheduled_at)}</td><td>${esc(x.technician_name||"—")}</td></tr>`));return;
 }
 if(page==="notifications"){
  const {data,error}=await sb.from("notification_queue").select("*").eq("organization_id",oid).order("created_at",{ascending:false}).limit(700);if(error)throw error;
  c.innerHTML=pageHead("Notificaciones","Telegram, recordatorios, estados y alertas")+table(["Canal","Evento","Título","Estado","Programado"],(data||[]).map(x=>`<tr><td>${esc(x.channel||"—")}</td><td>${esc(x.event_type||"—")}</td><td><b>${esc(x.title||"—")}</b></td><td>${badge(x.status)}</td><td>${dt(x.scheduled_for)}</td></tr>`));return;
 }
 if(page==="settings"){
  const [{data:s},{data:b},{data:pc}]=await Promise.all([sb.from("organization_settings").select("*").eq("organization_id",oid).maybeSingle(),sb.from("organization_branding").select("*").eq("organization_id",oid).maybeSingle(),sb.from("payment_channels").select("*").eq("organization_id",oid).order("sort_order")]);
  c.innerHTML=pageHead("Configuración","Operación, marca blanca, cobranza y seguridad",`<button class="btn soft" id="mfa-settings">${icon("shield-check")} MFA</button>`)+`<div class="grid two"><div class="card"><h3>Operación</h3><div class="status-row"><span>Zona horaria</span><b>${esc(s?.timezone||C.DEFAULT_TIMEZONE)}</b></div><div class="status-row"><span>Días de gracia</span><b>${s?.grace_days??0}</b></div><div class="status-row"><span>Corte automático</span>${badge(s?.auto_suspend?"ACTIVE":"DISABLED")}</div><div class="status-row"><span>Telegram</span>${badge(s?.telegram_enabled?"ACTIVE":"DISABLED")}</div></div><div class="card"><h3>Marca blanca</h3><div class="status-row"><span>Nombre público</span><b>${esc(b?.public_name||state.org.name)}</b></div><div class="status-row"><span>Soporte</span><b>${esc(b?.support_phone||"—")}</b></div><div class="status-row"><span>Dominio</span><b>${esc(b?.custom_domain||"Futuro")}</b></div></div></div><div style="height:16px"></div><div class="card"><h3>Formas de pago</h3>${(pc||[]).map(x=>`<div class="status-row"><div><b>${esc(x.display_name)}</b><br><span class="muted small">${esc(x.type)} · ${esc(x.phone||x.bank_name||x.account_number||"")}</span></div>${badge(x.active?"ACTIVE":"DISABLED")}</div>`).join("")||'<div class="empty">Aún no hay canales de pago configurados.</div>'}</div>`;$("#mfa-settings").onclick=openSecurity;return;
 }
}

async function customerServices(){
 const {data:links,error:le}=await sb.from("customer_users").select("customer_id").eq("user_id",state.user.id);if(le)throw le;const ids=(links||[]).map(x=>x.customer_id);if(!ids.length)return[];
 const {data,error}=await sb.from("services").select("id,status,service_type,paid_until,installation_date,plans(name,download_bps,upload_bps,price),routers(name),service_locations(*)").in("customer_id",ids).order("created_at");if(error)throw error;return data||[];
}
async function renderCustomer(page){
 const c=$("#content"),cid=state.customer.id;
 if(page==="internet"){
  const services=await customerServices();
  c.innerHTML=pageHead(`Hola, ${state.customer.full_name||"cliente"}`,"Estado de tus conexiones, planes y vencimientos")+(services.length?`<div class="service-grid">${services.map(s=>`<div class="service-card">${badge(s.status)}<h4>${esc(s.plans?.name||s.service_type)}</h4><div class="speed">${mbps(s.plans?.download_bps)}</div><div class="muted small">Subida ${mbps(s.plans?.upload_bps)}</div><div style="height:14px"></div><div class="metric-line"><span>Vence</span><b>${date(s.paid_until)}</b></div><div class="metric-line"><span>Mensualidad</span><b>${money(s.plans?.price)}</b></div><div class="metric-line"><span>Router ISP</span><b>${esc(s.routers?.name||"—")}</b></div></div>`).join("")}</div>`:`<div class="empty card">Todavía no tienes un servicio asociado.</div>`);return;
 }
 if(page==="payments"){
  const [{data:p,error:pe},{data:ch,error:ce},services]=await Promise.all([sb.from("payments").select("*").eq("customer_id",cid).order("created_at",{ascending:false}).limit(150),sb.from("payment_channels").select("*").eq("organization_id",state.customer.organization_id).eq("active",true).order("sort_order"),customerServices()]);if(pe)throw pe;if(ce)throw ce;
  c.innerHTML=pageHead("Pagos","Formas de pago, historial y reporte de comprobantes",`<button class="btn primary" id="report-pay">${icon("receipt-text")} Reportar pago</button>`)+`<div class="grid two"><div class="card"><h3>Formas de pago</h3>${(ch||[]).map(x=>`<div class="status-row"><div><b>${esc(x.display_name)}</b><br><span class="muted small">${esc(x.instructions||x.phone||x.account_number||"")}</span></div><span class="badge info">${esc(x.type)}</span></div>`).join("")||'<div class="empty">No configuradas</div>'}</div><div class="card"><h3>Tu próximo paso</h3><p class="muted small">Después de pagar por Yape, Plin o transferencia, reporta el pago para que tu ISP lo revise. La reconexión automática debe ejecutarse solo después de la aprobación segura.</p></div></div><div style="height:16px"></div>${table(["Monto","Método","Estado","Fecha"],(p||[]).map(x=>`<tr><td><b>${money(x.amount)}</b></td><td>${esc(x.method)}</td><td>${badge(x.status)}</td><td>${dt(x.paid_at||x.created_at)}</td></tr>`))}`;
  $("#report-pay").onclick=()=>modal("Reportar pago",`<div class="modal-grid"><div class="field span-2"><label>Servicio</label><select class="select" name="service_id" required>${services.map(s=>`<option value="${s.id}">${esc(s.plans?.name||s.service_type)} · vence ${date(s.paid_until)}</option>`).join("")}</select></div><div class="field"><label>Monto S/</label><input class="input" type="number" min="0.01" step=".01" name="amount" required></div><div class="field"><label>Meses pagados</label><input class="input" type="number" min="1" max="24" value="1" name="months"></div><div class="field span-2"><label>Método</label><select class="select" name="method"><option>YAPE</option><option>PLIN</option><option>TRANSFER</option><option>CASH</option><option>OTHER</option></select></div></div><div class="notice info">El registro financiero se enviará como PENDING_REVIEW. La carga de foto/PDF se activará cuando validemos la columna/ruta exacta del Storage privado para no inventar un esquema.</div>`,async f=>{const row={organization_id:state.customer.organization_id,customer_id:cid,service_id:val(f,"service_id"),amount:num(f,"amount"),reported_method:val(f,"method"),months_paid:num(f,"months")||1,status:"PENDING_REVIEW",source:"WEB"};const {error}=await sb.from("payment_reports").insert(row);if(error)throw error});return;
 }
 if(page==="support"){
  const {data,error}=await sb.from("support_tickets").select("*").eq("customer_id",cid).order("created_at",{ascending:false});if(error)throw error;
  c.innerHTML=pageHead("Soporte","Tus consultas, averías y seguimiento")+`<div class="notice info" style="margin-bottom:14px">La creación de ticket desde el cliente se habilitará al confirmar el contrato de inserción/RPC permitido por RLS. La lista ya consulta tus tickets reales.</div>`+table(["Asunto","Prioridad","Estado","Fecha"],(data||[]).map(x=>`<tr><td><b>${esc(x.subject)}</b></td><td>${esc(x.priority||"—")}</td><td>${badge(x.status)}</td><td>${dt(x.created_at)}</td></tr>`));return;
 }
 if(page==="telegram"){
  const {data:link,error}=await sb.from("telegram_customer_links").select("*").eq("customer_id",cid).eq("active",true).maybeSingle();if(error && error.code!=="PGRST116")throw error;
  c.innerHTML=pageHead("Telegram","Consulta tu servicio, pagos y alertas desde el bot")+`<div class="card" style="max-width:760px">${link?`<div class="status-main"><div class="router-orb" style="background:linear-gradient(145deg,#38bdf8,#0284c7)">${icon("send")}</div><div><h3 style="margin:0">Telegram vinculado</h3><p class="muted small">@${esc(link.username||"usuario")} · Último contacto ${dt(link.last_seen_at)}</p></div></div><div style="height:14px"></div>${badge("ACTIVE")}`:`<div class="status-main"><div class="router-orb" style="background:linear-gradient(145deg,#38bdf8,#0284c7)">${icon("send")}</div><div><h3 style="margin:0">Vincula tu Telegram</h3><p class="muted small">Generaremos un enlace temporal de un solo uso.</p></div></div><div style="height:16px"></div><button class="btn primary" id="link-tg">${icon("link")} Vincular Telegram</button>`}</div>`;
  if(!link)$("#link-tg").onclick=async()=>{try{const {data,error}=await sb.rpc("create_telegram_link_token",{p_customer_id:cid});if(error)throw error;const token=data?.[0]?.link_token,bot=(C.TELEGRAM_BOT_USERNAME||"").replace(/^@/,"");if(!token)throw new Error("No se generó token");if(!bot){prompt("Token temporal:",token);return}window.open(`https://t.me/${encodeURIComponent(bot)}?start=${encodeURIComponent(token)}`,"_blank")}catch(e){toast(e.message,"error")}};return;
 }
 if(page==="map"){
  const services=await customerServices(),s=services[0],loc=Array.isArray(s?.service_locations)?s.service_locations[0]:s?.service_locations;
  c.innerHTML=pageHead("Mi ubicación","Registra la posición exacta de tu instalación")+`<div class="grid two"><div class="card"><h3>GPS de instalación</h3><p class="muted small">Usa el GPS del dispositivo. La ubicación queda asociada a tu servicio y está protegida como dato sensible.</p><button class="btn primary" id="gps">${icon("locate-fixed")} Usar mi ubicación</button><div id="coords" class="notice" style="margin-top:14px">${loc?.latitude?`${esc(loc.latitude)}, ${esc(loc.longitude)}`:"Sin ubicación registrada"}</div></div><div class="card"><div id="map" class="map-small"></div></div></div>`;setTimeout(()=>drawMap(loc?.latitude?[{latitude:loc.latitude,longitude:loc.longitude,label:"Mi instalación",address:loc.address}]:[]),0);
  $("#gps").onclick=()=>{if(!navigator.geolocation)return toast("El navegador no permite geolocalización","error");navigator.geolocation.getCurrentPosition(async pos=>{try{if(!s)throw new Error("No tienes servicio asociado");const lat=pos.coords.latitude,lon=pos.coords.longitude;const {error}=await sb.rpc("update_my_service_location",{p_service_id:s.id,p_label:"Instalación",p_address:state.customer.address||null,p_reference:state.customer.address_reference||null,p_department:state.customer.department||null,p_province:state.customer.province||null,p_district:state.customer.district||null,p_latitude:lat,p_longitude:lon,p_accuracy:pos.coords.accuracy});if(error)throw error;toast("Ubicación guardada");await navigate("map")}catch(e){toast(e.message,"error")}},e=>toast(e.message,"error"),{enableHighAccuracy:true,timeout:15000})};return;
 }
 if(page==="profile"){
  const x=state.customer;c.innerHTML=pageHead("Mis datos","Mantén actualizada tu información de contacto")+`<form id="profile-form" class="card"><div class="modal-grid"><div class="field"><label>Teléfono</label><input class="input" name="phone" value="${esc(x.phone||"")}"></div><div class="field"><label>WhatsApp</label><input class="input" name="whatsapp" value="${esc(x.whatsapp||"")}"></div><div class="field"><label>Correo</label><input class="input" type="email" name="email" value="${esc(x.email||"")}"></div><div class="field"><label>Dirección</label><input class="input" name="address" value="${esc(x.address||"")}"></div><div class="field"><label>Departamento</label><input class="input" name="department" value="${esc(x.department||"")}"></div><div class="field"><label>Provincia</label><input class="input" name="province" value="${esc(x.province||"")}"></div><div class="field"><label>Distrito</label><input class="input" name="district" value="${esc(x.district||"")}"></div><div class="field"><label>Referencia</label><input class="input" name="reference" value="${esc(x.address_reference||"")}"></div></div><button class="btn primary">${icon("save")} Guardar cambios</button></form>`;
  $("#profile-form").onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{const {error}=await sb.rpc("update_my_customer_profile_full",{p_customer_id:cid,p_phone:val(f,"phone"),p_whatsapp:val(f,"whatsapp"),p_alt_phone:null,p_email:val(f,"email"),p_address:val(f,"address"),p_department:val(f,"department"),p_province:val(f,"province"),p_district:val(f,"district"),p_reference:val(f,"reference")});if(error)throw error;Object.assign(state.customer,{phone:val(f,"phone"),whatsapp:val(f,"whatsapp"),email:val(f,"email"),address:val(f,"address"),department:val(f,"department"),province:val(f,"province"),district:val(f,"district"),address_reference:val(f,"reference")});toast("Datos actualizados")}catch(err){toast(err.message,"error")}};return;
 }
}

function drawMap(rows){
 if(!window.L)return; if(state.map){try{state.map.remove()}catch{}state.map=null}const el=$("#map");if(!el)return;
 const valid=(rows||[]).filter(x=>Number.isFinite(Number(x.latitude))&&Number.isFinite(Number(x.longitude)));const center=valid.length?[Number(valid[0].latitude),Number(valid[0].longitude)]:[-12.0464,-77.0428];
 state.map=L.map(el,{zoomControl:true}).setView(center,valid.length?14:5);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap"}).addTo(state.map);
 const marks=[];valid.forEach(x=>{const m=L.marker([Number(x.latitude),Number(x.longitude)]).addTo(state.map).bindPopup(`<div class="map-popup"><b>${esc(x.customers?.full_name||x.label||"Cliente")}</b><br><span>${esc(x.address||"")}</span></div>`);marks.push(m)});if(marks.length>1){state.map.fitBounds(L.featureGroup(marks).getBounds().pad(.15))}setTimeout(()=>state.map.invalidateSize(),120)
}

async function openSecurity(){
 await refreshSecurity();
 const factors=state.factors||[];
 const back=modal("Seguridad y MFA",`<div class="grid two"><div class="card" style="box-shadow:none"><h3>Nivel actual</h3><div class="status-row"><span>Sesión</span>${badge(aal2()?"AAL2":"AAL1")}</div><div class="status-row"><span>Factores TOTP</span><b>${factors.length}</b></div></div><div class="card" style="box-shadow:none"><h3>Protección</h3><p class="muted small">ROOM ISP usa MFA para operaciones sensibles. Si ya tienes TOTP configurado, puedes verificar esta sesión. Si no, crea uno desde aquí.</p></div></div><div style="height:14px"></div><div class="page-actions"><button type="button" class="btn soft" id="mfa-enroll">${icon("qr-code")} Configurar TOTP</button>${factors.length?`<button type="button" class="btn primary" id="mfa-verify">${icon("shield-check")} Verificar MFA</button>`:""}</div>`,null);
 $("#mfa-enroll",back).onclick=async()=>{try{const {data,error}=await sb.auth.mfa.enroll({factorType:"totp",friendlyName:`ROOM ISP ${new Date().toLocaleDateString(LOCALE)}`});if(error)throw error;const factor=data;back.remove();const m=modal("Configurar autenticador",`<div class="qr-wrap"><img src="${esc(factor.totp.qr_code)}" alt="QR TOTP"></div><div style="height:12px"></div><div class="notice">Escanea el QR con Google Authenticator, Microsoft Authenticator, 1Password u otra app TOTP.</div><div class="field" style="margin-top:14px"><label>Código de 6 dígitos</label><input class="input" id="totp-code" inputmode="numeric" maxlength="6"></div><button type="button" class="btn primary block" id="totp-confirm">Confirmar MFA</button>`,null);$("#totp-confirm",m).onclick=async()=>{try{const code=$("#totp-code",m).value.trim();const {data:ch,error:ce}=await sb.auth.mfa.challenge({factorId:factor.id});if(ce)throw ce;const {error:ve}=await sb.auth.mfa.verify({factorId:factor.id,challengeId:ch.id,code});if(ve)throw ve;m.remove();await refreshSecurity();shell();navigate(state.page);toast("MFA configurado y verificado")}catch(e){toast(e.message,"error")}};hydrateIcons()}catch(e){toast(e.message,"error")}};
 if(factors.length)$("#mfa-verify",back).onclick=async()=>{const factor=factors.find(x=>x.status==="verified")||factors[0];back.remove();const m=modal("Verificar MFA",`<div class="field"><label>Código de 6 dígitos</label><input class="input" id="verify-code" inputmode="numeric" maxlength="6" autofocus></div>`,async()=>{const code=$("#verify-code",m).value.trim();const {data:ch,error:ce}=await sb.auth.mfa.challenge({factorId:factor.id});if(ce)throw ce;const {error:ve}=await sb.auth.mfa.verify({factorId:factor.id,challengeId:ch.id,code});if(ve)throw ve;await refreshSecurity();setTimeout(()=>{shell();navigate(state.page)},100)},"Verificar");hydrateIcons()};
 hydrateIcons();
}

async function start(){
 const {data:{session}}=await sb.auth.getSession();state.session=session;state.user=session?.user||null;
 if(!session){showLogin();return}
 try{await resolveContext();await refreshSecurity();shell();await navigate(state.page)}catch(e){console.error(e);await sb.auth.signOut();showLogin();toast(e.message,"error")}
}

sb.auth.onAuthStateChange(async(event,session)=>{
 state.session=session;state.user=session?.user||null;
 if(!session){showLogin();return}
 if(["SIGNED_IN","TOKEN_REFRESHED","MFA_CHALLENGE_VERIFIED"].includes(event)){try{await resolveContext();await refreshSecurity();shell();await navigate(state.page)}catch(e){console.error(e)}}
});

start();
})();

