import { getEstadoPartido } from './matches.js';
import { state } from './state.js';
import { query, collection, db, orderBy, onSnapshot, updateDoc, doc, deleteDoc } from './firebase.js';

function iniciarNotificaciones(){
  if(state.notifUnsub) state.notifUnsub();
  if(!state.usuario) return;
  const uid = state.usuario.uid;
  state.notificaciones = [];
  soloNoLeidas=false;
  estadoCargaNotificaciones='cargando';
  actualizarBadge();
  state.notifUnsub = onSnapshot(query(collection(db,'usuarios',uid,'notificaciones'),orderBy('creadoEn','desc')),snap=>{
    if(state.usuario?.uid !== uid) return;
    estadoCargaNotificaciones='listo';
    state.notificaciones = snap.docs.map(d=>({...d.data(),id:d.id}));
    actualizarBadge();
    if(document.getElementById('notificaciones').classList.contains('active')) renderNotificaciones();
  },()=>{
    if(state.usuario?.uid!==uid)return;
    estadoCargaNotificaciones='error';
    if(document.getElementById('notificaciones').classList.contains('active'))renderNotificaciones();
    window.mostrarAviso('No pudimos cargar las notificaciones. Revisá tu conexión.', 'error');
  });
}
// Los puntos reflejan avisos sin leer y pendientes reales, sin nuevas consultas.
window.actualizarPuntosNav = () => {
  const avisos = state.usuario ? state.notificaciones.filter(n=>!n.visto) : [];
  const social = state.usuario ? window.novedadesSocial?.() || {} : {};
  const partidos = new Set(['solicitud','aceptado','rechazado','cancelado','bajada','calificar','solicitud_vencida','solicitud_reprogramada','respuesta_horario','reprogramado','partido_compartido']);
  const grupos = {
    amigos: Boolean(social.chats || social.solicitudes || avisos.some(n=>n.tipo==='amistad_aceptada')),
    partidos: avisos.some(n=>partidos.has(n.tipo)),
    perfil: avisos.some(n=>n.tipo==='tag_malo')
  };
  // Clasificar por el estado actual: una aceptación antigua puede pertenecer
  // ahora a Finalizados. Los avisos de solicitudes propias van a Pendientes.
  const secciones = {creados:false,pendientes:false,confirmados:false,finalizados:false};
  for(const aviso of avisos){
    if(!partidos.has(aviso.tipo)) continue;
    const partido=state.partidos.find(p=>p.id===aviso.partidoId);
    let destino='confirmados';
    if(aviso.tipo==='calificar' || (partido && getEstadoPartido(partido)==='finalizado')) destino='finalizados';
    else if(partido && (partido.creadorUid===state.usuario?.uid || (!partido.creadorUid && partido.creador===state.perfil?.nombre))) destino='creados';
    else if(['rechazado','solicitud_vencida','solicitud_reprogramada','partido_compartido'].includes(aviso.tipo)) destino='pendientes';
    secciones[destino]=true;
  }
  const pestanas = [
    ['tab-creados','Creados',secciones.creados],
    ['tab-pendientes','Pendientes',secciones.pendientes],
    ['tab-confirmados','Confirmados',secciones.confirmados],
    ['tab-finalizados','Finalizados',secciones.finalizados],
    ['tabChatsAmigos','Chats',Boolean(social.chats)],
    ['tabMisAmigos','Mis amigos',avisos.some(n=>n.tipo==='amistad_aceptada')],
    ['tabSolicitudesAmigos','Solicitudes',Boolean(social.solicitudes)]
  ];
  for(const [id,nombre,activo] of pestanas){
    const boton=document.getElementById(id);
    if(!boton) continue;
    boton.classList.toggle('section-has-news',activo);
    boton.title=activo ? nombre+': novedades pendientes' : nombre;
    // Mantener el contador accesible de conversaciones sin leer.
    if(id!=='tabChatsAmigos') boton.setAttribute('aria-label',nombre+(activo?', novedades pendientes':''));
  }
  document.querySelectorAll('[data-nav-alert]').forEach(boton=>{
    const activo=Boolean(grupos[boton.dataset.navAlert]);
    boton.classList.toggle('has-news',activo);
    const nombre={amigos:'Amigos',partidos:'Mis partidos',perfil:'Perfil'}[boton.dataset.navAlert];
    boton.setAttribute('aria-label',nombre+(activo?', novedades pendientes':''));
    boton.title=activo ? 'Tenés novedades pendientes' : nombre;
  });
};
function actualizarBadge(){
  window.actualizarPuntosNav();
  const total = state.notificaciones.filter(n=>!n.visto).length;
  const badge = document.getElementById('badgeDot');
  if(!badge)return;
  badge.classList.toggle('show',total>0);
  badge.setAttribute('aria-label',total+' notificaciones sin leer');
}
function participa(p){
  return (p.confirmados||[]).some(c=>typeof c==='string'?c===state.perfil?.nombre:c.uid?c.uid===state.usuario?.uid:c.nombre===state.perfil?.nombre);
}
function etiquetaNotificacion(n){
  const etiquetas={mensaje_privado:'Mensaje nuevo',amistad_solicitud:'Solicitud de amistad',amistad_aceptada:'Nuevo amigo',partido_compartido:'Te compartieron un partido',solicitud:'Solicitud para unirse',aceptado:'Solicitud aceptada',rechazado:'Solicitud rechazada',cancelado:'Partido cancelado',bajada:'Jugador se bajó',calificar:'Calificá a tus compañeros',tag_malo:'Tu reputación',solicitud_vencida:'Solicitud vencida',solicitud_reprogramada:'Solicitud cancelada por cambio de horario',respuesta_horario:'Respuesta al nuevo horario',reprogramado:'Confirmá el nuevo horario'};
  const p = state.partidos.find(p=>p.id===n.partidoId);
  if(n.tipo==='reprogramado' && p){
    if(n.versionHorario!==p.versionHorario) return 'Cambio de horario anterior';
    const pendiente=(p.confirmados||[]).some(c=>c.pendienteReconfirmar && (c.uid?c.uid===state.usuario?.uid:c.nombre===state.perfil?.nombre));
    if(!pendiente) return 'Cambio de horario · respondido';
  }
  if(n.tipo==='solicitud' && p && getEstadoPartido(p)!=='activo')return 'Solicitud vencida';
  if(n.tipo==='solicitud' && p && n.solicitanteUid && !(p.solicitudes||[]).some(s=>s.uid===n.solicitanteUid)) return 'Solicitud resuelta';
  return etiquetas[n.tipo] || 'Aviso';
}

let soloNoLeidas = false;
let estadoCargaNotificaciones='cargando';
window.filtrarNotificaciones = valor => {soloNoLeidas=valor;renderNotificaciones();};
function fechaNotificacion(n){
  const ms = typeof n.creadoEn?.toMillis === 'function' ? n.creadoEn.toMillis() : Number(n.creadoEn?.seconds)*1000;
  return Number.isFinite(ms) ? ms : null;
}
function tiempoNotificacion(ms){
  if(ms === null) return '';
  const minutos=Math.max(0,Math.floor((Date.now()-ms)/60000));
  if(minutos<1) return 'Ahora';
  if(minutos<60) return 'Hace '+minutos+' min';
  if(minutos<1440) return 'Hace '+Math.floor(minutos/60)+' h';
  return new Intl.DateTimeFormat('es-UY',{timeZone:'America/Montevideo',day:'numeric',month:'short'}).format(ms);
}
function renderNotificaciones(){
  const lista = document.getElementById('listaNotificaciones');
  lista.replaceChildren();
  const sinLeer=state.notificaciones.filter(n=>!n.visto).length;
  document.getElementById('notifResumen').textContent=sinLeer ? 'Tenés '+sinLeer+' '+(sinLeer===1?'novedad sin leer':'novedades sin leer') : 'Estás al día';
  document.getElementById('notifCantidad').textContent=sinLeer;
  document.getElementById('notifTodas').setAttribute('aria-pressed',String(!soloNoLeidas));
  document.getElementById('notifNoLeidas').setAttribute('aria-pressed',String(soloNoLeidas));
  if(estadoCargaNotificaciones!=='listo'){
    const mensaje=document.createElement('p');mensaje.className='notif-empty';mensaje.setAttribute('role','status');
    mensaje.textContent=estadoCargaNotificaciones==='cargando'?'Cargando notificaciones…':'No se pudieron cargar las notificaciones.';
    lista.append(mensaje);
    if(estadoCargaNotificaciones==='error'){
      const reintentar=document.createElement('button');reintentar.className='social-action';reintentar.textContent='Reintentar';
      reintentar.onclick=()=>{iniciarNotificaciones();renderNotificaciones();};lista.append(reintentar);
    }
    document.getElementById('notifResumen').textContent=estadoCargaNotificaciones==='cargando'?'Consultando tus novedades…':'Revisá tu conexión y volvé a intentar.';
    return;
  }
  const visibles=state.notificaciones.filter(n=>!soloNoLeidas||!n.visto);
  if(!visibles.length){
    const vacio=document.createElement('div');vacio.className='notif-empty';
    const icon=document.createElement('span');icon.className='notif-empty-icon';icon.textContent='✓';icon.setAttribute('aria-hidden','true');
    const titulo=document.createElement('h2');titulo.textContent=soloNoLeidas?'Todo leído':'Todo tranquilo por acá';
    const texto=document.createElement('p');texto.textContent=soloNoLeidas?'No te queda ninguna novedad por revisar.':'Las solicitudes y novedades de tus partidos aparecerán acá.';
    vacio.append(icon,titulo,texto);lista.append(vacio);return;
  }
  const dia=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Montevideo',year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
  const hoy=dia(Date.now()),ayer=dia(Date.now()-86400000);
  let grupoAnterior='';
  for(const n of visibles){
    const ms=fechaNotificacion(n);
    const grupo=ms===null?'Novedades':dia(ms)===hoy?'Hoy':dia(ms)===ayer?'Ayer':'Anteriores';
    if(grupo!==grupoAnterior){
      const heading=document.createElement('h2');heading.className='notif-group';heading.textContent=grupo;lista.append(heading);grupoAnterior=grupo;
    }
    const fila=document.createElement('button');fila.type='button';fila.className='notif-card'+(n.visto?'':' is-unread');
    fila.setAttribute('aria-label',(n.visto?'Leída. ':'Sin leer. ')+String(n.texto||'Aviso'));
    fila.onclick=()=>window.abrirNotificacion(n.id);
    const icon=document.createElement('span');icon.className='notif-symbol';icon.setAttribute('aria-hidden','true');
    icon.textContent=({mensaje_privado:'💬',amistad_solicitud:'👥',amistad_aceptada:'✓',partido_compartido:'↗',solicitud:'＋',aceptado:'✓',rechazado:'−',cancelado:'×',bajada:'↘',calificar:'☆',tag_malo:'☆',solicitud_vencida:'◷',solicitud_reprogramada:'↻',respuesta_horario:'✓',reprogramado:'↻'})[n.tipo]||'•';
    const contenido=document.createElement('span');contenido.className='notif-content';
    const cabecera=document.createElement('span');cabecera.className='notif-card-header';
    const titulo=document.createElement('span');titulo.className='notif-card-title';titulo.textContent=etiquetaNotificacion(n);
    cabecera.append(titulo);
    if(!n.visto){const punto=document.createElement('span');punto.className='notif-unread-dot';punto.setAttribute('aria-hidden','true');cabecera.append(punto);}
    const texto=document.createElement('span');texto.className='notif-card-text';texto.textContent=n.texto||'Aviso';
    const tiempo=document.createElement('span');tiempo.className='notif-card-time';tiempo.textContent=tiempoNotificacion(ms);
    contenido.append(cabecera,texto,tiempo);
    fila.append(icon,contenido);lista.append(fila);
  }
}
window.actualizarVistaNotificaciones=()=>{window.actualizarPuntosNav();if(document.getElementById('notificaciones')?.classList.contains('active'))renderNotificaciones();};
window.verNotificaciones=()=>{renderNotificaciones();cambiarPantalla('notificaciones');};

const abriendo=new Set();
window.abrirNotificacion=async id=>{
  const n=state.notificaciones.find(n=>n.id===id),uid=state.usuario?.uid;
  const clave=uid+':'+id;
  if(!n||!uid||abriendo.has(clave)) return;
  abriendo.add(clave);
  try {
    if(!n.visto){
      try {
        await updateDoc(doc(db,'usuarios',uid,'notificaciones',id),{visto:true});
        if(state.usuario?.uid!==uid) return;
        const actual=state.notificaciones.find(item=>item.id===id);
        if(actual)actual.visto=true;
        actualizarBadge();window.actualizarVistaNotificaciones();
      } catch(e){window.mostrarAviso('No se pudo marcar como leída. Podés abrirla igual.');}
    }
    if(state.usuario?.uid!==uid) return;
    if(n.tipo==='mensaje_privado'){await window.abrirChatAmigo(n.deUid);return;}
    if(n.tipo==='amistad_solicitud'){window.verAmigos('solicitudes');return;}
    if(n.tipo==='amistad_aceptada'){window.verAmigos();return;}
    if(n.tipo==='partido_compartido'){await window.abrirPartidoCompartido(n.partidoId);return;}
    if(n.tipo==='tag_malo'){verMiPerfil();return;}
    if(['cancelado','rechazado','solicitud_vencida'].includes(n.tipo)){
      window.mostrarAviso(n.texto||'Esta solicitud ya no está pendiente.');
      verMisPartidos();if(n.tipo!=='cancelado') window.switchTab('pendientes');return;
    }
    if(n.tipo==='solicitud_reprogramada'){await window.abrirPartidoCompartido(n.partidoId);return;}
    const i=state.partidos.findIndex(p=>p.id===n.partidoId);
    if(i<0){window.mostrarAviso('Este partido ya no está disponible.');verMisPartidos();return;}
    const p=state.partidos[i];
    if(p.creadorUid===uid){verDetalle(i);return;}
    if(participa(p)){verInfoPartido(i);return;}
    window.mostrarAviso('Ya no tenés un lugar confirmado en este partido.');verMisPartidos();
  } finally {abriendo.delete(clave);}
};

let limpiando=false;
window.limpiarNotificaciones=async()=>{
  const uid=state.usuario?.uid;
  if(!uid||limpiando) return;
  limpiando=true;
  const ids=state.notificaciones.map(n=>n.id);
  try {
    const resultados=await Promise.allSettled(ids.map(id=>deleteDoc(doc(db,'usuarios',uid,'notificaciones',id))));
    if(state.usuario?.uid!==uid) return;
    const borrados=new Set(ids.filter((id,i)=>resultados[i].status==='fulfilled'));
    state.notificaciones=state.notificaciones.filter(n=>!borrados.has(n.id));actualizarBadge();
    if(document.getElementById('notificaciones').classList.contains('active')) renderNotificaciones();
    if(resultados.some(r=>r.status==='rejected')) window.mostrarAviso('Algunas notificaciones no se pudieron borrar. Intentá de nuevo.', 'error');
  } finally {limpiando=false;}
};
export { iniciarNotificaciones, actualizarBadge };
