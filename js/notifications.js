import { state } from './state.js';
import { query, collection, db, orderBy, onSnapshot, updateDoc, doc, deleteDoc } from './firebase.js';

function iniciarNotificaciones(){
  if(state.notifUnsub) state.notifUnsub();
  if(!state.usuario) return;
  const uid = state.usuario.uid;
  state.notificaciones = [];
  actualizarBadge();
  state.notifUnsub = onSnapshot(query(collection(db,'usuarios',uid,'notificaciones'),orderBy('creadoEn','desc')),snap=>{
    if(state.usuario?.uid !== uid) return;
    state.notificaciones = snap.docs.map(d=>({id:d.id,...d.data()}));
    actualizarBadge();
    if(document.getElementById('notificaciones').classList.contains('active')) renderNotificaciones();
  },()=>{
    if(state.usuario?.uid===uid) window.mostrarAviso('No pudimos cargar las notificaciones. Revisá tu conexión.', 'error');
  });
}
function actualizarBadge(){
  const total = state.notificaciones.filter(n=>!n.visto).length;
  const badge = document.getElementById('badgeDot');
  badge.classList.toggle('show',total>0);
  badge.setAttribute('aria-label',total+' notificaciones sin leer');
}
function participa(p){
  return (p.confirmados||[]).some(c=>typeof c==='string'?c===state.perfil?.nombre:c.uid?c.uid===state.usuario?.uid:c.nombre===state.perfil?.nombre);
}
function etiquetaNotificacion(n){
  const etiquetas={solicitud:'Solicitud para unirse',aceptado:'Solicitud aceptada',rechazado:'Solicitud rechazada',cancelado:'Partido cancelado',bajada:'Jugador se bajó',calificar:'Calificá a tus compañeros',tag_malo:'Tu reputación',solicitud_vencida:'Solicitud vencida',solicitud_reprogramada:'Solicitud cancelada por cambio de horario',respuesta_horario:'Respuesta al nuevo horario',reprogramado:'Confirmá el nuevo horario'};
  const p = state.partidos.find(p=>p.id===n.partidoId);
  if(n.tipo==='reprogramado' && p){
    if(n.versionHorario!==p.versionHorario) return 'Cambio de horario anterior';
    const pendiente=(p.confirmados||[]).some(c=>c.pendienteReconfirmar && (c.uid?c.uid===state.usuario?.uid:c.nombre===state.perfil?.nombre));
    if(!pendiente) return 'Cambio de horario · respondido';
  }
  if(n.tipo==='solicitud' && p && n.solicitanteUid && !(p.solicitudes||[]).some(s=>s.uid===n.solicitanteUid)) return 'Solicitud resuelta';
  return etiquetas[n.tipo] || 'Aviso';
}
function renderNotificaciones(){
  const lista = document.getElementById('listaNotificaciones');
  lista.replaceChildren();
  if(!state.notificaciones.length){
    const vacio=document.createElement('div');vacio.className='empty';
    vacio.textContent='No tenés notificaciones.';lista.append(vacio);return;
  }
  for(const n of state.notificaciones){
    const fila=document.createElement('div');fila.className='notif-item';fila.tabIndex=0;fila.setAttribute('role','button');
    fila.setAttribute('aria-label',(n.visto?'Leída. ':'Sin leer. ')+String(n.texto||'Aviso'));
    fila.onclick=()=>window.abrirNotificacion(n.id);
    fila.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();window.abrirNotificacion(n.id);}};
    const punto=document.createElement('div');punto.className='notif-dot'+(n.visto?' visto':'');punto.setAttribute('aria-hidden','true');
    const contenido=document.createElement('div');
    const texto=document.createElement('div');texto.className='notif-text';texto.textContent=n.texto||'Aviso';texto.style.fontWeight=n.visto?'400':'600';
    const sub=document.createElement('div');sub.className='notif-sub';sub.textContent=etiquetaNotificacion(n)+' · '+(n.visto?'Leída':'Sin leer');
    contenido.append(texto,sub);fila.append(punto,contenido);lista.append(fila);
  }
}
window.verNotificaciones=()=>{renderNotificaciones();cambiarPantalla('notificaciones');};

const abriendo=new Set();
window.abrirNotificacion=async id=>{
  const n=state.notificaciones.find(n=>n.id===id),uid=state.usuario?.uid;
  if(!n||!uid||abriendo.has(id)) return;
  abriendo.add(id);
  try {
    if(!n.visto){
      try {
        await updateDoc(doc(db,'usuarios',uid,'notificaciones',id),{visto:true});
        if(state.usuario?.uid!==uid) return;
        n.visto=true;actualizarBadge();
      } catch(e){window.mostrarAviso('No se pudo marcar como leída. Podés abrirla igual.');}
    }
    if(state.usuario?.uid!==uid) return;
    if(n.tipo==='tag_malo'){verMiPerfil();return;}
    if(['cancelado','rechazado','solicitud_vencida'].includes(n.tipo)){
      window.mostrarAviso(n.texto||'Esta solicitud ya no está pendiente.');
      verMisPartidos();if(n.tipo!=='cancelado') window.switchTab('pendientes');return;
    }
    if(n.tipo==='solicitud_reprogramada'){irHome();return;}
    const i=state.partidos.findIndex(p=>p.id===n.partidoId);
    if(i<0){window.mostrarAviso('Este partido ya no está disponible.');verMisPartidos();return;}
    const p=state.partidos[i];
    if(p.creadorUid===uid){verDetalle(i);return;}
    if(participa(p)){verInfoPartido(i);return;}
    window.mostrarAviso('Ya no tenés un lugar confirmado en este partido.');verMisPartidos();
  } finally {abriendo.delete(id);}
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
