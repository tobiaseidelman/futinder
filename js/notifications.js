import { state } from './state.js';
import { query, collection, db, orderBy, onSnapshot, updateDoc, doc, deleteDoc } from './firebase.js';

// ---- NOTIFICACIONES EN TIEMPO REAL ----
function iniciarNotificaciones(){
  if(!state.usuario) return;
  if(state.notifUnsub) state.notifUnsub();
  const nq = query(
    collection(db, "usuarios", state.usuario.uid, "notificaciones"),
    orderBy("creadoEn", "desc")
  );
  state.notifUnsub = onSnapshot(nq, (snap) => {
    state.notificaciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    actualizarBadge();
    if(document.getElementById("notificaciones").classList.contains("active")) verNotificaciones();
  });
}

// ---- BADGE ----
function actualizarBadge(){
  let n = state.notificaciones.filter(x => !x.visto).length;
  document.getElementById("badgeDot").classList.toggle("show", n > 0);
}

// ---- NOTIFICACIONES ----
window.verNotificaciones = () => {
  let html = state.notificaciones.length === 0
    ? `<div class="empty"><div class="empty-icon">🔔</div><div class="empty-text">Sin notificaciones</div></div>`
    : state.notificaciones.map((n) => `
        <div class="notif-item" onclick="abrirNotificacion('${n.id}')">
          <div class="notif-dot ${n.visto?'visto':''}"></div>
          <div>
            <div class="notif-text">${n.texto}</div>
            <div class="notif-sub">${n.tipo==='solicitud'?'Solicitud de partido':n.tipo==='cancelado'?'Partido cancelado':n.tipo==='bajada'?'Jugador se bajó':n.tipo==='calificar'?'Calificá a tus compañeros':'Aceptado en partido'}</div>
          </div>
        </div>`).join('');
  document.getElementById("listaNotificaciones").innerHTML = html;
  cambiarPantalla("notificaciones");
};

window.abrirNotificacion = async (notifId) => {
  let n = state.notificaciones.find(x => x.id === notifId);
  if(!n) return;
  // Marcar como visto en Firebase
  await updateDoc(doc(db, "usuarios", state.usuario.uid, "notificaciones", notifId), { visto: true });
  let pi = state.partidos.findIndex(p => p.id === n.partidoId);
  if(pi >= 0){
    state.idx = pi;
    if(n.tipo === "solicitud") verMisPartidos(); // lleva al creador a sus partidos
    else if(n.tipo === "calificar"){
      if(state.partidos[state.idx].creadorUid === state.usuario.uid) verDetalle(state.idx); else verInfoPartido(state.idx);
    }
    else abrirChatIdx(state.idx);
  } else irHome();
};

window.limpiarNotificaciones = async () => {
  for(let n of state.notificaciones){
    await deleteDoc(doc(db, "usuarios", state.usuario.uid, "notificaciones", n.id));
  }
  actualizarBadge();
  verNotificaciones();
};


export { iniciarNotificaciones, actualizarBadge };
