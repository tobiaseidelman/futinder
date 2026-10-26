import { state } from './state.js';

// Historial de esta sesión: cada entrada guarda pantalla, partido y desplazamiento.
const navSession = Date.now().toString(36);
const navEntries = [];
let navIndex = -1;
let restoringNavigation = false;
let dialogBack = null;
window.restaurandoNavegacion=()=>restoringNavigation;
function saveNavigation(){
  const entry=navEntries[navIndex],screen=entry&&document.getElementById(entry.screen);
  if(!screen?.classList.contains('active'))return;
  entry.scroll=[screen,...screen.querySelectorAll('*')].map((el,index)=>({index,id:el.id,top:el.scrollTop,left:el.scrollLeft})).filter(p=>p.top||p.left);
  entry.matchTab=document.querySelector('#misPartidos .tab-btn.active')?.id?.replace('tab-','');
  entry.friendTab=document.querySelector('#amigos [aria-pressed="true"]')?.id;
}
document.addEventListener('scroll',saveNavigation,true);
function restoreScroll(entry){
  const screen=document.getElementById(entry.screen);
  if(!screen)return;
  const nodes=[screen,...screen.querySelectorAll('*')];
  for(const p of entry.scroll||[]){
    const el=p.id?document.getElementById(p.id):nodes[p.index];
    if(el){el.scrollTop=p.top;el.scrollLeft=p.left;}
  }
}
window.cambiarPantalla = (id) => {
  const target=document.getElementById(id);
  if(!target)return;
  saveNavigation();
  if(id !== 'adminPanel') window.detenerReportesAdmin?.();
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  target.classList.add('active');
  if(!restoringNavigation){
    const reset=['login','crearPerfil'].includes(id)||navIndex<0||['login','crearPerfil'].includes(navEntries[navIndex]?.screen);
    if(reset){navEntries.length=0;navIndex=-1;}
    if(reset||navEntries[navIndex]?.screen!==id){
      navEntries.splice(navIndex+1);
      navEntries.push({screen:id,partidoId:state.partidos[state.idx]?.id,scroll:[]});navIndex++;
      const value={...(history.state||{}),futNav:navSession,index:navIndex};
      if(reset)history.replaceState(value,'');else history.pushState(value,'');
    }
  }
  window.actualizarPuntosNav?.();
};
window.volverNavegacion = () => {
  if(history.state?.futNav===navSession&&(navIndex>0||dialogBack)){history.back();return true;}
  return false;
};
// Las flechas conservan su destino de respaldo si no hay historial interno.
document.addEventListener('click',e=>{
  if(e.target.closest?.('.back-btn')&&window.volverNavegacion()){e.preventDefault();e.stopImmediatePropagation();}
},true);
window.registrarDialogoNavegacion = cerrar => {
  saveNavigation();
  const token={cerrar};
  dialogBack=token;
  history.pushState({...(history.state||{}),futNav:navSession,index:navIndex,dialog:true},'');
  return ()=>{
    if(dialogBack!==token)return;
    dialogBack=null;
    // Reemplazar la entrada permite cerrar y abrir un partido sin una carrera con popstate.
    history.replaceState({...(history.state||{}),dialog:false},'');
  };
};
window.addEventListener('popstate',async e=>{
  const habiaDialogo=Boolean(dialogBack);
  if(dialogBack){const d=dialogBack;dialogBack=null;d.cerrar();}
  if(e.state?.futNav!==navSession)return;
  if(!habiaDialogo && e.state.index===navIndex && navIndex>0){history.back();return;}
  if(!state.usuario){window.cambiarPantalla('login');return;}
  const entry=navEntries[e.state.index];if(!entry)return;
  const scrollGuardado={...entry,scroll:[...(entry.scroll||[])]};
  saveNavigation();navIndex=e.state.index;restoringNavigation=true;
  try{
    const i=state.partidos.findIndex(p=>p.id===entry.partidoId);
    if(entry.screen==='chat'&&i>=0)window.abrirChatIdx(i);
    else if(entry.screen==='creador'&&i>=0)window.verDetalle(i);
    else if(entry.screen==='infoPartido'&&i>=0)window.verInfoPartido(i);
    else{
      window.cambiarPantalla(entry.screen);
      if(entry.screen==='misPartidos'&&entry.matchTab)window.switchTab(entry.matchTab);
      if(entry.screen==='amigos')await window.verAmigos(({tabChatsAmigos:'chats',tabMisAmigos:'amigos',tabSolicitudesAmigos:'solicitudes'})[entry.friendTab]);
    }
    requestAnimationFrame(()=>requestAnimationFrame(()=>restoreScroll(scrollGuardado)));
  }finally{restoringNavigation=false;}
});
window.irHome = () => { window.limpiarTarjetaPendiente?.(); render(); cambiarPantalla('home'); };

// Avisos breves dentro de la app, sin bloquear la navegación.
let avisoTimer;
let avisoActual;
window.mostrarAviso = (mensaje, tipo = 'info') => {
  clearTimeout(avisoTimer);
  avisoActual?.remove();
  const aviso = document.createElement('div');
  const error = tipo === 'error';
  const color = error ? 'var(--red, #ff4d4d)' : 'var(--green, #39ff14)';
  aviso.setAttribute('role', error ? 'alert' : 'status');
  aviso.setAttribute('aria-live', error ? 'assertive' : 'polite');
  aviso.setAttribute('aria-atomic', 'true');
  aviso.style.cssText = 'position:fixed;inset:auto 16px calc(86px + env(safe-area-inset-bottom, 0px));margin:0 auto;box-sizing:border-box;width:calc(100% - 32px);max-width:400px;padding:14px 16px;border:1px solid '+color+';border-radius:14px;background:#151515;color:#f5f5f5;box-shadow:0 8px 30px #0008;z-index:100000;display:flex;align-items:center;gap:10px;font:500 14px/1.45 "DM Sans",sans-serif;overflow-wrap:anywhere;pointer-events:none;';
  const icono = document.createElement('span');
  icono.textContent = error ? '!' : tipo === 'success' ? '✓' : 'i';
  icono.setAttribute('aria-hidden', 'true');
  icono.style.cssText = 'color:'+color+';font-size:20px;font-weight:700;flex-shrink:0';
  const texto = document.createElement('span');
  texto.textContent = String(mensaje);
  aviso.append(icono, texto);
  // Popover permite que el aviso también se vea encima del editor de fotos.
  if(typeof aviso.showPopover === 'function') aviso.setAttribute('popover', 'manual');
  document.body.append(aviso);
  if(typeof aviso.showPopover === 'function') aviso.showPopover();
  avisoActual = aviso;
  const animar = !window.matchMedia('(prefers-reduced-motion: reduce)').matches && typeof aviso.animate === 'function';
  if(animar) aviso.animate([{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});
  avisoTimer = setTimeout(async () => {
    if(animar){
      try { await aviso.animate([{opacity:1},{opacity:0,transform:'translateY(8px)'}],{duration:160,fill:'forwards'}).finished; } catch(e) {}
    }
    aviso.remove();
    if(avisoActual === aviso) avisoActual = null;
  }, error ? 6000 : 3000);
};

export function fechaPartido(fecha, ahora = new Date()){
  if(typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Fecha a confirmar';
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const fechaUTC = new Date(Date.UTC(anio, mes - 1, dia));
  if(fechaUTC.getUTCFullYear() !== anio || fechaUTC.getUTCMonth() !== mes - 1 || fechaUTC.getUTCDate() !== dia) return 'Fecha a confirmar';
  const partes = new Intl.DateTimeFormat('en', {timeZone:'America/Montevideo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ahora);
  const valor = tipo => Number(partes.find(p => p.type === tipo).value);
  const hoy = Date.UTC(valor('year'),valor('month') - 1,valor('day'));
  const dias = (fechaUTC.getTime() - hoy) / 86400000;
  if(dias >= 0 && dias <= 7){
    const semana = ['dom.','lun.','mar.','mié.','jue.','vie.','sáb.'];
    return semana[fechaUTC.getUTCDay()] + ' ' + dia;
  }
  return String(dia).padStart(2,'0') + '-' + String(mes).padStart(2,'0') + '-' + anio;
}

let confirmacionAbierta = false;
export function confirmarAccion({titulo, mensaje, aceptar}){
  if(confirmacionAbierta) return Promise.resolve(false);
  confirmacionAbierta = true;
  return new Promise(resolve => {
    const origen = document.activeElement;
    const dialogo = document.createElement('dialog');
    dialogo.className = 'fut-confirmacion';
    dialogo.setAttribute('aria-labelledby', 'fut-confirmacion-titulo');
    dialogo.setAttribute('aria-describedby', 'fut-confirmacion-texto');
    const estilo = document.createElement('style');
    estilo.textContent = `
      .fut-confirmacion{box-sizing:border-box;width:calc(100% - 32px);max-width:380px;max-height:calc(100dvh - 48px);margin:auto;padding:24px;border:1px solid #343434;border-radius:24px;background:#151515;color:#f5f5f5;box-shadow:0 24px 80px #0009;font-family:'DM Sans',sans-serif;overflow:auto}
      .fut-confirmacion::backdrop{background:rgba(0,0,0,.72);backdrop-filter:blur(4px)}
      .fut-confirmacion h2{margin:0 0 10px;font-size:22px;line-height:1.2;font-weight:700;letter-spacing:-.5px}
      .fut-confirmacion p{margin:0 0 24px;color:#aaa;font-size:14px;line-height:1.5;overflow-wrap:anywhere}
      .fut-confirmacion-acciones{display:flex;flex-wrap:wrap;gap:10px}
      .fut-confirmacion button{box-sizing:border-box;flex:1 1 120px;min-height:48px;padding:12px;border:1px solid #3a3a3a;border-radius:13px;background:#222;color:#eee;font:600 14px/1.3 'DM Sans',sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent}
      .fut-confirmacion button:last-child{background:var(--green,#39ff14);border-color:var(--green,#39ff14);color:#090909}
      .fut-confirmacion button:focus-visible{outline:2px solid var(--green,#39ff14);outline-offset:4px}
      .fut-confirmacion button:active{opacity:.8}
      @media(prefers-reduced-motion:no-preference){.fut-confirmacion[open]{animation:fut-confirmar-entrada .18s ease-out}@keyframes fut-confirmar-entrada{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}}
    `;
    const encabezado = document.createElement('h2');
    encabezado.id = 'fut-confirmacion-titulo';
    encabezado.textContent = titulo;
    const texto = document.createElement('p');
    texto.id = 'fut-confirmacion-texto';
    texto.textContent = mensaje;
    const acciones = document.createElement('div');
    acciones.className = 'fut-confirmacion-acciones';
    const volver = document.createElement('button');
    volver.type = 'button';
    volver.textContent = 'Volver';
    volver.autofocus = true;
    const confirmar = document.createElement('button');
    confirmar.type = 'button';
    confirmar.textContent = aceptar;
    acciones.append(volver, confirmar);
    dialogo.append(estilo, encabezado, texto, acciones);
    const overflowAnterior = document.body.style.overflow;
    let terminado = false;
    const cerrar = resultado => {
      if(terminado) return;
      terminado = true;
      dialogo.close();
      dialogo.remove();
      document.body.style.overflow = overflowAnterior;
      confirmacionAbierta = false;
      if(origen?.isConnected) origen.focus({preventScroll:true});
      resolve(resultado);
    };
    volver.addEventListener('click', () => cerrar(false));
    confirmar.addEventListener('click', () => cerrar(true));
    dialogo.addEventListener('cancel', e => { e.preventDefault(); cerrar(false); });
    dialogo.addEventListener('close', () => cerrar(false));
    dialogo.addEventListener('click', e => {
      const r = dialogo.getBoundingClientRect();
      if(e.target === dialogo && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) cerrar(false);
    });
    document.body.append(dialogo);
    document.body.style.overflow = 'hidden';
    dialogo.showModal();
    volver.focus({preventScroll:true});
  });
}
