import { state } from './state.js';
import { nombreDeConfirmado } from './matches.js';
import { query, collection, db, orderBy, onSnapshot, addDoc, serverTimestamp, getDoc, doc } from './firebase.js';

const fotosChat = new Map();
let sesionFotos = null;
export function avatarMensaje(uid,nombre){
  if(sesionFotos!==state.usuario?.uid){fotosChat.clear();sesionFotos=state.usuario?.uid;}
  const avatar=document.createElement('span');avatar.className='message-avatar';
  avatar.textContent=(nombre||'?')[0].toUpperCase();
  avatar.setAttribute('aria-label','Foto de '+(nombre||'Jugador'));
  const aplicar=datos=>{
    if(typeof datos?.foto!=='string'||!/^(https?:\/\/|data:image\/jpeg;base64,)/.test(datos.foto))return;
    const img=document.createElement('img');img.alt='Foto de '+(datos.nombre||nombre||'Jugador');
    img.onerror=()=>{avatar.textContent=(nombre||'?')[0].toUpperCase();};
    window.prepararFotoAmpliable?.(img);img.src=datos.foto;avatar.replaceChildren(img);
  };
  if(uid===state.usuario?.uid)aplicar(state.perfil);
  else if(uid){
    if(!fotosChat.has(uid))fotosChat.set(uid,getDoc(doc(db,'usuarios',uid)).then(s=>s.exists()?s.data():null).catch(()=>null));
    fotosChat.get(uid).then(aplicar);
  }
  return avatar;
}
export function horaMensaje(timestamp){
  const time=document.createElement('time');time.className='message-time';
  const fecha=timestamp?.toDate?.();
  if(fecha&&!Number.isNaN(fecha.getTime())){
    time.dateTime=fecha.toISOString();
    time.textContent=fecha.toLocaleTimeString('es-UY',{hour:'2-digit',minute:'2-digit',hour12:false});
    time.title=fecha.toLocaleString('es-UY');
  }else time.textContent='Enviando…';
  return time;
}

let partidoChatId = null;
let enviandoMensaje = false;
let seguirUltimo = true;
const mensajes = document.getElementById('mensajes');
const pantallaChat = document.getElementById('chat');
const entradaChat = document.getElementById('mensajeInput');
const botonEnviar = pantallaChat.querySelector('.send-btn');

function cercaDelFinal(){
  return mensajes.scrollHeight - mensajes.clientHeight - mensajes.scrollTop < 72;
}
mensajes.addEventListener('scroll', () => { seguirUltimo = cercaDelFinal(); }, {passive:true});
function ajustarChat(){
  if(!pantallaChat.classList.contains('active')) return;
  const viewport = window.visualViewport;
  pantallaChat.style.setProperty('--chat-height', (viewport?.height || window.innerHeight) + 'px');
  pantallaChat.style.setProperty('--chat-top', (viewport?.offsetTop || 0) + 'px');
  if(seguirUltimo) mensajes.scrollTop = mensajes.scrollHeight;
}
window.visualViewport?.addEventListener('resize', ajustarChat);
window.visualViewport?.addEventListener('scroll', ajustarChat);
window.addEventListener('resize', ajustarChat);
new MutationObserver(() => {
  const activo = pantallaChat.classList.contains('active');
  document.body.classList.toggle('chat-abierto', activo);
  if(activo) ajustarChat();
  else {
    entradaChat.blur();
    if(state.chatUnsub){ state.chatUnsub(); state.chatUnsub = null; }
    partidoChatId = null;
  }
}).observe(pantallaChat, {attributes:true,attributeFilter:['class']});

window.abrirChatPartido = () => abrirChatIdx(state.idx);
window.abrirChatIdx = i => {
  const p = state.partidos[i];
  if(!p || !state.perfil || !state.usuario) return;
  const esCreador = p.creadorUid ? p.creadorUid === state.usuario.uid : p.creador === state.perfil.nombre;
  const confirmado = (p.confirmados || []).some(c => typeof c === 'string' ? c === state.perfil.nombre : c.uid === state.usuario.uid);
  if(!esCreador && !confirmado){
    window.mostrarAviso('Solo pueden entrar al chat el creador y los jugadores confirmados.');
    return;
  }
  state.idx = i;
  if(partidoChatId !== p.id) entradaChat.value = '';
  partidoChatId = p.id;
  seguirUltimo = true;
  mensajes.replaceChildren();
  document.getElementById('chatTitle').textContent = p.cancha;
  document.getElementById('chatBackBtn').onclick = () => {
    const indice = state.partidos.findIndex(x => x.id === p.id);
    if(indice < 0) return window.verMisPartidos();
    if(esCreador) window.verDetalle(indice); else window.verInfoPartido(indice);
  };
  if(state.chatUnsub) state.chatUnsub();
  cambiarPantalla('chat');
  ajustarChat();
  let primeraCarga = true;
  const chatQ = query(collection(db,'partidos',p.id,'mensajes'), orderBy('hora','asc'));
  state.chatUnsub = onSnapshot(chatQ, snap => {
    if(partidoChatId !== p.id) return;
    const bajar = primeraCarga || cercaDelFinal();
    const posicion = mensajes.scrollTop;
    const fragmento = document.createDocumentFragment();
    snap.docs.forEach(d => {
      const m = d.data();
      const propio = m.uid ? m.uid === state.usuario?.uid : m.nombre === state.perfil?.nombre;
      const mensaje = document.createElement('div');
      mensaje.className = 'msg ' + (propio ? 'msg-own' : 'msg-other');
      if(!propio){
        const autor = document.createElement('div');
        autor.className = 'msg-sender';
        autor.textContent = m.nombre || 'Jugador';
        mensaje.append(autor);
      }
      const texto = document.createElement('span');
      texto.textContent = m.texto || '';
      mensaje.append(texto);
      mensaje.append(horaMensaje(m.hora));
      const fila=document.createElement('div');fila.className='message-row'+(propio?' own':'');
      const autorUid=m.uid || (p.confirmados||[]).find(c=>typeof c==='object'&&c.nombre===m.nombre)?.uid || (m.nombre===p.creador?p.creadorUid:null);
      fila.append(avatarMensaje(autorUid,m.nombre),mensaje);
      fragmento.append(fila);
    });
    mensajes.replaceChildren(fragmento);
    if(!snap.docs.length){
      const vacio = document.createElement('div');
      vacio.className = 'empty';
      vacio.textContent = 'Sin mensajes todavía. ¡Rompé el hielo!';
      mensajes.append(vacio);
    }
    mensajes.scrollTop = bajar ? mensajes.scrollHeight : posicion;
    seguirUltimo = bajar;
    primeraCarga = false;
  }, () => window.mostrarAviso('No se pudieron cargar los mensajes. Volvé a entrar al chat.', 'error'));
};

window.enviarMensaje = async () => {
  const txt = entradaChat.value.trim();
  const id = partidoChatId;
  const uid = state.usuario?.uid;
  if(!txt || !id || !uid || enviandoMensaje) return;
  enviandoMensaje = true;
  botonEnviar.disabled = true;
  entradaChat.value = '';
  seguirUltimo = true;
  try {
    await addDoc(collection(db,'partidos',id,'mensajes'), {
      nombre: state.perfil.nombre, uid, texto:txt, hora:serverTimestamp()
    });
    if(partidoChatId === id) mensajes.scrollTop = mensajes.scrollHeight;
  } catch(e) {
    if(partidoChatId === id && state.usuario?.uid === uid && !entradaChat.value) entradaChat.value = txt;
    window.mostrarAviso('No se pudo enviar el mensaje. Intentá de nuevo.', 'error');
  } finally {
    enviandoMensaje = false;
    botonEnviar.disabled = false;
  }
};
// Mantener el teclado abierto al tocar Enviar.
botonEnviar.addEventListener('pointerdown', e => {
  if(document.activeElement === entradaChat) e.preventDefault();
});
