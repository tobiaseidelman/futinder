import './navigation.js';
import { state } from './state.js';
import { query, collection, db, orderBy, onSnapshot, updateDoc, doc, addDoc, serverTimestamp, increment, arrayUnion, deleteDoc } from './firebase.js';
import { pedirUbicacion } from './location.js';
import { esAdmin } from './admin.js';

// ---- ESCUCHAR PARTIDOS EN TIEMPO REAL ----
function iniciarPartidos(){
  if(state.partidosUnsub) state.partidosUnsub();
  const q = query(collection(db, "partidos"), orderBy("creadoEn", "desc"));
  state.partidosUnsub = onSnapshot(q, (snap) => {
    state.partidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if(document.getElementById("home").classList.contains("active")) render();
    if(document.getElementById("misPartidos").classList.contains("active")) verMisPartidos();
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
  if(!state.canchaSeleccionada){ alert("Elegí una cancha"); return; }
  let h = document.getElementById("hora").value;
  let f = document.getElementById("fecha").value;
  let j = parseInt(document.getElementById("jugadores").value);
  let pr = document.getElementById("precio").value;
  if(!h||!f||!j){ alert("Completá todos los campos"); return; }

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
  document.getElementById("tab-confirmados").classList.toggle("active", tab === 'confirmados');
  document.getElementById("tab-finalizados").classList.toggle("active", tab === 'finalizados');
  renderTabPartidos();
};

// Compatibilidad: partidos viejos guardan confirmados como string, los nuevos como {nombre,uid}
function nombreDeConfirmado(c){ return typeof c === 'string' ? c : c.nombre; }
function uidDeConfirmado(c){ return typeof c === 'string' ? null : c.uid; }

function getConfirmadoItemHTML(c, p, estado){
  let nombre = nombreDeConfirmado(c);
  let esYo = nombre === state.perfil.nombre;
  let esCreador = nombre === p.creador;
  let yaCalifique = ((p.calificaciones||{})[state.perfil.nombre]||[]).includes(nombre);
  let accion = '';
  if(estado === 'finalizado' && !esYo){
    accion = yaCalifique
      ? `<span style="color:var(--green);font-size:12px;white-space:nowrap;">✅ Calificado</span>`
      : `<button onclick="abrirModalRating('${nombre}','${p.id}','${p.creadorUid}')" style="background:var(--surface2);border:1px solid #333;border-radius:8px;padding:7px 12px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:12px;cursor:pointer;white-space:nowrap;">⭐ Calificar</button>`;
  }
  return `<div class="confirmado-item" style="justify-content:space-between;">
    <div style="display:flex;align-items:center;gap:12px;">
      <div class="mini-avatar">${nombre[0].toUpperCase()}</div>
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

function renderTabPartidos(){
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
  let htmlConf = (p.confirmados||[]).length === 0
    ? `<div style="padding:0 20px;color:var(--text-muted);font-size:14px;">Nadie confirmado todavía</div>`
    : (p.confirmados||[]).map(c => getConfirmadoItemHTML(c, p, estadoCreador)).join('');
  document.getElementById("listaConfirmados").innerHTML = htmlConf;
  document.getElementById("btnCancelarPartido").style.display = estadoCreador === 'finalizado' ? 'none' : 'block';

  let htmlSol = (p.solicitudes||[]).length === 0
    ? `<div style="padding:0 20px;color:var(--text-muted);font-size:14px;">Sin solicitudes</div>`
    : (p.solicitudes||[]).map((s,si) => `
      <div class="solicitud-card">
        <div class="solicitud-header" onclick="abrirPerfilJugador('${s.nombre}')">
          <div class="mini-avatar">${s.nombre[0].toUpperCase()}</div>
          <div style="flex:1;">
            <div style="font-weight:600;">${s.nombre}</div>
            <div style="font-size:13px;color:var(--text-muted);"><span class="stars">★★★★★</span> · ${s.posicion||'Sin posición'}</div>
          </div>
          <span style="color:var(--text-muted)">›</span>
        </div>
        <div class="solicitud-actions">
          <button class="solicitud-btn btn-rechazar" onclick="rechazar(${si})">❌ Rechazar</button>
          <button class="solicitud-btn btn-aceptar" onclick="aceptar(${si})">✅ Aceptar</button>
        </div>
      </div>`).join('');
  document.getElementById("listaSolicitudes").innerHTML = htmlSol;

  cambiarPantalla("creador");
};

window.aceptar = async (i) => {
  let p = state.partidos[state.idx];
  let jugador = p.solicitudes[i];
  let nuevasConf = [...(p.confirmados||[]), {nombre: jugador.nombre, uid: jugador.uid}];
  let nuevasSol = [...p.solicitudes];
  nuevasSol.splice(i, 1);
  await updateDoc(doc(db,"partidos",p.id), {
    confirmados: nuevasConf,
    solicitudes: nuevasSol,
    jugadores: p.jugadores + 1
  });
  // Notificación al jugador aceptado
  await addDoc(collection(db, "usuarios", jugador.uid, "notificaciones"), {
    tipo: "aceptado",
    texto: `¡Te aceptaron en ${p.cancha}! Podés entrar al chat.`,
    partidoId: p.id,
    visto: false,
    creadoEn: serverTimestamp()
  });
  verDetalle(state.idx);
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
    alert("No podés bajarte a menos de 1 hora del inicio.");
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
