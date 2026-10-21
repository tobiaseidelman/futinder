import './navigation.js';
import { state } from './state.js';
import { runTransaction, getDoc, query, collection, db, orderBy, onSnapshot, updateDoc, doc, addDoc, serverTimestamp, increment, arrayUnion, deleteDoc } from './firebase.js';
import { pedirUbicacion } from './location.js';
import { esAdmin } from './admin.js';

// ---- ESCUCHAR PARTIDOS EN TIEMPO REAL ----
function iniciarPartidos(){
  if(state.partidosUnsub) state.partidosUnsub();
  const q = query(collection(db, "partidos"), orderBy("creadoEn", "desc"));
  state.partidosUnsub = onSnapshot(q, (snap) => {
    state.partidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if(document.getElementById("home").classList.contains("active")) render();
    if(document.getElementById("misPartidos").classList.contains("active")) renderTabPartidos();
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
      if(!uid) continue; // partido viejo sin uid guardado
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
  if(id === 'crear'){
    pedirUbicacion();
    state.canchaSeleccionada = null;
    state.tipoSel = '';
    document.querySelectorAll("#crear .tipo-btn").forEach(b => b.classList.remove("selected"));
    const cg = document.getElementById("canchaGroup");
    if(cg) cg.style.display = "none";
    const hoyStr = new Date().toISOString().split('T')[0];
    const fi = document.getElementById("fecha");
    if(fi && !fi.value) fi.value = hoyStr;
  }
};
window.selDur = (btn, d) => { state.durSel=d; btn.parentElement.querySelectorAll(".tipo-btn").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); };
window.selPos = (btn, p) => { state.posSel=p; btn.parentElement.querySelectorAll(".tipo-btn").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); };
window.selPosEdit = (btn, p) => { state.posEditSel=p; btn.parentElement.querySelectorAll(".tipo-btn").forEach(b=>b.classList.remove("selected")); btn.classList.add("selected"); };

window.crearPartido = async () => {
  if(!state.canchaSeleccionada){ window.mostrarAviso("Elegí una cancha"); return; }
  let h = document.getElementById("hora").value;
  let f = document.getElementById("fecha").value;
  let j = parseInt(document.getElementById("jugadores").value);
  let pr = document.getElementById("precio").value;
  if(!h||!f||!j){ window.mostrarAviso("Completá todos los campos"); return; }

  // Calcular timestamps de inicio y fin
  let durMinutos = state.durSel === '2h' ? 120 : state.durSel === '1:30h' ? 90 : 60;
  let inicioDate = new Date(`${f}T${h}:00`);
  let finDate = new Date(inicioDate.getTime() + durMinutos * 60000);

  let max = state.tipoSel==='11'?22:state.tipoSel==='7'?14:10;
  await addDoc(collection(db,"partidos"), {
    cancha: state.canchaSeleccionada.nombre,
    canchaId: state.canchaSeleccionada.id,
    canchaFoto: state.canchaSeleccionada.foto,
    canchaDireccion: state.canchaSeleccionada.direccion,
    canchaLat: state.canchaSeleccionada.lat,
    canchaLng: state.canchaSeleccionada.lng,
    canchaZona: state.canchaSeleccionada.zona,
    hora:h, fecha:f, tipo:state.tipoSel, duracion:state.durSel,
    inicioTimestamp: inicioDate.getTime(),
    finTimestamp: finDate.getTime(),
    jugadores:j, max, precio:pr||0,
    creador:state.perfil.nombre,
    creadorUid: state.usuario.uid,
    solicitudes:[], confirmados:[{nombre: state.perfil.nombre, uid: state.usuario.uid}], mensajes:[],
    estado: 'activo',
    creadoEn: serverTimestamp()
  });
  state.canchaSeleccionada = null;
  irHome();
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
  if(!Number.isInteger(total) || total <= 0 || !Number.isFinite(rating) || rating < 1 || rating > 5) return 'Sin opiniones';
  return '★ ' + rating.toLocaleString('es-UY',{minimumFractionDigits:1,maximumFractionDigits:1}) + ' · ' + total + (total === 1 ? ' opinión' : ' opiniones');
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
      if(reputacion) reputacion.textContent = reputacionSolicitud(datos);
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
  let accion = '';
  if(estado === 'finalizado' && !esYo){
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
    pendientes.map(p => `<div class="partido-item" style="cursor:default;">
      <div class="partido-item-title">${escaparJugador(p.cancha)}</div>
      <div class="partido-item-sub">${escaparJugador(p.fecha || '')} · ${escaparJugador(p.hora || '')} · Fútbol ${escaparJugador(p.tipo)}</div>
      <div class="partido-item-sub" style="margin-top:6px;">Esperando que el creador te acepte</div>
      <button type="button" data-partido-id="${escaparJugador(p.id)}" onclick="retirarSolicitud(this.dataset.partidoId)" ${retirosEnCurso.has(p.id) ? 'disabled' : ''}
        style="margin-top:12px;min-height:44px;padding:8px 14px;background:var(--surface2);border:1px solid #444;border-radius:8px;color:var(--text);font:inherit;cursor:pointer;">
        ${retirosEnCurso.has(p.id) ? 'Retirando…' : 'Retirar solicitud'}
      </button>
    </div>`).join('') + '</section>';
}

window.retirarSolicitud = async partidoId => {
  const uid = state.usuario?.uid;
  if(!uid || retirosEnCurso.has(partidoId)) return;
  if(!confirm('¿Retirar tu solicitud para este partido?')) return;
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
      let fechaStr = p.fecha ? `📅 ${p.fecha} · ` : '';
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
      let fechaStr = p.fecha ? `📅 ${p.fecha} · ` : '';
      html += `<div class="partido-item" onclick="verInfoPartido(${ri})">
        <div class="partido-item-title">${p.cancha}${estadoBadge(estado)}</div>
        <div class="partido-item-sub">${fechaStr}🕓 ${p.hora} · ⚽ Fútbol ${p.tipo} · 👥 ${p.jugadores}/${p.max}</div>
        <div class="partido-item-sub" style="margin-top:4px;">✅ Confirmado · Ver info</div>
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
      let fechaStr = p.fecha ? `📅 ${p.fecha} · ` : '';
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

window.verDetalle = (i) => {
  state.idx = i;
  let p = state.partidos[i];
  document.getElementById("creadorTitle").textContent = p.cancha;
  let estadoCreador = getEstadoPartido(p);
  const tituloConfirmados = document.getElementById('tituloConfirmados');
  const tituloSolicitudes = document.getElementById('tituloSolicitudes');
  if(tituloConfirmados) tituloConfirmados.textContent = 'Confirmados · ' + (p.confirmados||[]).length + '/' + p.max;
  if(tituloSolicitudes) tituloSolicitudes.textContent = 'Solicitudes · ' + (p.solicitudes||[]).length;
  let htmlConf = (p.confirmados||[]).length === 0
    ? `<div style="padding:0 20px;color:var(--text-muted);font-size:14px;">Nadie confirmado todavía</div>`
    : (p.confirmados||[]).map(c => getConfirmadoItemHTML(c, p, estadoCreador)).join('');
  document.getElementById("listaConfirmados").innerHTML = htmlConf;
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

// ---- INFO PARTIDO (confirmado) ----
window.verInfoPartido = (i) => {
  state.idx = i;
  let p = state.partidos[i];
  document.getElementById("infoPartidoTitle").textContent = p.cancha;

  let estado = getEstadoPartido(p);
  let fechaStr = p.fecha || 'Sin fecha';
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

      <p class="section-title">Jugadores confirmados</p>
      <div class="confirmados-list" style="margin-bottom:20px;">${htmlConf}</div>

      <button onclick="abrirChatIdx(${i})" style="width:100%;padding:14px;background:#001a00;color:var(--green);border:1px solid var(--green);border-radius:var(--radius-sm);font-family:'DM Sans',sans-serif;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;">
        💬 Ir al chat
      </button>
      ${getBajarseBtnHTML(p, i)}
    </div>`;

  void cargarAvataresJugadores(document.getElementById("infoPartidoContent"));
  cambiarPantalla("infoPartido");
};

function getBajarseBtnHTML(p, i){
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

  if(!confirm(`¿Confirmas que querés bajarte del partido en ${p.cancha}?`)) return;

  // Sacar de confirmados
  let nuevosConf = (p.confirmados||[]).filter(c => nombreDeConfirmado(c) !== state.perfil.nombre);
  await updateDoc(doc(db, "partidos", p.id), {
    confirmados: nuevosConf,
    jugadores: Math.max((p.jugadores||1) - 1, 0)
  });

  // Notificar al creador
  await addDoc(collection(db, "usuarios", p.creadorUid, "notificaciones"), {
    tipo: "bajada",
    texto: `${state.perfil.nombre} canceló su participación en el partido de ${p.cancha}.`,
    partidoId: p.id,
    visto: false,
    creadoEn: serverTimestamp()
  });

  verMisPartidos();
};


export { iniciarPartidos, chequearPartidosFinalizados, origCambiarPantalla, tabActual, nombreDeConfirmado, uidDeConfirmado, getConfirmadoItemHTML, getEstadoPartido, estadoBadge, renderTabPartidos, motivoCancelacionElegido, motivoPartidoId, getBajarseBtnHTML };
