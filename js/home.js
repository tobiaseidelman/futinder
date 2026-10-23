import { fechaPartido } from './navigation.js';
import { runTransaction, getDoc, doc, db, updateDoc, addDoc, collection, serverTimestamp } from './firebase.js';
import { actualizarBadge } from './notifications.js';
import { state } from './state.js';
import { nombreDeConfirmado, getEstadoPartido } from './matches.js';
import { partidoPasaFiltros, filtros } from './filters.js';
import { calcularDistancia } from './location.js';

let solicitudAbiertaId = null;
let partidoCompartidoId = null;
window.mostrarTarjetaCompartida = id => {
  solicitudAbiertaId = null;
  partidoCompartidoId = id;
  window.cambiarPantalla('home');
  window.render();
};
function accionesCompartidas(p){
  if(getEstadoPartido(p) !== 'activo') return '<p style="color:var(--text-muted);text-align:center;">Este partido ya empezó o finalizó.</p>';
  if((p.solicitudes||[]).some(s=>s.uid===state.usuario?.uid)) return '<button class="action-btn btn-no" data-id="'+textoTarjeta(p.id)+'" onclick="abrirSolicitudPendiente(this.dataset.id)">Ver mi solicitud</button>';
  if(Number(p.jugadores)>=Number(p.max)) return '<p style="color:var(--text-muted);text-align:center;">Este partido está completo.</p>';
  return '<button class="action-btn btn-yes" style="width:100%;" data-id="'+textoTarjeta(p.id)+'" onclick="match(this.dataset.id)">Quiero jugar</button>';
}
window.limpiarTarjetaPendiente = () => { solicitudAbiertaId = null; partidoCompartidoId = null; };
window.volverAPendientes = () => {
  solicitudAbiertaId = null;
  window.verMisPartidos();
  window.switchTab('pendientes');
};
window.abrirSolicitudPendiente = partidoId => {
  partidoCompartidoId = null;
  solicitudAbiertaId = partidoId;
  window.cambiarPantalla('home');
  window.render();
};
window.cancelarSolicitudTarjeta = async boton => {
  const id = solicitudAbiertaId;
  if(!id) return;
  boton.disabled = true;
  boton.textContent = 'Cancelando…';
  const cancelada = await window.retirarSolicitud(id);
  if(cancelada && solicitudAbiertaId === id) window.volverAPendientes();
  else if(solicitudAbiertaId === id) window.render();
};
let canchaDistActual = null;
let ubicacionPendiente = false;
let ultimaConsultaRuta = 0;
const rutasAuto = new Map();

function claveRutaAuto(){
  const p = canchaDistActual;
  if(!p || ![state.userLat,state.userLng,p.canchaLat,p.canchaLng].every(v=>typeof v === 'number' && Number.isFinite(v))) return null;
  // Aproximar el origen a unos 100 m; no enviar el punto GPS exacto.
  return `${state.userLng.toFixed(3)},${state.userLat.toFixed(3)};${p.canchaLng},${p.canchaLat}`;
}
async function actualizarTiempoAuto(){
  const clave = claveRutaAuto();
  if(!state.rutasPermitidas || !clave) return;
  const anterior = rutasAuto.get(clave);
  if(anterior && Date.now() - anterior.fecha < (anterior.error ? 30000 : 300000)){
    if(anterior.promesa) await anterior.promesa;
    if(claveRutaAuto() === clave) pintarTiempoAuto(clave);
    return;
  }
  if(Date.now() - ultimaConsultaRuta < 1100) return;
  ultimaConsultaRuta = Date.now();
  const entrada = {fecha:Date.now(), texto:'Calculando recorrido en auto…'};
  rutasAuto.set(clave, entrada);
  if(rutasAuto.size > 30) rutasAuto.delete(rutasAuto.keys().next().value);
  pintarTiempoAuto(clave);
  entrada.promesa = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),8000);
    try {
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${clave}?overview=false&steps=false&alternatives=false&generate_hints=false`, {signal:controller.signal,credentials:'omit',referrerPolicy:'origin'});
      if(!response.ok) throw new Error('Ruta no disponible');
      const data = await response.json();
      const ruta = data.routes?.[0];
      if(data.code !== 'Ok' || !ruta || !Number.isFinite(ruta.duration) || !Number.isFinite(ruta.distance) || ruta.duration < 0 || ruta.distance < 0) throw new Error('Sin ruta');
      const min = Math.max(1,Math.ceil(ruta.duration / 60));
      entrada.texto = `🚗 ${min} min · ${(ruta.distance / 1000).toLocaleString('es-UY',{maximumFractionDigits:1})} km. Tiempo estimado.`;
    } catch(e){
      entrada.error = true;
      entrada.texto = 'No pudimos calcular el tiempo en auto. Podés reintentar en unos segundos.';
    } finally { clearTimeout(timeout); }
  })();
  await entrada.promesa;
  if(claveRutaAuto() === clave) pintarTiempoAuto(clave);
}
function pintarTiempoAuto(clave){
  const popup = document.getElementById('distPopup');
  const entrada = rutasAuto.get(clave);
  if(popup && entrada) popup.textContent = entrada.error ? `${textoDistancia()} · ${entrada.texto}` : entrada.texto;
}
window.calcularTiempoAuto = async () => {
  if(!state.rutasPermitidas) return;
  if(!claveRutaAuto()){ toggleDist(); return; }
  mostrarDistancia();
  await actualizarTiempoAuto();
};

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
function fechaTarjeta(fecha){ return fechaPartido(fecha); }

async function cargarCreadorTarjeta(p){
  if(!p.creadorUid) return;
  try {
    const snap = await getDoc(doc(db, 'usuarios', p.creadorUid));
    const target = document.getElementById('cardCreatorRating');
    if(!target || target.dataset.partido !== p.id || !snap.exists()) return;
    const datos = snap.data();
    const total = Number(datos.calificacionesRecibidas) || 0;
    const rating = Number(datos.rating);
    const tieneOpiniones = total > 0 && Number.isFinite(rating) && rating >= 1 && rating <= 5;
    const puntuacion = tieneOpiniones ? rating : 0;
    const estrellas = document.createElement('span');
    estrellas.setAttribute('aria-hidden', 'true');
    estrellas.style.cssText = 'display:inline-flex;gap:2px;vertical-align:baseline;margin-right:6px';
    for(let i = 0; i < 5; i++){
      const estrella = document.createElement('span');
      const relleno = Math.round(Math.max(0, Math.min(1, puntuacion - i)) * 100);
      estrella.textContent = '★';
      estrella.style.cssText = 'color:#555;position:relative;display:inline-block';
      const color = document.createElement('span');
      color.textContent = '★';
      color.style.cssText = 'position:absolute;left:0;top:0;overflow:hidden;white-space:nowrap;color:var(--green);width:' + relleno + '%';
      estrella.append(color);
      estrellas.append(estrella);
    }
    const detalle = tieneOpiniones
      ? puntuacion.toLocaleString('es-UY', {minimumFractionDigits:1, maximumFractionDigits:1}) + ' (' + total + ')'
      : 'Sin opiniones';
    target.setAttribute('aria-label', tieneOpiniones ? detalle + ' · puntuación sobre 5' : 'Sin opiniones');
    target.replaceChildren(estrellas, document.createTextNode(detalle));
    const avatar = document.getElementById('cardCreatorAvatar');
    if(avatar && typeof datos.foto === 'string' && (/^https?:\/\//.test(datos.foto) || /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(datos.foto))){
      const img = document.createElement('img');
      img.src = datos.foto;
      img.alt = 'Foto de ' + (p.creador || 'jugador');
      window.prepararFotoAmpliable(img);
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
  const pendiente = solicitudAbiertaId !== null;
  const compartido = partidoCompartidoId !== null;
  const hint = document.querySelector('#home .swipe-hint');
  if(hint) hint.hidden = pendiente || compartido;
  if(hint) hint.style.display = (pendiente || compartido) ? 'none' : '';
  let solicitud = pendiente ? state.partidos.find(p => p.id === solicitudAbiertaId) : null;
  if(pendiente && (!solicitud || getEstadoPartido(solicitud) !== 'activo' || !(solicitud.solicitudes || []).some(s => s.uid === state.usuario?.uid) ||
      (solicitud.confirmados || []).some(c => c.uid === state.usuario?.uid))){
    window.volverAPendientes();
    return;
  }
  if(compartido && !state.partidos.some(p=>p.id===partidoCompartidoId)){
    card.innerHTML = '<div class="empty"><div class="empty-text">Este partido ya no está disponible.</div><button class="submit-btn" onclick="irHome()">Ver otros partidos</button></div>';
    return;
  }
  if(state.partidos.length === 0){
    card.innerHTML = `<div class="empty"><div class="empty-icon">⚽</div><div class="empty-text">No hay partidos disponibles.<br>¡Creá el primero!</div></div>`;
    return;
  }
  // Filtrar partidos propios, ya iniciados, llenos, o donde ya participás
  let ahora = Date.now();
  let partidosFiltrados = state.partidos.filter(p => {
    if(state.perfil && p.creador === state.perfil.nombre) return false;
    if(getEstadoPartido(p) !== 'activo') return false;
    if(state.perfil && (p.solicitudes||[]).some(s => s.nombre === state.perfil.nombre)) return false;
    if(state.perfil && (p.confirmados||[]).some(c => nombreDeConfirmado(c) === state.perfil.nombre)) return false;
    if(p.jugadores >= p.max) return false; // partido lleno
    if(!partidoPasaFiltros(p)) return false;
    return true;
  });
  if(!pendiente && !compartido && partidosFiltrados.length === 0){
    let hayFiltrosActivos = filtros.tipo || filtros.zona || filtros.distancia || filtros.precio || filtros.fecha || filtros.horaDesde;
    card.innerHTML = hayFiltrosActivos
      ? `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">No hay partidos que cumplan tus filtros.<br><span onclick="resetFiltros()" style="color:var(--green);text-decoration:underline;cursor:pointer;">Limpiar filtros</span></div></div>`
      : `<div class="empty"><div class="empty-icon">⚽</div><div class="empty-text">No hay partidos disponibles.<br>¡Creá el primero!</div></div>`;
    return;
  }
  if(!pendiente && !compartido && state.idx >= partidosFiltrados.length) state.idx = 0;
  let p = compartido ? state.partidos.find(p=>p.id===partidoCompartidoId) : pendiente ? solicitud : partidosFiltrados[state.idx];
  let fill = Math.round((p.jugadores / p.max) * 100);
  let esCreador = state.perfil && p.creador === state.perfil.nombre;
  let confirmado = state.perfil && p.confirmados && p.confirmados.some(c => nombreDeConfirmado(c) === state.perfil.nombre);
  canchaDistActual = p;
  const faltan = Math.max(0, p.max - p.jugadores);
  const tieneUbicacion = [state.userLat, state.userLng, p.canchaLat, p.canchaLng].every(v => typeof v === 'number' && Number.isFinite(v));
  card.innerHTML = `
    ${pendiente ? '<button class="back-btn" style="width:auto;margin-bottom:10px;font-size:14px;" onclick="volverAPendientes()">← Volver a pendientes</button>' : ''}
    ${compartido ? '<button class="back-btn" style="width:auto;margin-bottom:10px;font-size:14px;" onclick="irHome()">← Ver otros partidos</button>' : ''}
    <div class="partido-card" style="position:relative;">
      <div class="swipe-overlay yes">QUIERO ✅</div>
      <div class="swipe-overlay no">❌ PASO</div>
      <div class="card-img">
        <div class="card-img-bg" style="background-image:url('${p.canchaFoto||'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600'}')"></div>
        <div class="card-img-overlay">
          <div class="card-cancha-name" id="canchaLocationBtn" role="button" tabindex="0" aria-expanded="false" aria-controls="distPopup" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDist();}" onclick="toggleDist()">${p.cancha}</div>
        </div>
      </div>
      <div class="card-body">
        <div class="match-details">
          <div class="match-schedule"><span class="match-date">${textoTarjeta(fechaTarjeta(p.fecha))}</span><strong class="match-hour">${textoTarjeta(p.hora || 'A confirmar')}</strong></div>
          <div class="match-cost"><strong>$${textoTarjeta(p.precio || 0)}</strong><span>por persona · UYU</span></div>
        </div>
        <div class="match-format"><span>Fútbol ${textoTarjeta(p.tipo)}</span><span class="format-dot" aria-hidden="true">·</span><span>${textoTarjeta(p.duracion || '1h')} de juego</span></div>
        <div class="jugadores-bar">
          <div class="jugadores-label"><span>👥 Jugadores</span><span>${p.jugadores}/${p.max}</span></div>
          <div class="bar-bg"><div class="bar-fill" style="width:${fill}%"></div></div>
        </div>
        <div class="match-location" onmouseenter="mostrarDistancia()" onmouseleave="ocultarDistancia()" onfocusin="mostrarDistancia()" onfocusout="ocultarDistancia()">
          <button class="location-trigger" id="direccionLocationBtn" type="button" onclick="verDistanciaDireccion()" aria-expanded="false" aria-controls="distPopup">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
            <span>${textoTarjeta(p.canchaDireccion || 'Ver ubicación de la cancha')}</span><span aria-hidden="true">›</span>
          </button>
          <div class="distance-popup" id="distPopup" role="status" aria-live="polite"></div>
        </div>
        <div class="creador-row" onclick="abrirPerfilJugador('${p.creadorUid}','${p.creador}')">
          <div class="creador-avatar" id="cardCreatorAvatar">${p.creador?p.creador[0].toUpperCase():'?'}</div>
          <div class="creador-info">
            <div class="creador-nombre">👨‍🔧 ${p.creador}</div>
            <div class="creador-sub" id="cardCreatorRating" data-partido="${textoTarjeta(p.id)}">Creador</div>
          </div>
          <span style="color:var(--text-muted)">›</span>
        </div>
        <button class="social-share-link" data-id="${textoTarjeta(p.id)}" onclick="compartirPartido(this.dataset.id)">↗ Compartir partido</button>
        <div class="card-actions">
${compartido ? accionesCompartidas(p) : pendiente
            ? '<button class="action-btn btn-no" style="width:100%;font-size:16px;" onclick="cancelarSolicitudTarjeta(this)">Cancelar solicitud</button>'
            : '<button class="action-btn btn-no" onclick="next()">❌ Paso</button><button class="action-btn btn-yes" onclick="match()">✅ Quiero</button>'}
        </div>
        ${(esCreador||confirmado)?`<button onclick="abrirChatIdx(${state.idx})" style="width:100%;margin-top:10px;padding:12px;background:var(--surface2);border:1px solid #333;border-radius:var(--radius-sm);color:var(--text);font-family:'DM Sans',sans-serif;font-size:14px;cursor:pointer;">💬 Ir al chat</button>`:''}
      </div>
    </div>`;
  if(!pendiente && !compartido) initSwipe();
  cargarCreadorTarjeta(p);
};

function textoDistancia(){
  const p = canchaDistActual;
  if(!p || ![p.canchaLat,p.canchaLng].every(v => typeof v === 'number' && Number.isFinite(v))) return 'Esta cancha todavía no tiene coordenadas.';
  if([state.userLat,state.userLng].every(v => typeof v === 'number' && Number.isFinite(v))) return `${calcularDistancia(state.userLat,state.userLng,p.canchaLat,p.canchaLng)} km desde tu ubicación · en línea recta`;
  return ubicacionPendiente ? 'Buscando tu ubicación…' : 'Tocá la dirección y permití tu ubicación para ver la distancia.';
}
window.mostrarDistancia = () => {
  const popup = document.getElementById('distPopup');
  if(!popup) return;
  popup.textContent = textoDistancia();
  popup.classList.add('show');
  if(state.rutasPermitidas) void actualizarTiempoAuto();
  for(const id of ['canchaLocationBtn','direccionLocationBtn']) document.getElementById(id)?.setAttribute('aria-expanded','true');
};
window.ocultarDistancia = () => {
  document.getElementById('distPopup')?.classList.remove('show');
  for(const id of ['canchaLocationBtn','direccionLocationBtn']) document.getElementById(id)?.setAttribute('aria-expanded','false');
};
window.verDistanciaDireccion = () => {
  if([state.userLat,state.userLng].every(v => typeof v === 'number' && Number.isFinite(v))) mostrarDistancia();
  else toggleDist();
};
window.toggleDist = () => {
  const popup = document.getElementById('distPopup');
  if(!popup) return;
  const faltaUbicacion = ![state.userLat,state.userLng].every(v => typeof v === 'number' && Number.isFinite(v));
  if(faltaUbicacion && canchaDistActual && [canchaDistActual.canchaLat,canchaDistActual.canchaLng].every(v=>typeof v === 'number' && Number.isFinite(v))){
    mostrarDistancia();
    if(ubicacionPendiente) return;
    if(!navigator.geolocation){ popup.textContent = 'Tu navegador no permite consultar la ubicación.'; return; }
    ubicacionPendiente = true;
    popup.textContent = textoDistancia();
    navigator.geolocation.getCurrentPosition(pos => {
      ubicacionPendiente = false;
      state.userLat = pos.coords.latitude; state.userLng = pos.coords.longitude;
      const actual = document.getElementById('distPopup');
      if(actual) actual.textContent = textoDistancia();
      if(state.rutasPermitidas) void actualizarTiempoAuto();
    }, error => {
      ubicacionPendiente = false;
      const actual = document.getElementById('distPopup');
      if(actual) actual.textContent = error.code === 1 ? 'Ubicación bloqueada. Permitila en los ajustes del navegador para ver la distancia.' : 'No pudimos obtener tu ubicación. Tocá la dirección para reintentar.';
    }, {enableHighAccuracy:false,timeout:10000,maximumAge:300000});
    return;
  }
  if(popup.classList.contains('show')) ocultarDistancia(); else mostrarDistancia();
};
window.next = () => {
  let ahora = Date.now();
  let filtrados = state.partidos.filter(p => {
    if(state.perfil && p.creador === state.perfil.nombre) return false;
    if(getEstadoPartido(p) !== 'activo') return false;
    if(state.perfil && (p.solicitudes||[]).some(s => s.nombre === state.perfil.nombre)) return false;
    if(state.perfil && (p.confirmados||[]).some(c => nombreDeConfirmado(c) === state.perfil.nombre)) return false;
    if(p.jugadores >= p.max) return false;
    if(!partidoPasaFiltros(p)) return false;
    return true;
  });
  state.idx = (state.idx+1) % Math.max(filtrados.length, 1);
  render();
};

let enviandoSolicitud = false;
window.match = async (partidoId = null) => {
  if(enviandoSolicitud) return;
  if(!state.perfil) return;
  let ahora = Date.now();
  let filtrados = state.partidos.filter(p => {
    if(p.creador === state.perfil.nombre) return false;
    if(getEstadoPartido(p) !== 'activo') return false;
    if((p.solicitudes||[]).some(s => s.nombre === state.perfil.nombre)) return false;
    if((p.confirmados||[]).some(c => nombreDeConfirmado(c) === state.perfil.nombre)) return false;
    if(p.jugadores >= p.max) return false;
    if(!partidoPasaFiltros(p)) return false;
    return true;
  });
  let p = partidoId ? state.partidos.find(p=>p.id===partidoId) : filtrados[state.idx];
  if(!p){ render(); return; }
  if(p.creador === state.perfil.nombre){ window.mostrarAviso("Este partido es tuyo"); return; }
  if((p.solicitudes||[]).some(s => s.nombre === state.perfil.nombre)){ window.mostrarAviso("Ya mandaste solicitud"); return; }
  if((p.confirmados||[]).some(c => nombreDeConfirmado(c) === state.perfil.nombre)){ window.mostrarAviso("Ya estás confirmado"); return; }

  enviandoSolicitud = true;
  try {
  // Las imágenes se consultan por UID; no duplicarlas dentro de cada partido.
  const { foto, portada, portadaY, jugadas, ...perfilSolicitud } = state.perfil;
  const uid = state.usuario.uid;
  await runTransaction(db, async tx => {
    const ref = doc(db,'partidos',p.id), snap = await tx.get(ref);
    if(!snap.exists()) throw new Error('El partido ya no está disponible.');
    const actual = snap.data();
    if(getEstadoPartido(actual) !== 'activo') throw new Error('El partido ya empezó. No podés enviar una solicitud.');
    if((actual.versionHorario||0) !== (p.versionHorario||0)) throw new Error('Cambió el horario. Revisá la tarjeta antes de unirte.');
    if(Number(actual.jugadores) >= Number(actual.max)) throw new Error('El partido ya está completo.');
    if((actual.solicitudes||[]).some(s=>s.uid===uid) || (actual.confirmados||[]).some(c=>c.uid===uid)) throw new Error('Ya tenés una solicitud o un lugar en este partido.');
    tx.update(ref,{solicitudes:[...(actual.solicitudes||[]),{...perfilSolicitud,uid}]});
    tx.set(doc(db,'usuarios',actual.creadorUid,'notificaciones',p.id+'_solicitud_'+uid),{
      tipo:'solicitud',solicitanteUid:uid,texto:perfilSolicitud.nombre+' quiere unirse a '+actual.cancha,
      partidoId:p.id,visto:false,creadoEn:serverTimestamp()
    });
  });

  window.mostrarAviso("Solicitud enviada", "success");
  render();
  } catch(e) {
    window.mostrarAviso(e.message || "No se pudo enviar. Intentá de nuevo.", "error");
  } finally {
    enviandoSolicitud = false;
  }
};


export { startX, isDragging, cardEl, currentX, initSwipe, animateAway, textoTarjeta, fechaTarjeta, cargarCreadorTarjeta };
