import { state } from './state.js';
import { nombreDeConfirmado } from './matches.js';
import { query, collection, db, orderBy, onSnapshot, addDoc, serverTimestamp } from './firebase.js';

// ---- CHAT EN TIEMPO REAL ----
window.abrirChatPartido = () => abrirChatIdx(state.idx);
window.abrirChatIdx = (i) => {
  state.idx = i;
  let p = state.partidos[i];
  let esCreador = state.perfil && p.creador === state.perfil.nombre;
  let confirmado = state.perfil && (p.confirmados||[]).some(c => nombreDeConfirmado(c) === state.perfil.nombre);
  if(!esCreador && !confirmado){
    alert("Solo pueden entrar al chat el creador y los jugadores confirmados.");
    return;
  }
  document.getElementById("chatTitle").textContent = p.cancha;
  if(state.chatUnsub) state.chatUnsub();
  const chatQ = query(collection(db,"partidos",p.id,"mensajes"), orderBy("hora","asc"));
  state.chatUnsub = onSnapshot(chatQ, (snap) => {
    let html = '';
    snap.docs.forEach(d => {
      let m = d.data();
      let own = state.perfil && m.nombre === state.perfil.nombre;
      html += `<div class="msg ${own?'msg-own':'msg-other'}">
        ${!own?`<div class="msg-sender">${m.nombre}</div>`:''}
        ${m.texto}
      </div>`;
    });
    document.getElementById("mensajes").innerHTML = html || `<div class="empty"><div class="empty-icon">💬</div><div class="empty-text">Sin mensajes todavía.<br>¡Rompé el hielo!</div></div>`;
    const el = document.getElementById("mensajes");
    el.scrollTop = el.scrollHeight;
  });
  cambiarPantalla("chat");
};

window.enviarMensaje = async () => {
  let txt = document.getElementById("mensajeInput").value.trim();
  if(!txt) return;
  let p = state.partidos[state.idx];
  await addDoc(collection(db,"partidos",p.id,"mensajes"), {
    nombre: state.perfil.nombre,
    texto: txt,
    hora: serverTimestamp()
  });
  document.getElementById("mensajeInput").value = '';
};
