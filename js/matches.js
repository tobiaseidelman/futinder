import { fechaPartido, confirmarAccion } from './navigation.js';
import { state } from './state.js';
import { runTransaction, getDoc, query, collection, db, orderBy, onSnapshot, updateDoc, doc, addDoc, serverTimestamp, increment, arrayUnion, deleteDoc } from './firebase.js';
import { pedirUbicacion } from './location.js';
import { esAdmin } from './admin.js';

// ---- ESCUCHAR PARTIDOS EN TIEMPO REAL ----
function iniciarPartidos(){
  if(state.partidosUnsub) state.partidosUnsub();
  const q = query(collection(db, "partidos"), orderBy("creadoEn", "desc"));
  state.partidosUnsub = onSnapshot(q, (snap) => {
    const abiertoId = state.partidos[state.idx]?.id;
    state.partidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if(document.getElementById("home").classList.contains("active")) render();
    if(document.getElementById("misPartidos").classList.contains("active")) renderTabPartidos();
    const abiertoIdx = state.partidos.findIndex(p => p.id === abiertoId);
    if(abiertoIdx >= 0){
      if(document.getElementById('creador').classList.contains('active')) verDetalle(abiertoIdx);
      if(document.getElementById('infoPartido').classList.contains('active')) verInfoPartido(abiertoIdx);
    }
    chequearPartidosFinalizados();
  });
}

// ---- DETECTAR PARTIDOS RECIÉN FINALIZADOS: notificar a confirmados y sumar partido jugado ----
// No hay backend corriendo solo (plan gratis de Firebase), así que esto se dispara
// cuando cualquier usuario con la app abierta detecta un partido recién finalizado.
// Se marca notifRatingEnviada:true para no mandar la notificación más de una vez.
async function chequearPartidosFinalizados(){
  for(let p of state.partidos){
    if(getEstadoPartido(p) !== 'finalizado') continue;
    if(p.notifRatingEnviada) continue;
    if(!(p.confirmados||[]).length) continue;

    try{
      await updateDoc(doc(db, "partidos", p.id), { notifRatingEnviada: true });
    }catch(e){ continue; } // otro cliente ya lo está procesando

    for(let c of p.confirmados){
      let uid = uidDeConfirmado(c);
      if(!uid || c.pendienteReconfirmar) continue; // No contar a quien no reconfirmó.
      try{
        await addDoc(collection(db, "usuarios", uid, "notificaciones"), {
          tipo: "calificar",
          texto: `El partido en ${p.cancha} terminó. ¡Calificá a tus compañeros!`,
          partidoId: p.id,
          visto: false,
          creadoEn: serverTimestamp()
        });
        await updateDoc(doc(db, "usuarios", uid), { partidos: increment(1) });
      }catch(e){ /* seguir con el resto aunque falle uno */ }
    }
  }
}

// ---- CREAR PARTIDO ----
window.selTipo = (btn, t) => { state.tipoSel=t; btn.parentElement.querySelectorAll(".tipo-btn").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); };

// Init crear screen
const origCambiarPantalla = window.cambiarPantalla;
window.cambiarPantalla = (id) => {
  origCambiarPantalla(id);
  if(id === 'crear' && !creandoPartido){
    pedirUbicacion();
    state.canchaSeleccionada = null;
    state.tipoSel = '';
    document.querySelectorAll("#tipoCrear .tipo-btn").forEach(b => b.classList.remove("selected"));
    limpiarErroresCrear();
    const cg = document.getElementById("canchaGroup");
    if(cg) cg.style.display = "none";
    const hoyStr = hoyEnUruguay();
    const fi = document.getElementById("fecha");
    if(fi){ fi.min = hoyStr; if(!fi.value) fi.value = hoyStr; }
  }
};
window.selDur = (btn, d) => { state.durSel=d; btn.parentElement.querySelectorAll(".tipo-btn").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); };
window.selPos = (btn, p) => { state.posSel=p; btn.parentElement.querySelectorAll(".tipo-btn").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); };
window.selPosEdit = (btn, p) => { state.posEditSel=p; btn.parentElement.querySelectorAll(".tipo-btn").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); };


let creandoPartido = false;

function hoyEnUruguay(){
  const partes = new Intl.DateTimeFormat('en', {timeZone:'America/Montevideo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  return ['year','month','day'].map(tipo => partes.find(p => p.type === tipo).value).join('-');
}

function limpiarErroresCrear(contenedor = document.getElementById('crear')){
  contenedor.querySelectorAll('.error-crear').forEach(e => e.remove());
  contenedor.querySelectorAll('.campo-error').forEach(e => {
    e.classList.remove('campo-error');
    e.removeAttribute('aria-invalid');
    e.removeAttribute('aria-describedby');
  });
}

function validarNuevoPartido({tipo, cancha, fecha, hora, jugadores, precio, duracion}, ahora = Date.now()){
  const errores = {};
  const max = {'5':10,'7':14,'11':22}[tipo];
  if(!max) errores.tipoCrear = 'Elegí el tipo de fútbol.';
  else if(!cancha || cancha.tipo !== tipo) errores.canchaSelector = 'Elegí una cancha para el partido.';
  const inicio = new Date(fecha + 'T' + hora + ':00-03:00').getTime();
  const dia = new Date(fecha + 'T00:00:00Z').getTime();
  const fechaValida = /^\d{4}-\d{2}-\d{2}$/.test(fecha) &&
    Number.isFinite(dia) && new Date(dia).toISOString().slice(0,10) === fecha;
  if(!fechaValida) errores.fecha = 'Elegí una fecha válida.';
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) errores.hora = 'Elegí un horario válido.';
  if(fechaValida && !errores.hora && inicio <= ahora){
    const hoy = new Date(ahora - 3*3600000).toISOString().slice(0,10);
    errores[fecha < hoy ? 'fecha' : 'hora'] = 'El partido tiene que empezar en una fecha y hora futuras.';
  }
  const cantidad = Number(jugadores);
  if(!jugadores.trim() || !Number.isInteger(cantidad) || cantidad < 1 || cantidad >= (max || 22)){
    errores.jugadores = 'Ingresá entre 1 y ' + ((max || 22) - 1) + ' jugadores, incluyéndote. Tiene que quedar al menos un lugar libre.';
  }
  if(precio.trim() && (!Number.isFinite(Number(precio)) || Number(precio) < 0)){
    errores.precio = 'Ingresá un precio igual o mayor a 0.';
  }
  return {errores, inicio, max, cantidad, precio:Number(precio || 0), minutos:({'1h':60,'1:30h':90,'2h':120})[duracion] || 90};
}

const formularioCrear = document.querySelector('#crear .form-screen');
formularioCrear.addEventListener('input', e => {
  const grupo = e.target.closest('.form-group');
  if(grupo) limpiarErroresCrear(grupo);
});
formularioCrear.addEventListener('click', e => {
  const grupo = e.target.closest('.form-group');
  if(grupo && (e.target.closest('.tipo-btn') || e.target.closest('.cancha-item'))){
    limpiarErroresCrear(grupo);
    document.getElementById('jugadores').max = {'5':9,'7':13,'11':21}[state.tipoSel] || 21;
  }
});

window.crearPartido = async () => {
  if(creandoPartido) return;
  if(!state.usuario?.uid || !state.perfil){ window.mostrarAviso('Iniciá sesión para crear un partido.'); return; }
  limpiarErroresCrear();
  const datos = {
    tipo:state.tipoSel, cancha:state.canchaSeleccionada, duracion:state.durSel,
    fecha:document.getElementById('fecha').value,
    hora:document.getElementById('hora').value,
    jugadores:document.getElementById('jugadores').value,
    precio:document.getElementById('precio').value
  };
  const validacion = validarNuevoPartido(datos);
  const errores = Object.entries(validacion.errores);
  if(errores.length){
    for(const [id, mensaje] of errores){
      const campo = document.getElementById(id);
      const aviso = document.createElement('p');
      aviso.id = 'error-crear-' + id;
      aviso.className = 'error-crear';
      aviso.textContent = mensaje;
      campo.classList.add('campo-error');
      campo.setAttribute('aria-invalid','true');
      campo.setAttribute('aria-describedby',aviso.id);
      campo.after(aviso);
    }
    const primero = document.getElementById(errores[0][0]);
    primero.scrollIntoView({block:'center',behavior:'smooth'});
    (primero.matches('input') ? primero : primero.querySelector('button'))?.focus({preventScroll:true});
    window.mostrarAviso('Revisá los campos marcados.');
    return;
  }
  const uid = state.usuario.uid;
  const nombre = state.perfil.nombre;
  const boton = document.getElementById('btnCrearPartido');
  const controles = [...formularioCrear.querySelectorAll('input, button')].map(el => [el, el.disabled]);
  creandoPartido = true;
  controles.forEach(([el]) => { el.disabled = true; });
  boton.textContent = 'Creando…';
  formularioCrear.setAttribute('aria-busy','true');
  try {
    await addDoc(collection(db,'partidos'), {
      cancha:datos.cancha.nombre, canchaId:datos.cancha.id, canchaFoto:datos.cancha.foto,
      canchaDireccion:datos.cancha.direccion, canchaLat:datos.cancha.lat,
      canchaLng:datos.cancha.lng, canchaZona:datos.cancha.zona,
      hora:datos.hora, fecha:datos.fecha, tipo:datos.tipo, duracion:datos.duracion,
      inicioTimestamp:validacion.inicio,
      finTimestamp:validacion.inicio + validacion.minutos * 60000,
      jugadores:validacion.cantidad, max:validacion.max, precio:validacion.precio,
      creador:nombre, creadorUid:uid,
      solicitudes:[], confirmados:[{nombre,uid}], mensajes:[],
      estado:'activo', creadoEn:serverTimestamp()
    });
  } catch(e) {
    window.mostrarAviso('No se pudo crear el partido. Tus datos siguen acá; intentá de nuevo.', 'error');
    return;
  } finally {
    creandoPartido = false;
    controles.forEach(([el, disabled]) => { el.disabled = disabled; });
    boton.textContent = 'CREAR PARTIDO';
    formularioCrear.removeAttribute('aria-busy');
  }
  if(state.usuario?.uid === uid){
    state.canchaSeleccionada = null;
    irHome();
    window.mostrarAviso('Partido creado.', 'success');
  }
};

// ---- MIS PARTIDOS ----
let tabActual = 'creados';

window.switchTab = (tab) => {
  tabActual = tab;
  document.getElementById("tab-creados").classList.toggle("active", tab === 'creados');
  document.getElementById("tab-pendientes")?.classList.toggle("active", tab === 'pendientes');
  document.getElementById("tab-confirmados").classList.toggle("active", tab === 'confirmados');
  document.getElementById("tab-finalizados").classList.toggle("active", tab === 'finalizados');
  renderTabPartidos();
  document.getElementById("tab-" + tab)?.scrollIntoView({block:"nearest",inline:"nearest",behavior:"smooth"});
};

// Compatibilidad: partidos viejos guardan confirmados como string, los nuevos como {nombre,uid}
function nombreDeConfirmado(c){ return typeof c === 'string' ? c : c.nombre; }
function uidDeConfirmado(c){ return typeof c === 'string' ? null : c.uid; }


function escaparJugador(valor){
  return String(valor ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function avatarJugadorHTML(uid, nombre){
  return '<div class="mini-avatar" data-jugador-uid="'+escaparJugador(uid || '')+'" data-jugador-nombre="'+escaparJugador(nombre)+'">'+escaparJugador((nombre || '?')[0].toUpperCase())+'</div>';
}
function posicionCompleta(posicion){
  return ({DC:'Delantero centro',MCD:'Mediocampista defensivo',MC:'Mediocampista central',LB:'Lateral izquierdo',CB:'Defensa central',ARQ:'Arquero',EXT:'Extremo',VOL:'Volante'})[posicion] || posicion || 'Sin posición';
}
function reputacionSolicitud(datos){
  const total = Number(datos.calificacionesRecibidas);
  const rating = Number(datos.rating);
  const tieneOpiniones = Number.isInteger(total) && total > 0 && Number.isFinite(rating) && rating >= 1 && rating <= 5;
  const puntuacion = tieneOpiniones ? rating : 0;
  const estrellas = Array.from({length:5}, (_, i) => {
    const relleno = Math.round(Math.max(0, Math.min(1, puntuacion - i)) * 100);
    return '<span style="color:#555;position:relative;display:inline-block;">★<span style="position:absolute;left:0;top:0;overflow:hidden;white-space:nowrap;color:var(--green);width:' + relleno + '%;">★</span></span>';
  }).join('');
  const detalle = tieneOpiniones
    ? puntuacion.toLocaleString('es-UY',{minimumFractionDigits:1,maximumFractionDigits:1}) + ' · ' + total + (total === 1 ? ' opinión' : ' opiniones')
    : 'Sin opiniones';
  return '<span style="display:inline-flex;gap:2px;margin-right:6px;" role="img" aria-label="' +
    (tieneOpiniones ? puntuacion.toFixed(1) + ' de 5 estrellas' : 'Sin puntuación') +
    '">' + estrellas + '</span><span>' + detalle + '</span>';
}

async function cargarAvataresJugadores(contenedor){
  if(!contenedor) return;
  const pendientes = new Map();
  for(const avatar of contenedor.querySelectorAll('[data-jugador-uid]')){
    const uid = avatar.dataset.jugadorUid;
    if(!uid) continue;
    if(!pendientes.has(uid)) pendientes.set(uid, getDoc(doc(db,'usuarios',uid)).catch(()=>null));
    void pendientes.get(uid).then(snap => {
      if(!avatar.isConnected) return;
      const fila = avatar.closest('.solicitud-header');
      const reputacion = fila?.querySelector('[data-reputacion]');
      if(!snap?.exists()){
        if(reputacion) reputacion.textContent = 'Reputación no disponible';
        return;
      }
      const datos = snap.data();
      if(reputacion) reputacion.innerHTML = reputacionSolicitud(datos);
      const posicion = fila?.querySelector('[data-posicion]');
      if(posicion) posicion.textContent = posicionCompleta(datos.posicion);
      const foto = datos.foto;
      if(typeof foto !== 'string' || !/^(https?:\/\/|data:image\/jpeg;base64,)/.test(foto)) return;
      const img = document.createElement('img');
      img.alt = 'Foto de ' + (avatar.dataset.jugadorNombre || 'jugador');
      img.onerror = () => { avatar.textContent = (avatar.dataset.jugadorNombre || '?')[0].toUpperCase(); };
      window.prepararFotoAmpliable(img);
      img.src = foto;
      avatar.replaceChildren(img);
    });
  }
}
window.abrirPerfilSolicitud = elemento => {
  const uid = elemento.dataset.uid;
  if(uid) abrirPerfilJugador(uid, elemento.dataset.nombre);
};

function getConfirmadoItemHTML(c, p, estado){
  let nombre = nombreDeConfirmado(c);
  let esYo = nombre === state.perfil.nombre;
  let esCreador = nombre === p.creador;
  const jugadorUid = uidDeConfirmado(c) || (esCreador ? p.creadorUid : null);
  let yaCalifique = ((p.calificacionesPorUid||{})[encodeURIComponent(state.usuario.uid)]||[]).includes(jugadorUid) || ((p.calificaciones||{})[state.perfil.nombre]||[]).includes(nombre);
  const pendiente = typeof c === 'object' && c.pendienteReconfirmar;
  let accion = pendiente ? '<span style="color:#d5bc76;font-size:12px;">Pendiente de reconfirmar</span>' : '';
  if(estado === 'finalizado' && !esYo && !pendiente && !esperaReconfirmacion(p)){
    accion = yaCalifique
      ? `<span style="color:var(--green);font-size:12px;white-space:nowrap;">✅ Calificado</span>`
      : `<button onclick="abrirModalRating('${nombre}','${p.id}','${p.creadorUid}')" style="background:var(--surface2);border:1px solid #333;border-radius:8px;padding:7px 12px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;white-space:nowrap;">⭐ Calificar</button>`;
  }
  return `<div class="confirmado-item" style="justify-content:space-between;">
    <div style="display:flex;align-items:center;gap:12px;">
      ${avatarJugadorHTML(uidDeConfirmado(c) || (esCreador ? p.creadorUid : null), nombre)}
      <div>${nombre}${esCreador?` <span style="background:#003300;color:var(--green);font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;margin-left:4px;">👨‍🔧 Creador</span>`:''}</div>
    </div>
    ${accion}
  </div>`;
}

function getEstadoPartido(p){
  let ahora = Date.now();
  if(!p.inicioTimestamp) return 'activo';
  if(ahora >= p.finTimestamp) return 'finalizado';
  if(ahora >= p.inicioTimestamp) return 'en curso';
  return 'activo';
}

function estadoBadge(estado){
  if(estado === 'finalizado') return `<span style="background:#333;color:#888;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:8px;">Finalizado</span>`;
  if(estado === 'en curso') return `<span style="background:#003300;color:var(--green);font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:8px;">En curso</span>`;
  return '';
}

const retirosEnCurso = new Set();

function obtenerSolicitudesPendientes(){
  const uid = state.usuario?.uid;
  if(!uid) return [];
  return state.partidos.filter(p =>
    (p.solicitudes || []).some(s => s.uid === uid) &&
    !(p.confirmados || []).some(c => uidDeConfirmado(c) === uid) &&
    getEstadoPartido(p) === 'activo'
  );
}

function solicitudesPendientesHTML(){
  const pendientes = obtenerSolicitudesPendientes();
  if(!pendientes.length) return '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-text">No tenés solicitudes pendientes.</div></div>';
  return '<section aria-label="Solicitudes enviadas"><p class="section-title">Solicitudes enviadas · ' + pendientes.length + '</p>' +
    pendientes.map(p => `<div class="partido-item" role="button" tabindex="0" data-partido-id="${escaparJugador(p.id)}" onclick="abrirSolicitudPendiente(this.dataset.partidoId)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();abrirSolicitudPendiente(this.dataset.partidoId);}">
      <div class="partido-item-title">${escaparJugador(p.cancha)}</div>
      <div class="partido-item-sub">${escaparJugador(fechaPartido(p.fecha))} · ${escaparJugador(p.hora || '')} · Fútbol ${escaparJugador(p.tipo)}</div>
      <div class="partido-item-sub" style="margin-top:6px;">Esperando que el creador te acepte</div>
      <div class="partido-item-sub" style="margin-top:10px;color:var(--green);">Ver partido ›</div>

    </div>`).join('') + '</section>';
}

window.retirarSolicitud = async partidoId => {
  const uid = state.usuario?.uid;
  if(!uid || retirosEnCurso.has(partidoId)) return;
  if(!await confirmarAccion({
    titulo:'¿Cancelar tu solicitud?',
    mensaje:'Vas a dejar de aparecer entre las solicitudes de este partido.',
    aceptar:'Cancelar solicitud'
  })) return;
  if(state.usuario?.uid !== uid || retirosEnCurso.has(partidoId)) return;
  retirosEnCurso.add(partidoId);
  renderTabPartidos();
  try {
    await runTransaction(db, async tx => {
      const refPartido = doc(db, 'partidos', partidoId);
      const snap = await tx.get(refPartido);
      if(!snap.exists()) return;
      const p = snap.data();
      if((p.confirmados || []).some(c => uidDeConfirmado(c) === uid)){
        throw new Error('Ya te aceptaron. Podés ver el partido en Confirmados y usar la opción Bajarme del partido.');
      }
      const solicitudes = p.solicitudes || [];
      if(!solicitudes.some(s => s.uid === uid)) return;
      tx.update(refPartido, {solicitudes: solicitudes.filter(s => s.uid !== uid)});
    });
    if(state.usuario?.uid === uid){
      const p = state.partidos.find(p => p.id === partidoId);
      if(p) p.solicitudes = (p.solicitudes || []).filter(s => s.uid !== uid);
    }
    return true;
  } catch(e) {
    window.mostrarAviso(e.message || 'No se pudo retirar la solicitud. Intentá de nuevo.', 'error');
  } finally {
    retirosEnCurso.delete(partidoId);
    if(state.usuario?.uid === uid) renderTabPartidos();
  }
};

function renderTabPartidos(){
  const contador = document.getElementById('pendientesCount');
  if(contador){
    const total = obtenerSolicitudesPendientes().length;
    contador.textContent = String(total);
    contador.hidden = total === 0;
  }
  let html = '';
  if(tabActual === 'creados'){
    let mios = state.partidos.filter(p => (p.creadorUid === state.usuario.uid || p.creador === state.perfil.nombre) && !p.ocultoCreador && getEstadoPartido(p) !== 'finalizado');
    if(mios.length === 0){
      html = `<div class="empty"><div class="empty-icon">➕</div><div class="empty-text">No tenés partidos creados activos.</div></div>`;
    }
    mios.forEach(p => {
      let ri = state.partidos.indexOf(p);
      let pend = (p.solicitudes||[]).length;
      let estado = getEstadoPartido(p);
      let fechaStr = p.fecha ? `📅 ${fechaPartido(p.fecha)} · ` : '';
      html += `<div class="partido-item" onclick="verDetalle(${ri})">
        <div class="partido-item-title">${p.cancha}${estadoBadge(estado)}${estado==='activo'&&pend>0?`<span class="solicitudes-badge">${pend}</span>`:''}</div>
        <div class="partido-item-sub">${fechaStr}🕓 ${p.hora} · ⚽ Fútbol ${p.tipo} · 👥 ${p.jugadores}/${p.max}</div>
        <div class="partido-item-sub" style="margin-top:4px;">👨‍🔧 Creador · ${estado==='activo'?`${pend} solicitud${pend!==1?'es':''} pendiente${pend!==1?'s':''}`:estado}</div>
      </div>`;
    });
  } else if(tabActual === 'pendientes'){
    html = solicitudesPendientesHTML();
  } else if(tabActual === 'confirmados'){
    let conf = state.partidos.filter(p => p.creadorUid !== state.usuario.uid && p.confirmados && p.confirmados.some(c => nombreDeConfirmado(c) === state.perfil.nombre) && !(p.ocultoPara||[]).includes(state.perfil.nombre) && getEstadoPartido(p) !== 'finalizado');
    if(conf.length === 0){
      html = `<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">No tenés partidos confirmados activos.</div></div>`;
    }
    conf.forEach(p => {
      let ri = state.partidos.indexOf(p);
      let estado = getEstadoPartido(p);
      let fechaStr = p.fecha ? `📅 ${fechaPartido(p.fecha)} · ` : '';
      html += `<div class="partido-item" onclick="verInfoPartido(${ri})">
        <div class="partido-item-title">${p.cancha}${estadoBadge(estado)}</div>
        <div class="partido-item-sub">${fechaStr}🕓 ${p.hora} · ⚽ Fútbol ${p.tipo} · 👥 ${p.jugadores}/${p.max}</div>
        <div class="partido-item-sub" style="margin-top:4px;">${esperaReconfirmacion(p) ? '🕓 Confirmá el nuevo horario' : '✅ Confirmado · Ver info'}</div>
      </div>`;
    });
  } else {
    // Finalizados: junta lo creado y lo confirmado, cada uno con su propia acción de eliminar
    let fin = state.partidos.filter(p => {
      if(getEstadoPartido(p) !== 'finalizado') return false;
      let esCreador = p.creadorUid === state.usuario.uid;
      if(esCreador) return !p.ocultoCreador;
      let esConfirmado = p.confirmados && p.confirmados.some(c => nombreDeConfirmado(c) === state.perfil.nombre);
      return esConfirmado && !(p.ocultoPara||[]).includes(state.perfil.nombre);
    });
    if(fin.length === 0){
      html = `<div class="empty"><div class="empty-icon">🏁</div><div class="empty-text">Todavía no tenés partidos finalizados.</div></div>`;
    }
    fin.forEach(p => {
      let ri = state.partidos.indexOf(p);
      let esCreador = p.creadorUid === state.usuario.uid;
      let fechaStr = p.fecha ? `📅 ${fechaPartido(p.fecha)} · ` : '';
      let eliminarFn = esCreador ? `eliminarDeCreados('${p.id}')` : `eliminarDeConfirmados('${p.id}')`;
      let verFn = esCreador ? `verDetalle(${ri})` : `verInfoPartido(${ri})`;
      html += `<div class="partido-item" style="position:relative;" onclick="${verFn}">
        <button onclick="event.stopPropagation();${eliminarFn}" style="position:absolute;top:12px;right:12px;background:none;border:none;color:var(--text-muted);font-size:16px;cursor:pointer;">🗑️</button>
        <div class="partido-item-title">${p.cancha}${estadoBadge('finalizado')}</div>
        <div class="partido-item-sub">${fechaStr}🕓 ${p.hora} · ⚽ Fútbol ${p.tipo} · 👥 ${p.jugadores}/${p.max}</div>
        <div class="partido-item-sub" style="margin-top:4px;">${esCreador?'👨‍🔧 Creador':'✅ Confirmado'} · Finalizado</div>
      </div>`;
    });
  }
  document.getElementById("listaPartidos").innerHTML = html;
}

window.eliminarDeConfirmados = async (partidoId) => {
  if(!confirm("¿Eliminar este partido de tu lista? Los demás jugadores todavía van a poder verlo.")) return;
  await updateDoc(doc(db, "partidos", partidoId), { ocultoPara: arrayUnion(state.perfil.nombre) });
  renderTabPartidos();
};

window.eliminarDeCreados = async (partidoId) => {
  if(!confirm("¿Eliminar este partido de tu lista? Los demás jugadores todavía van a poder verlo y calificar.")) return;
  await updateDoc(doc(db, "partidos", partidoId), { ocultoCreador: true });
  renderTabPartidos();
};

window.verMisPartidos = () => {
  tabActual = 'creados';
  document.getElementById("tab-creados").classList.add("active");
  document.getElementById("tab-pendientes")?.classList.remove("active");
  document.getElementById("tab-confirmados").classList.remove("active");
  document.getElementById("tab-finalizados").classList.remove("active");
  renderTabPartidos();
  cambiarPantalla("misPartidos");
};


function grupoDelCreadorHTML(p){
  const cantidad = Math.max(0, (Number(p.jugadores) || 0) - (p.confirmados || []).length);
  const editable = p.creadorUid === state.usuario?.uid && getEstadoPartido(p) === 'activo';
  if(!cantidad && !editable) return '';
  const editar = editable ? '<button type="button" class="submit-btn" style="margin-top:12px;font-size:14px;" data-partido-id="' + escaparJugador(p.id) + '" onclick="editarGrupoPartido(this.dataset.partidoId)">Cambiar cuántos vienen conmigo</button>' : '';
  return '<div style="padding:14px 20px;border-top:1px solid #282828;">' +
    '<div style="font-size:14px;color:var(--text);">' + cantidad +
    (cantidad === 1 ? ' jugador del grupo del creador' : ' jugadores del grupo del creador') +
    '</div><div style="margin-top:4px;font-size:12px;line-height:1.4;color:var(--text-muted);">Ya incluidos en el total del partido.</div>' + editar + '</div>';
}


function totalConGrupo(p, cantidad, uid){
  if(p.creadorUid !== uid) throw new Error('Solo el creador puede cambiar su grupo.');
  if(getEstadoPartido(p) !== 'activo') throw new Error('El partido ya empezó o terminó.');
  const confirmados = (p.confirmados || []).length;
  const max = Number(p.max);
  if(!Number.isInteger(max) || max < 1 || confirmados < 1) throw new Error('No se pudieron verificar los cupos.');
  const disponibles = Math.max(0, max - confirmados);
  if(!Number.isInteger(cantidad) || cantidad < 0 || cantidad > disponibles){
    throw new Error('Podés llevar entre 0 y ' + disponibles + ' personas más. Los jugadores aceptados conservan su lugar.');
  }
  return confirmados + cantidad;
}

let editorGrupoAbierto = false;
window.editarGrupoPartido = partidoId => {
  if(editorGrupoAbierto) return;
  const p = state.partidos.find(p => p.id === partidoId);
  const uid = state.usuario?.uid;
  if(!p || !uid || p.creadorUid !== uid || getEstadoPartido(p) !== 'activo') return;
  editorGrupoAbierto = true;
  const cantidadInicial = Math.max(0, Number(p.jugadores) - (p.confirmados || []).length);
  const origen = document.activeElement;
  const dialogo = document.createElement('dialog');
  dialogo.className = 'editor-grupo';
  dialogo.setAttribute('aria-labelledby','titulo-editor-grupo');
  dialogo.innerHTML = '<h2 id="titulo-editor-grupo">¿Cuántos vienen con vos?</h2>' +
    '<p id="ayuda-editor-grupo">Sin contarte a vos ni a los jugadores aceptados en Futinder.</p>' +
    '<label class="form-label" for="cantidad-editor-grupo">Personas que traés</label>' +
    '<input class="form-input" id="cantidad-editor-grupo" type="number" min="0" step="1" inputmode="numeric" aria-describedby="ayuda-editor-grupo error-editor-grupo">' +
    '<p id="error-editor-grupo" role="alert" style="color:var(--red,#ff4d4d)"></p>' +
    '<button type="button" class="submit-btn" data-guardar>Guardar cambios</button>' +
    '<button type="button" class="submit-btn" data-volver style="margin-top:10px;background:#252525;color:#eee;">Volver</button>';
  const input = dialogo.querySelector('input');
  const guardar = dialogo.querySelector('[data-guardar]');
  const volver = dialogo.querySelector('[data-volver]');
  const error = dialogo.querySelector('[role="alert"]');
  input.value = cantidadInicial;
  input.max = Math.max(0, Number(p.max) - (p.confirmados || []).length);
  let guardando = false;
  let cerrado = false;
  const overflow = document.body.style.overflow;
  const cerrar = () => {
    if(guardando || cerrado) return;
    cerrado = true;
    dialogo.close();
    dialogo.remove();
    document.body.style.overflow = overflow;
    editorGrupoAbierto = false;
    if(origen?.isConnected) origen.focus({preventScroll:true});
  };
  volver.addEventListener('click', cerrar);
  dialogo.addEventListener('cancel', e => { e.preventDefault(); cerrar(); });
  dialogo.addEventListener('close', cerrar);
  guardar.addEventListener('click', async () => {
    if(guardando) return;
    const cantidad = input.value.trim() === '' ? NaN : Number(input.value);
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    guardando = true;
    guardar.disabled = volver.disabled = input.disabled = true;
    guardar.textContent = 'Guardando…';
    let resultado;
    try {
      resultado = await runTransaction(db, async tx => {
        if(state.usuario?.uid !== uid) throw new Error('La sesión cambió. Volvé a ingresar.');
        const ref = doc(db,'partidos',partidoId);
        const snap = await tx.get(ref);
        if(!snap.exists()) throw new Error('El partido ya no está disponible.');
        const actual = snap.data();
        const jugadores = totalConGrupo(actual, cantidad, uid);
        const grupoActual = Number(actual.jugadores) - (actual.confirmados || []).length;
        if(grupoActual !== cantidadInicial) throw new Error('El grupo cambió desde que abriste esta ventana. Volvé y abrila de nuevo.');
        tx.update(ref, {jugadores});
        return {...actual, jugadores, id:partidoId};
      });
    } catch(e) {
      error.textContent = e.message || 'No se pudo guardar. Intentá de nuevo.';
      input.setAttribute('aria-invalid','true');
    } finally {
      guardando = false;
      guardar.disabled = volver.disabled = input.disabled = false;
      guardar.textContent = 'Guardar cambios';
    }
    if(!resultado) return;
    cerrar();
    if(state.usuario?.uid !== uid) return;
    const i = state.partidos.findIndex(p => p.id === partidoId);
    if(i !== -1){
      state.partidos[i] = resultado;
      if(document.getElementById('creador').classList.contains('active')) verDetalle(i);
    }
    window.mostrarAviso('Actualizamos tu grupo y los lugares disponibles.', 'success');
  });
  document.body.append(dialogo);
  document.body.style.overflow = 'hidden';
  dialogo.showModal();
  volver.focus({preventScroll:true});
};

window.verDetalle = (i) => {
  state.idx = i;
  let p = state.partidos[i];
  document.getElementById("creadorTitle").textContent = p.cancha;
  let estadoCreador = getEstadoPartido(p);
  const tituloConfirmados = document.getElementById('tituloConfirmados');
  const tituloSolicitudes = document.getElementById('tituloSolicitudes');
  if(tituloConfirmados) tituloConfirmados.textContent = 'Jugadores · ' + p.jugadores + '/' + p.max;
  if(tituloSolicitudes) tituloSolicitudes.textContent = 'Solicitudes · ' + (p.solicitudes||[]).length;
  let htmlConf = (p.confirmados||[]).length === 0
    ? `<div style="padding:0 20px;color:var(--text-muted);font-size:14px;">Nadie confirmado todavía</div>`
    : (p.confirmados||[]).map(c => getConfirmadoItemHTML(c, p, estadoCreador)).join('');
  document.getElementById("listaConfirmados").innerHTML = htmlConf + grupoDelCreadorHTML(p);
  document.getElementById("btnCancelarPartido").style.display = estadoCreador === 'finalizado' ? 'none' : 'block';

  let htmlSol = (p.solicitudes||[]).length === 0
    ? `<div style="padding:0 20px;color:var(--text-muted);font-size:14px;">Sin solicitudes</div>`
    : (p.solicitudes||[]).map((s,si) => `
      <div class="solicitud-card">
        <div class="solicitud-header" data-uid="${escaparJugador(s.uid || '')}" data-nombre="${escaparJugador(s.nombre)}" onclick="abrirPerfilSolicitud(this)">
          ${avatarJugadorHTML(s.uid, s.nombre)}
          <div style="flex:1;">
            <div style="font-weight:600;">${s.nombre}</div>
            <div class="solicitud-meta"><span data-reputacion>${s.uid ? 'Cargando reputación…' : 'Reputación no disponible'}</span><span data-posicion>${escaparJugador(posicionCompleta(s.posicion))}</span></div>
          </div>
          <span style="color:var(--text-muted)">›</span>
        </div>
        <div class="solicitud-actions">
          <button class="solicitud-btn btn-rechazar" onclick="rechazar(${si})">❌ Rechazar</button>
          <button class="solicitud-btn btn-aceptar" onclick="aceptar(${si})">✅ Aceptar</button>
        </div>
      </div>`).join('');
  document.getElementById("listaSolicitudes").innerHTML = htmlSol;

  void cargarAvataresJugadores(document.getElementById("listaConfirmados"));
  void cargarAvataresJugadores(document.getElementById("listaSolicitudes"));
  cambiarPantalla("creador");
};

const aceptacionesEnCurso = new Set();
window.aceptar = async (i) => {
  const partido = state.partidos[state.idx];
  const solicitud = partido?.solicitudes?.[i];
  if(!partido || !solicitud?.uid || aceptacionesEnCurso.has(partido.id)) return;
  const partidoId = partido.id;
  const jugadorUid = solicitud.uid;
  aceptacionesEnCurso.add(partidoId);
  try {
    const resultado = await runTransaction(db, async tx => {
      const partidoRef = doc(db, "partidos", partidoId);
      const snap = await tx.get(partidoRef);
      if(!snap.exists()) throw new Error("Este partido ya no está disponible.");
      const actual = snap.data();
      const confirmados = actual.confirmados || [];
      if(confirmados.some(c => uidDeConfirmado(c) === jugadorUid || (typeof c === 'string' && c === solicitud.nombre))){
        throw new Error("Este jugador ya está confirmado.");
      }
      const jugador = (actual.solicitudes || []).find(s => s.uid === jugadorUid);
      if(!jugador) throw new Error("Esta solicitud ya no está pendiente.");
      const jugadores = Number(actual.jugadores);
      const max = Number(actual.max);
      if(!Number.isInteger(jugadores) || jugadores < 0 || !Number.isInteger(max) || max <= 0){
        throw new Error("No se pudo verificar el cupo del partido.");
      }
      if(jugadores >= max) throw new Error("El partido ya está completo. No podés aceptar más jugadores.");
      const cambios = {
        confirmados: [...confirmados, {nombre: jugador.nombre, uid: jugador.uid}],
        solicitudes: actual.solicitudes.filter(s => s.uid !== jugadorUid),
        jugadores: jugadores + 1
      };
      tx.update(partidoRef, cambios);
      return { ...actual, ...cambios, id: partidoId };
    });
    const indice = state.partidos.findIndex(p => p.id === partidoId);
    if(indice !== -1) state.partidos[indice] = resultado;
    if(state.partidos[state.idx]?.id === partidoId) verDetalle(state.idx);
    try {
      await addDoc(collection(db, "usuarios", jugadorUid, "notificaciones"), {
        tipo: "aceptado",
        texto: `¡Te aceptaron en ${resultado.cancha}! Podés entrar al chat.`,
        partidoId,
        visto: false,
        creadoEn: serverTimestamp()
      });
    } catch(e) {
      window.mostrarAviso("Jugador aceptado, pero no se pudo enviar la notificación.");
    }
  } catch(e) {
    window.mostrarAviso(e.message || "No se pudo aceptar al jugador. Intentá de nuevo.", 'error');
  } finally {
    aceptacionesEnCurso.delete(partidoId);
  }
};

window.rechazar = async (i) => {
  let p = state.partidos[state.idx];
  let nuevasSol = [...p.solicitudes];
  nuevasSol.splice(i, 1);
  await updateDoc(doc(db,"partidos",p.id), { solicitudes: nuevasSol });
  verDetalle(state.idx);
};

let motivoCancelacionElegido = null;
let motivoPartidoId = null;

window.abrirMotivoCancelacion = (partidoId) => {
  motivoPartidoId = partidoId || (state.partidos[state.idx] && state.partidos[state.idx].id);
  motivoCancelacionElegido = null;
  document.getElementById('btnReprogramarPartido').hidden = true;
  document.getElementById('ayudaReprogramar').hidden = true;
  document.querySelectorAll(".motivo-btn").forEach(b => b.classList.remove("selected"));
  document.getElementById("motivoDetalleInput").value = "";
  document.getElementById("btnConfirmarCancelacion").disabled = true;
  document.getElementById("btnConfirmarCancelacion").textContent = "Elegí un motivo para continuar";
  document.getElementById("modalMotivoCancelacion").classList.add("show");
};
window.cerrarMotivoCancelacion = () => {
  document.getElementById("modalMotivoCancelacion").classList.remove("show");
};
window.selMotivoCancelacion = (btn, motivo) => {
  motivoCancelacionElegido = motivo;
  document.querySelectorAll(".motivo-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  let boton = document.getElementById("btnConfirmarCancelacion");
  boton.disabled = false;
  boton.textContent = "🚫 Confirmar cancelación";
  const p = state.partidos.find(p => p.id === motivoPartidoId);
  const permitir = motivo === 'No puedo llegar a la hora' && p?.creadorUid === state.usuario?.uid && getEstadoPartido(p) === 'activo';
  document.getElementById('btnReprogramarPartido').hidden = !permitir;
  document.getElementById('ayudaReprogramar').hidden = !permitir;
};

window.confirmarCancelacionConMotivo = async () => {
  if(!motivoCancelacionElegido) return;
  let detalle = document.getElementById("motivoDetalleInput").value.trim();
  let motivoCompleto = detalle ? `${motivoCancelacionElegido} — ${detalle}` : motivoCancelacionElegido;
  cerrarMotivoCancelacion();
  await cancelarPartido(motivoPartidoId, motivoCompleto);
};

window.cancelarPartido = async (partidoId, motivo) => {
  let p = state.partidos.find(x => x.id === partidoId) || state.partidos[state.idx];
  if(!p) return;
  let confirmados = p.confirmados || [];
  let porAdmin = esAdmin() && p.creadorUid !== state.usuario.uid;

  if(!motivo && !confirm(`¿Cancelar el partido en ${p.cancha}? Se notificará a todos los jugadores confirmados.`)) return;

  let textoMotivo = motivo ? ` Motivo: ${motivo}.` : '';
  let textoQuien = porAdmin ? 'por un administrador' : 'por el creador';

  // Notificar a cada jugador confirmado
  for(let c of confirmados){
    let uid = uidDeConfirmado(c);
    if(uid && uid !== state.usuario.uid){
      await addDoc(collection(db, "usuarios", uid, "notificaciones"), {
        tipo: "cancelado",
        texto: `El partido en ${p.cancha} (${p.hora}) fue cancelado ${textoQuien}.${textoMotivo}`,
        partidoId: p.id,
        visto: false,
        creadoEn: serverTimestamp()
      });
    }
  }
  // Si cancela el admin y no es el creador, avisarle también al creador
  if(porAdmin && p.creadorUid && p.creadorUid !== state.usuario.uid){
    await addDoc(collection(db, "usuarios", p.creadorUid, "notificaciones"), {
      tipo: "cancelado",
      texto: `Tu partido en ${p.cancha} (${p.hora}) fue cancelado por un administrador.${textoMotivo}`,
      partidoId: p.id,
      visto: false,
      creadoEn: serverTimestamp()
    });
  }

  // Borrar el partido
  await deleteDoc(doc(db, "partidos", p.id));
  if(porAdmin) verAdminPanel(); else verMisPartidos();
};


function esperaReconfirmacion(p, uid = state.usuario?.uid, nombre = state.perfil?.nombre){
  return (p.confirmados || []).some(c => typeof c === 'object' && c.pendienteReconfirmar &&
    (c.uid ? c.uid === uid : c.nombre === nombre));
}

function prepararReprogramacion(p, fecha, hora, uid, ahora = Date.now()){
  if(p.creadorUid !== uid) throw new Error('Solo el creador puede reprogramar el partido.');
  if(getEstadoPartido(p) !== 'activo') throw new Error('Solo podés reprogramar un partido que todavía no empezó.');
  const inicio = new Date(fecha + 'T' + hora + ':00-03:00').getTime();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora) ||
    !Number.isFinite(inicio) || new Date(inicio - 10800000).toISOString().slice(0,10) !== fecha || inicio <= ahora){
    throw new Error('Elegí una fecha y hora futuras válidas.');
  }
  if(fecha === p.fecha && hora === p.hora) throw new Error('Elegí un horario diferente al actual.');
  const duracion = ({'1h':60,'1:30h':90,'2h':120})[p.duracion] || 90;
  const confirmados = (p.confirmados || []).map(c => {
    const jugador = typeof c === 'string' ? {nombre:c,uid:null} : {...c};
    const creador = jugador.uid ? jugador.uid === uid : jugador.nombre === p.creador;
    return {...jugador, pendienteReconfirmar:!creador};
  });
  return {fecha,hora,inicioTimestamp:inicio,finTimestamp:inicio + duracion*60000,
    confirmados,solicitudes:[],versionHorario:(Number(p.versionHorario)||0)+1,
    horarioAnterior:{fecha:p.fecha,hora:p.hora},notifRatingEnviada:false};
}

let reprogramacionAbierta = false;
window.abrirReprogramacion = () => {
  const partidoId = motivoPartidoId;
  const p = state.partidos.find(p => p.id === partidoId);
  const uid = state.usuario?.uid;
  if(reprogramacionAbierta || !p || p.creadorUid !== uid || getEstadoPartido(p) !== 'activo') return;
  cerrarMotivoCancelacion();
  reprogramacionAbierta = true;
  const dialogo = document.createElement('dialog');
  dialogo.className = 'editor-grupo';
  dialogo.setAttribute('aria-labelledby','titulo-reprogramar');
  dialogo.innerHTML = '<h2 id="titulo-reprogramar">Reprogramar partido</h2>' +
    '<p>Les avisaremos a los jugadores. Su lugar queda reservado hasta que confirmen el nuevo horario o se bajen. Las solicitudes sin aceptar se cancelarán para que puedan pedir unirse de nuevo.</p>' +
    '<label class="form-label" for="nueva-fecha">Nueva fecha</label><input class="form-input" id="nueva-fecha" type="date">' +
    '<label class="form-label" for="nueva-hora" style="margin-top:16px;">Nueva hora</label><input class="form-input" id="nueva-hora" type="time">' +
    '<p role="alert" style="color:var(--red,#ff4d4d)"></p><button class="submit-btn" data-guardar>Reprogramar y avisar</button>' +
    '<button class="submit-btn" data-volver style="margin-top:10px;background:#252525;color:#eee;">Volver</button>';
  const fecha = dialogo.querySelector('#nueva-fecha'), hora = dialogo.querySelector('#nueva-hora');
  fecha.min = hoyEnUruguay(); fecha.value = p.fecha; hora.value = p.hora;
  const guardar = dialogo.querySelector('[data-guardar]'), volver = dialogo.querySelector('[data-volver]');
  const error = dialogo.querySelector('[role="alert"]');
  const overflow = document.body.style.overflow;
  const origen = document.activeElement;
  let ocupado = false, cerrado = false;
  const cerrar = () => {
    if(ocupado || cerrado) return;
    cerrado = true; dialogo.close(); dialogo.remove();
    document.body.style.overflow = overflow; reprogramacionAbierta = false;
    if(origen?.isConnected) origen.focus({preventScroll:true});
  };
  volver.onclick = cerrar;
  dialogo.addEventListener('cancel', e => { e.preventDefault(); cerrar(); });
  dialogo.addEventListener('close', cerrar);
  guardar.onclick = async () => {
    if(ocupado) return;
    ocupado = true; guardar.disabled = volver.disabled = fecha.disabled = hora.disabled = true;
    guardar.textContent = 'Reprogramando…'; error.textContent = '';
    let resultado;
    try {
      resultado = await runTransaction(db, async tx => {
        if(state.usuario?.uid !== uid) throw new Error('La sesión cambió. Volvé a ingresar.');
        const ref = doc(db,'partidos',partidoId);
        const snap = await tx.get(ref);
        if(!snap.exists()) throw new Error('El partido ya no está disponible.');
        const actual = snap.data();
        if((actual.versionHorario || 0) !== (p.versionHorario || 0)) throw new Error('El horario ya cambió. Cerrá esta ventana y revisá el partido.');
        const cambios = prepararReprogramacion(actual,fecha.value,hora.value,uid);
        tx.update(ref,cambios);
        const confirmadosUid = new Set(cambios.confirmados.filter(c => c.pendienteReconfirmar && c.uid).map(c => c.uid));
        const pendientesUid = new Set((actual.solicitudes || []).map(s=>s.uid).filter(id=>id && id!==uid && !confirmadosUid.has(id)));
        for(const receptor of [...confirmadosUid,...pendientesUid]){
          const confirmado = confirmadosUid.has(receptor);
          tx.set(doc(db,'usuarios',receptor,'notificaciones',partidoId+'_horario_'+cambios.versionHorario),{
            tipo:confirmado?'reprogramado':'solicitud_reprogramada',
            texto:'El partido en '+actual.cancha+' cambió al '+fechaPartido(cambios.fecha)+' a las '+cambios.hora+'. '+
              (confirmado?'Confirmá si podés venir. Tu lugar está reservado.':'Tu solicitud anterior se canceló. Podés pedir unirte al nuevo horario.'),
            partidoId,versionHorario:cambios.versionHorario,visto:false,creadoEn:serverTimestamp()
          });
        }
        return {...actual,...cambios,id:partidoId};
      });
    } catch(e) { error.textContent = e.message || 'No se pudo reprogramar. Intentá de nuevo.'; }
    finally {
      ocupado = false; guardar.disabled = volver.disabled = fecha.disabled = hora.disabled = false;
      guardar.textContent = 'Reprogramar y avisar';
    }
    if(!resultado) return;
    cerrar();
    if(state.usuario?.uid !== uid) return;
    const i = state.partidos.findIndex(p=>p.id===partidoId);
    if(i>=0){state.partidos[i]=resultado;verDetalle(i);}
    window.mostrarAviso('Partido reprogramado. Avisamos a los jugadores.', 'success');
  };
  document.body.append(dialogo); document.body.style.overflow='hidden'; dialogo.showModal(); volver.focus();
};

function reconfirmacionHTML(p){
  if(!esperaReconfirmacion(p)) return '';
  if(getEstadoPartido(p) !== 'activo') return '<p style="color:var(--text-muted)">No confirmaste tu participación en este nuevo horario.</p>';
  const id = escaparJugador(p.id), version = Number(p.versionHorario)||0;
  return '<div style="padding:16px;margin-bottom:18px;border:1px solid var(--green);border-radius:14px;background:#001a00;">' +
    '<strong>Cambió el horario</strong><p style="font-size:14px;line-height:1.5;">Tu lugar está reservado. ¿Podés jugar el '+fechaPartido(p.fecha)+' a las '+escaparJugador(p.hora)+'?</p>' +
    '<button class="submit-btn" data-id="'+id+'" data-version="'+version+'" onclick="responderReprogramacion(this.dataset.id,Number(this.dataset.version),true)">Sí, voy</button>' +
    '<button class="submit-btn" style="background:#252525;color:#eee;margin-top:8px;" data-id="'+id+'" data-version="'+version+'" onclick="responderReprogramacion(this.dataset.id,Number(this.dataset.version),false)">No puedo, liberar mi lugar</button></div>';
}

const respuestasHorario = new Set();
window.responderReprogramacion = async (partidoId, version, acepta) => {
  const uid = state.usuario?.uid, nombre = state.perfil?.nombre;
  if(!uid || respuestasHorario.has(partidoId)) return;
  respuestasHorario.add(partidoId);
  try {
    const resultado = await runTransaction(db, async tx => {
      if(state.usuario?.uid !== uid) throw new Error('La sesión cambió.');
      const ref = doc(db,'partidos',partidoId), snap = await tx.get(ref);
      if(!snap.exists()) throw new Error('El partido ya no está disponible.');
      const p = snap.data();
      if(p.versionHorario !== version) throw new Error('El horario cambió otra vez. Revisá el nuevo horario antes de responder.');
      if(getEstadoPartido(p) !== 'activo') throw new Error('El partido ya empezó o terminó.');
      if(!esperaReconfirmacion(p,uid,nombre)) return {...p,id:partidoId};
      const esYo = c => typeof c === 'object' && (c.uid ? c.uid === uid : c.nombre === nombre);
      const confirmados = acepta
        ? p.confirmados.map(c=>esYo(c)?{...c,pendienteReconfirmar:false}:c)
        : p.confirmados.filter(c=>!esYo(c));
      const cambios = {confirmados,jugadores:acepta?p.jugadores:Math.max(0,Number(p.jugadores)-1)};
      tx.update(ref,cambios);
      tx.set(doc(db,'usuarios',p.creadorUid,'notificaciones',partidoId+'_respuesta_'+version+'_'+uid),{
        tipo:'respuesta_horario',texto:nombre+(acepta?' confirmó el nuevo horario':' no puede venir al nuevo horario y liberó su lugar')+' en '+p.cancha+'.',
        partidoId,visto:false,creadoEn:serverTimestamp()
      });
      return {...p,...cambios,id:partidoId};
    });
    if(state.usuario?.uid !== uid) return;
    const i = state.partidos.findIndex(p=>p.id===partidoId);
    if(i>=0) state.partidos[i]=resultado;
    if(acepta && i>=0) verInfoPartido(i); else verMisPartidos();
    window.mostrarAviso(acepta?'Confirmaste el nuevo horario.':'Liberaste tu lugar.', 'success');
  } catch(e){ window.mostrarAviso(e.message || 'No se pudo guardar tu respuesta.', 'error'); }
  finally { respuestasHorario.delete(partidoId); }
};


// ---- INFO PARTIDO (confirmado) ----
window.verInfoPartido = (i) => {
  state.idx = i;
  let p = state.partidos[i];
  document.getElementById("infoPartidoTitle").textContent = p.cancha;

  let estado = getEstadoPartido(p);
  let fechaStr = fechaPartido(p.fecha);
  let confirmados = p.confirmados || [];
  let fill = Math.round((p.jugadores / p.max) * 100);

  let htmlConf = confirmados.length === 0
    ? `<div style="color:var(--text-muted);font-size:14px;padding:10px 0;">Nadie confirmado todavía</div>`
    : confirmados.map(c => getConfirmadoItemHTML(c, p, estado)).join('');

  document.getElementById("infoPartidoContent").innerHTML = `
    <div class="card-img" style="height:180px;">
      <div class="card-img-bg" style="background-image:url('${p.canchaFoto||'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600'}')"></div>
      <div class="card-img-overlay">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:white;">${p.cancha}</div>
      </div>
    </div>
    <div style="padding:20px;">
      ${reconfirmacionHTML(p)}
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        <div class="card-tag">📅 <span>${fechaStr}</span></div>
        <div class="card-tag">🕓 <span>${p.hora}</span></div>
        <div class="card-tag">⏱️ <span>${p.duracion||'1h'}</span></div>
        <div class="card-tag">⚽ <span>Fútbol ${p.tipo}</span></div>
        <div class="card-tag">💰 <span>$${p.precio||0} / persona</span></div>
      </div>

      ${p.canchaDireccion ? `<div class="zona-row" style="margin-bottom:16px;">📍 ${p.canchaDireccion}</div>` : ''}

      <div class="jugadores-bar" style="margin-bottom:20px;">
        <div class="jugadores-label"><span>👥 Jugadores</span><span>${p.jugadores}/${p.max}</span></div>
        <div class="bar-bg"><div class="bar-fill" style="width:${fill}%"></div></div>
      </div>

      <p class="section-title">Jugadores y lugares reservados</p>
      <div class="confirmados-list" style="margin-bottom:20px;">${htmlConf}${grupoDelCreadorHTML(p)}</div>

      <button onclick="abrirChatIdx(${i})" style="width:100%;padding:14px;background:#001a00;color:var(--green);border:1px solid var(--green);border-radius:var(--radius-sm);font-family:'DM Sans',sans-serif;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;">
        💬 Ir al chat
      </button>
      ${getBajarseBtnHTML(p, i)}
    </div>`;

  void cargarAvataresJugadores(document.getElementById("infoPartidoContent"));
  cambiarPantalla("infoPartido");
};

function getBajarseBtnHTML(p, i){
  if(esperaReconfirmacion(p)) return '';
  if(getEstadoPartido(p) === 'finalizado') return '';
  let ahora = Date.now();
  let unaHora = 60 * 60 * 1000;
  if(p.inicioTimestamp && (p.inicioTimestamp - ahora) < unaHora){
    return `<div style="text-align:center;font-size:13px;color:var(--text-muted);padding:8px;">No podés bajarte a menos de 1 hora del inicio</div>`;
  }
  return `<button onclick="bajarseDepartido(${i})" style="width:100%;padding:14px;background:#1a0000;color:var(--red);border:1px solid #400;border-radius:var(--radius-sm);font-family:'DM Sans',sans-serif;font-size:15px;font-weight:600;cursor:pointer;">
    🚪 Bajarme del partido
  </button>`;
}

// ---- BAJARSE DEL PARTIDO ----
window.bajarseDepartido = async (i) => {
  let p = state.partidos[i];
  let ahora = Date.now();
  let unaHora = 60 * 60 * 1000;

  if(p.inicioTimestamp && (p.inicioTimestamp - ahora) < unaHora){
    window.mostrarAviso("No podés bajarte a menos de 1 hora del inicio.");
    return;
  }

  const uid = state.usuario?.uid;
  if(!await confirmarAccion({
    titulo:'¿Bajarte del partido?',
    mensaje:`Vas a liberar tu lugar en ${p.cancha}. Le avisaremos al creador.`,
    aceptar:'Bajarme'
  })) return;
  if(!uid || state.usuario?.uid !== uid) return;
  p = state.partidos.find(partido => partido.id === p.id);
  if(!p) return;
  if(getEstadoPartido(p) !== 'activo' || (p.inicioTimestamp && p.inicioTimestamp - Date.now() < unaHora)){
    window.mostrarAviso('Ya no podés bajarte de este partido.');
    return;
  }

  try {
    const version = Number(p.versionHorario)||0;
    await runTransaction(db, async tx => {
      const ref = doc(db,'partidos',p.id), snap = await tx.get(ref);
      if(!snap.exists()) throw new Error('El partido ya no está disponible.');
      const actual = snap.data();
      if((Number(actual.versionHorario)||0) !== version || esperaReconfirmacion(actual,uid,state.perfil.nombre)){
        throw new Error('El horario cambió. Revisá el partido y respondé si podés venir.');
      }
      if(getEstadoPartido(actual) !== 'activo' || actual.inicioTimestamp - Date.now() < unaHora) throw new Error('Ya no podés bajarte de este partido.');
      const esYo = c => typeof c === 'string' ? c === state.perfil.nombre : c.uid ? c.uid === uid : c.nombre === state.perfil.nombre;
      if(!(actual.confirmados||[]).some(esYo)) return;
      tx.update(ref,{confirmados:actual.confirmados.filter(c=>!esYo(c)),jugadores:Math.max(0,Number(actual.jugadores)-1)});
      tx.set(doc(db,'usuarios',actual.creadorUid,'notificaciones',p.id+'_bajada_'+version+'_'+uid),{
        tipo:'bajada',texto:state.perfil.nombre+' canceló su participación en el partido de '+actual.cancha+'.',
        partidoId:p.id,visto:false,creadoEn:serverTimestamp()
      });
    });
  } catch(e){ window.mostrarAviso(e.message || 'No se pudo liberar tu lugar.', 'error'); return; }

  verMisPartidos();
};


export { iniciarPartidos, chequearPartidosFinalizados, origCambiarPantalla, tabActual, nombreDeConfirmado, uidDeConfirmado, getConfirmadoItemHTML, getEstadoPartido, estadoBadge, renderTabPartidos, motivoCancelacionElegido, motivoPartidoId, getBajarseBtnHTML };
