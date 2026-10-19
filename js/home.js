import { getDoc, doc, db, updateDoc, addDoc, collection, serverTimestamp } from './firebase.js';
import { actualizarBadge } from './notifications.js';
import { state } from './state.js';
import { nombreDeConfirmado } from './matches.js';
import { partidoPasaFiltros, filtros } from './filters.js';
import { calcularDistancia } from './location.js';

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
// Texto seguro para la tarjeta y fecha legible sin cambiar el día por zona horaria.
function textoTarjeta(value){
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fechaTarjeta(fecha){
  if(!fecha) return 'Fecha a confirmar';
  const fechaLocal = new Date(fecha + 'T12:00:00');
  return Number.isNaN(fechaLocal.getTime()) ? fecha : fechaLocal.toLocaleDateString('es-UY', {weekday:'short', day:'numeric', month:'short'});
}
async function cargarCreadorTarjeta(p){
  if(!p.creadorUid) return;
  try {
    const snap = await getDoc(doc(db, 'usuarios', p.creadorUid));
    const target = document.getElementById('cardCreatorRating');
    if(!target || target.dataset.partido !== p.id || !snap.exists()) return;
    const datos = snap.data();
    const total = Number(datos.calificacionesRecibidas) || 0;
    const rating = Number(datos.rating);
    target.textContent = total > 0 && Number.isFinite(rating) ? `★ ${rating.toFixed(1)} (${total})` : 'Sin opiniones';
    const avatar = document.getElementById('cardCreatorAvatar');
    if(avatar && typeof datos.foto === 'string' && (/^https?:\/\//.test(datos.foto) || /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(datos.foto))){
      const img = document.createElement('img');
      img.src = datos.foto;
      img.alt = '';
      img.onerror = () => { avatar.textContent = (p.creador || '?')[0].toUpperCase(); };
      avatar.replaceChildren(img);
    }
  } catch(e) {
    const target = document.getElementById('cardCreatorRating');
    if(target && target.dataset.partido === p.id) target.textContent = 'Ver perfil';
  }
}


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
  const faltan = Math.max(0, p.max - p.jugadores);
  const tieneUbicacion = [state.userLat, state.userLng, p.canchaLat, p.canchaLng].every(v => typeof v === 'number' && Number.isFinite(v));
  card.innerHTML = `
    <div class="partido-card">
      <div class="swipe-overlay yes">QUIERO JUGAR</div>
      <div class="swipe-overlay no">PASO</div>
      <div class="card-img">
        <div class="card-img-bg" style="background-image:url('${p.canchaFoto||'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600'}')"></div>
        <div class="card-img-overlay">
          <button class="card-cancha-name" id="canchaLocationBtn" onclick="toggleDist()" aria-expanded="false" aria-controls="distPopup">
            <span class="cancha-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>${textoTarjeta(p.cancha)}</span>
            <span class="cancha-location-hint">Ver dirección y distancia ›</span>
          </button>
        </div>
        <div class="distance-popup" id="distPopup" role="region" aria-label="Ubicación de la cancha">
          <span>${textoTarjeta(p.canchaDireccion || 'Dirección no disponible')}</span>
          ${tieneUbicacion ? `<span class="distance-value">A ${calcularDistancia(state.userLat,state.userLng,p.canchaLat,p.canchaLng)} km de vos · en línea recta</span>` : ''}
        </div>
      </div>
      <div class="card-body">
        <div class="match-summary">
          <div><div class="match-date">${textoTarjeta(fechaTarjeta(p.fecha))}</div><div class="match-time">${textoTarjeta(p.hora)}</div></div>
          <div class="match-price"><strong>$${textoTarjeta(p.precio || 0)}</strong><small>UYU · por persona</small></div>
        </div>
        <div class="match-meta"><span>Fútbol ${textoTarjeta(p.tipo)}</span><span>${textoTarjeta(p.duracion || '1h')}</span></div>
        <div class="jugadores-bar">
          <div class="jugadores-label"><span class="spots-left">${faltan === 1 ? 'Falta 1 jugador' : `Faltan ${faltan} jugadores`}</span><span class="spots-total">${p.jugadores} de ${p.max} cupos</span></div>
          <div class="bar-bg"><div class="bar-fill" style="width:${fill}%"></div></div>
        </div>
        <div class="creador-row" role="button" tabindex="0" onclick="abrirPerfilJugador(${textoTarjeta(JSON.stringify(p.creadorUid || ''))},${textoTarjeta(JSON.stringify(p.creador || ''))})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click();}">
          <div class="creador-avatar" id="cardCreatorAvatar">${textoTarjeta((p.creador || '?')[0].toUpperCase())}</div>
          <div class="creador-info"><div class="creador-nombre">${textoTarjeta(p.creador)}</div><div class="creador-sub">Organiza el partido</div></div>
          <span class="creator-rating" id="cardCreatorRating" data-partido="${textoTarjeta(p.id)}">Ver perfil</span>
          <span aria-hidden="true" style="color:var(--text-muted)">›</span>
        </div>
        <div class="card-actions">
          <button class="action-btn btn-no" onclick="next()"><span class="action-symbol" aria-hidden="true">×</span> Paso</button>
          <button class="action-btn btn-yes" onclick="match()"><span class="action-symbol" aria-hidden="true">✓</span> Quiero jugar</button>
        </div>
      </div>
    </div>`;
  initSwipe();
  cargarCreadorTarjeta(p);
};

window.toggleDist = () => {
  const popup = document.getElementById('distPopup');
  popup.classList.toggle('show');
  document.getElementById('canchaLocationBtn')?.setAttribute('aria-expanded', String(popup.classList.contains('show')));
};
window.next = () => {
  let ahora = Date.now();
  let filtrados = state.partidos.filter(p => {
    if(state.perfil && p.creador === state.perfil.nombre) return false;
    if(p.inicioTimestamp && ahora >= p.inicioTimestamp) return false;
    if(state.perfil && (p.solicitudes||[]).some(s => s.nombre === state.perfil.nombre)) return false;
    if(state.perfil && (p.confirmados||[]).some(c => nombreDeConfirmado(c) === state.perfil.nombre)) return false;
    if(p.jugadores >= p.max) return false;
    if(!partidoPasaFiltros(p)) return false;
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
    if(!partidoPasaFiltros(p)) return false;
    return true;
  });
  let p = filtrados[state.idx];
  if(!p){ render(); return; }
  if(p.creador === state.perfil.nombre){ alert("Este partido es tuyo"); return; }
  if((p.solicitudes||[]).some(s => s.nombre === state.perfil.nombre)){ alert("Ya mandaste solicitud"); return; }
  if((p.confirmados||[]).some(c => nombreDeConfirmado(c) === state.perfil.nombre)){ alert("Ya estás confirmado"); return; }

  // Las imágenes se consultan por UID; no duplicarlas dentro de cada partido.
  const { foto, jugadas, ...perfilSolicitud } = state.perfil;
  let nuevasSolicitudes = [...(p.solicitudes||[]), {...perfilSolicitud, uid: state.usuario.uid}];
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


export { startX, isDragging, cardEl, currentX, initSwipe, animateAway, textoTarjeta, fechaTarjeta, cargarCreadorTarjeta };
