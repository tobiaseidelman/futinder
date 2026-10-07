import { actualizarBadge } from './notifications.js';
import { state } from './state.js';
import { nombreDeConfirmado } from './matches.js';
import { partidoPasaFiltros, filtros } from './filters.js';
import { calcularDistancia } from './location.js';
import { updateDoc, doc, db, addDoc, collection, serverTimestamp } from './firebase.js';

// ---- SWIPE ----
let startX = 0, isDragging = false, cardEl = null, currentX = 0;
function initSwipe(){
  const card = document.querySelector(".partido-card");
  if(!card) return;
  cardEl = card;
  card.addEventListener("touchstart", e => { startX = e.touches[0].clientX; isDragging = true; card.classList.add("swiping"); }, {passive:true});
  card.addEventListener("touchmove", e => {
    if(!isDragging) return;
    currentX = e.touches[0].clientX - startX;
    card.style.transform = `translateX(${currentX}px) rotate(${currentX*0.08}deg)`;
    const yes = card.querySelector(".swipe-overlay.yes");
    const no = card.querySelector(".swipe-overlay.no");
    if(currentX > 0){ yes.style.opacity = Math.min(currentX/80,1); no.style.opacity=0; }
    else { no.style.opacity = Math.min(-currentX/80,1); yes.style.opacity=0; }
  }, {passive:true});
  card.addEventListener("touchend", () => {
    isDragging = false; card.classList.remove("swiping");
    if(currentX > 80) animateAway(1);
    else if(currentX < -80) animateAway(-1);
    else { card.style.transform=''; card.querySelectorAll(".swipe-overlay").forEach(o=>o.style.opacity=0); }
    currentX = 0;
  });
}
function animateAway(dir){
  if(!cardEl) return;
  cardEl.style.transition = "transform 0.35s ease";
  cardEl.style.transform = `translateX(${dir*500}px) rotate(${dir*20}deg)`;
  setTimeout(() => { if(dir>0) window.match(); else window.next(); }, 300);
}

// ---- HOME ----
window.render = () => {
  actualizarBadge();
  const card = document.getElementById("card");
  if(state.partidos.length === 0){
    card.innerHTML = `<div class="empty"><div class="empty-icon">⚽</div><div class="empty-text">No hay partidos disponibles.<br>¡Creá el primero!</div></div>`;
    return;
  }
  // Filtrar partidos propios, ya iniciados, llenos, o donde ya participás
  let ahora = Date.now();
  let partidosFiltrados = state.partidos.filter(p => {
    if(state.perfil && p.creador === state.perfil.nombre) return false;
    if(p.inicioTimestamp && ahora >= p.inicioTimestamp) return false;
    if(state.perfil && (p.solicitudes||[]).some(s => s.nombre === state.perfil.nombre)) return false;
    if(state.perfil && (p.confirmados||[]).some(c => nombreDeConfirmado(c) === state.perfil.nombre)) return false;
    if(p.jugadores >= p.max) return false; // partido lleno
    if(!partidoPasaFiltros(p)) return false;
    return true;
  });
  if(partidosFiltrados.length === 0){
    let hayFiltrosActivos = filtros.tipo || filtros.zona || filtros.distancia || filtros.precio || filtros.fecha || filtros.horaDesde;
    card.innerHTML = hayFiltrosActivos
      ? `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">No hay partidos que cumplan tus filtros.<br><span onclick="resetFiltros()" style="color:var(--green);text-decoration:underline;cursor:pointer;">Limpiar filtros</span></div></div>`
      : `<div class="empty"><div class="empty-icon">⚽</div><div class="empty-text">No hay partidos disponibles.<br>¡Creá el primero!</div></div>`;
    return;
  }
  if(state.idx >= partidosFiltrados.length) state.idx = 0;
  let p = partidosFiltrados[state.idx];
  let fill = Math.round((p.jugadores / p.max) * 100);
  let esCreador = state.perfil && p.creador === state.perfil.nombre;
  let confirmado = state.perfil && p.confirmados && p.confirmados.some(c => nombreDeConfirmado(c) === state.perfil.nombre);
  card.innerHTML = `
    <div class="partido-card" style="position:relative;">
      <div class="swipe-overlay yes">QUIERO ✅</div>
      <div class="swipe-overlay no">❌ PASO</div>
      <div class="card-img">
        <div class="card-img-bg" style="background-image:url('${p.canchaFoto||'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600'}')"></div>
        <div class="card-img-overlay">
          <div class="card-cancha-name" onclick="toggleDist()">${p.cancha}</div>
        </div>
        <div class="distance-popup" id="distPopup">
          ${(state.userLat&&state.userLng&&p.canchaLat)?`📍 ${calcularDistancia(state.userLat,state.userLng,p.canchaLat,p.canchaLng)} km`:'📍 Ubicación no disponible'}
        </div>
      </div>
      <div class="card-body">
        <div class="card-row">
          ${p.fecha?`<div class="card-tag">📅 <span>${p.fecha}</span></div>`:''}
          <div class="card-tag">🕓 <span>${p.hora}</span></div>
          <div class="card-tag">⏱️ <span>${p.duracion||'1h'}</span></div>
          <div class="card-tag">⚽ <span>Fútbol ${p.tipo}</span></div>
        </div>
        <div class="jugadores-bar">
          <div class="jugadores-label"><span>👥 Jugadores</span><span>${p.jugadores}/${p.max}</span></div>
          <div class="bar-bg"><div class="bar-fill" style="width:${fill}%"></div></div>
        </div>
        <div class="card-row">
          <div class="card-tag">💰 <span>$${p.precio||0} / persona</span></div>
          ${p.canchaDireccion?`<div class="card-tag" style="font-size:11px;">📍 <span>${p.canchaDireccion}</span></div>`:''}
        </div>
        <div class="creador-row" onclick="abrirPerfilJugador('${p.creadorUid}','${p.creador}')">
          <div class="creador-avatar">${p.creador?p.creador[0].toUpperCase():'?'}</div>
          <div class="creador-info">
            <div class="creador-nombre">👨‍🔧 ${p.creador}</div>
            <div class="creador-sub"><span class="stars">★★★★★</span> 4.8 · Creador</div>
          </div>
          <span style="color:var(--text-muted)">›</span>
        </div>
        <div class="card-actions">
          <button class="action-btn btn-no" onclick="next()">❌ Paso</button>
          <button class="action-btn btn-yes" onclick="match()">✅ Quiero</button>
        </div>
        ${(esCreador||confirmado)?`<button onclick="abrirChatIdx(${state.idx})" style="width:100%;margin-top:10px;padding:12px;background:var(--surface2);border:1px solid #333;border-radius:var(--radius-sm);color:var(--text);font-family:'DM Sans',sans-serif;font-size:14px;cursor:pointer;">💬 Ir al chat</button>`:''}
      </div>
    </div>`;
  initSwipe();
};

window.toggleDist = () => document.getElementById("distPopup").classList.toggle("show");
window.next = () => {
  let ahora = Date.now();
  let filtrados = state.partidos.filter(p => {
    if(state.perfil && p.creador === state.perfil.nombre) return false;
    if(p.inicioTimestamp && ahora >= p.inicioTimestamp) return false;
    if(state.perfil && (p.solicitudes||[]).some(s => s.nombre === state.perfil.nombre)) return false;
    if(state.perfil && (p.confirmados||[]).some(c => nombreDeConfirmado(c) === state.perfil.nombre)) return false;
    if(p.jugadores >= p.max) return false;
    return true;
  });
  state.idx = (state.idx+1) % Math.max(filtrados.length, 1);
  render();
};

window.match = async () => {
  if(!state.perfil) return;
  let ahora = Date.now();
  let filtrados = state.partidos.filter(p => {
    if(p.creador === state.perfil.nombre) return false;
    if(p.inicioTimestamp && ahora >= p.inicioTimestamp) return false;
    if((p.solicitudes||[]).some(s => s.nombre === state.perfil.nombre)) return false;
    if((p.confirmados||[]).some(c => nombreDeConfirmado(c) === state.perfil.nombre)) return false;
    if(p.jugadores >= p.max) return false;
    return true;
  });
  let p = filtrados[state.idx];
  if(p.creador === state.perfil.nombre){ alert("Este partido es tuyo"); return; }
  if((p.solicitudes||[]).some(s => s.nombre === state.perfil.nombre)){ alert("Ya mandaste solicitud"); return; }
  if((p.confirmados||[]).some(c => nombreDeConfirmado(c) === state.perfil.nombre)){ alert("Ya estás confirmado"); return; }

  let nuevasSolicitudes = [...(p.solicitudes||[]), {...state.perfil, uid: state.usuario.uid}];
  await updateDoc(doc(db, "partidos", p.id), { solicitudes: nuevasSolicitudes });

  // Notificación al creador en Firebase
  await addDoc(collection(db, "usuarios", p.creadorUid, "notificaciones"), {
    tipo: "solicitud",
    texto: `${state.perfil.nombre} quiere unirse a ${p.cancha}`,
    partidoId: p.id,
    visto: false,
    creadoEn: serverTimestamp()
  });

  render();
  alert("¡Solicitud enviada! ✅");
};


export { startX, isDragging, cardEl, currentX, initSwipe, animateAway };
