import { TAGS, TAG_UMBRAL, TAG_NOTIF_CADA } from './data/tags.js';
import { state } from './state.js';
import { nombreDeConfirmado, uidDeConfirmado } from './matches.js';
import { runTransaction, updateDoc, doc, db, addDoc, collection, serverTimestamp, getDoc, setDoc } from './firebase.js';

// ---- SISTEMA DE RATING ----
let enviandoRating = false;
let ratingActual = 0;
let tagsSeleccionados = [];
let ratingTarget = { nombre: '', partidoId: '', creadorUid: '' };

window.abrirModalRating = (nombre, partidoId, creadorUid) => {
  if(enviandoRating) return;
  ratingActual = 0;
  tagsSeleccionados = [];
  ratingTarget = { nombre, partidoId, creadorUid };

  renderModalRating();
  document.getElementById("modalRating").classList.add("show");
};

window.cerrarModalRating = () => {
  document.getElementById("modalRating").classList.remove("show");
};

function renderModalRating(){
  let starsHTML = [1,2,3,4,5].map(n => `
    <span onclick="selStar(${n})" style="font-size:36px;cursor:pointer;color:${n<=ratingActual?'#f5c518':'#333'};">★</span>
  `).join('');

  let tagsHTML = TAGS.map(t => {
    let sel = tagsSeleccionados.includes(t.id);
    let color = t.tipo === 'bueno' ? 'var(--green)' : 'var(--red)';
    let bg = t.tipo === 'bueno' ? '#001a00' : '#1a0000';
    let border = t.tipo === 'bueno' ? '#040' : '#400';
    return `<span onclick="selTag('${t.id}')" style="display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border-radius:20px;margin:4px;font-size:13px;cursor:pointer;border:1px solid ${sel?border:'#333'};background:${sel?bg:'var(--surface2)'};color:${sel?color:'var(--text-muted)'};">
      ${t.emoji} ${t.label}
    </span>`;
  }).join('');

  document.getElementById("modalRatingContent").innerHTML = `
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;">Calificar a ${ratingTarget.nombre}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">Elegí estrellas y hasta 3 tags</div>
    </div>
    <div style="display:flex;justify-content:center;gap:8px;margin-bottom:20px;">${starsHTML}</div>
    <p class="section-title">Tags (máximo 3)</p>
    <div style="display:flex;flex-wrap:wrap;margin-bottom:20px;">${tagsHTML}</div>
    <button id="enviarRatingBtn" onclick="enviarRating()" style="width:100%;padding:14px;background:var(--green);color:#000;border:none;border-radius:var(--radius-sm);font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;cursor:pointer;">ENVIAR CALIFICACIÓN</button>
  `;
}

window.selStar = (n) => {
  if(enviandoRating) return;
  ratingActual = n;
  renderModalRating();
};

window.selTag = (id) => {
  if(enviandoRating) return;
  if(tagsSeleccionados.includes(id)){
    tagsSeleccionados = tagsSeleccionados.filter(t => t !== id);
  } else {
    if(tagsSeleccionados.length >= 3){ window.mostrarAviso("Máximo 3 tags"); return; }
    tagsSeleccionados.push(id);
  }
  renderModalRating();
};

window.enviarRating = async () => {
  if(enviandoRating) return;
  if(!Number.isInteger(ratingActual) || ratingActual < 1 || ratingActual > 5){ window.mostrarAviso("Elegí al menos una estrella"); return; }
  if(!state.usuario || !state.perfil) return;
  const {nombre, partidoId} = ratingTarget;
  const autorUid = state.usuario.uid;
  const autorNombre = state.perfil.nombre;
  const estrellas = ratingActual;
  const tags = [...new Set(tagsSeleccionados)].filter(id=>TAGS.some(t=>t.id===id)).slice(0,3);
  const local = state.partidos.find(x => x.id === partidoId);
  if(!local) return;
  const jugador = (local.confirmados||[]).find(c => nombreDeConfirmado(c) === nombre);
  const targetUid = (jugador ? uidDeConfirmado(jugador) : null) || (nombre === local.creador ? local.creadorUid : null);
  if(!targetUid){ window.mostrarAviso('No se pudo identificar al jugador.', 'error'); return; }
  if(targetUid === autorUid){ window.mostrarAviso('No podés calificarte a vos mismo.'); return; }
  enviandoRating = true;
  const boton = document.getElementById('enviarRatingBtn');
  if(boton){ boton.disabled = true; boton.textContent = 'Guardando…'; }
  try {
    const partidoRef = doc(db,'partidos',partidoId);
    const perfilRef = doc(db,'usuarios',targetUid);
    // Una sola opinión por autor y partido en la colección del jugador.
    const opinionRef = doc(db,'usuarios',targetUid,'ratings',encodeURIComponent(partidoId)+'__'+encodeURIComponent(autorUid));
    const resultado = await runTransaction(db, async tx => {
      const partidoSnap = await tx.get(partidoRef);
      const opinionSnap = await tx.get(opinionRef);
      const perfilSnap = await tx.get(perfilRef);
      if(!partidoSnap.exists() || !perfilSnap.exists()) throw new Error('No se encontró el partido o el jugador.');
      const p = partidoSnap.data();
      const claveAutor = encodeURIComponent(autorUid);
      const porUid = p.calificacionesPorUid || {};
      const anteriores = porUid[claveAutor] || [];
      const legado = (p.calificaciones || {})[autorNombre] || [];
      if(opinionSnap.exists() || anteriores.includes(targetUid) || legado.includes(nombre)){
        return {duplicada:true,p};
      }
      const participa = uid => p.creadorUid === uid || (p.confirmados||[]).some(c=>uidDeConfirmado(c) === uid && !c.pendienteReconfirmar);
      if(!participa(autorUid) || !participa(targetUid)) throw new Error('Solo pueden calificarse los jugadores de este partido.');
      if(!Number.isFinite(p.finTimestamp) || Date.now() < p.finTimestamp) throw new Error('Podés calificar cuando termine el partido.');
      const calificacionesPorUid = {...porUid,[claveAutor]:[...anteriores,targetUid]};
      const calificaciones = {...(p.calificaciones||{}),[autorNombre]:[...new Set([...legado,nombre])]};
      tx.set(opinionRef,{de:autorNombre,deUid:autorUid,estrellas,tags,partidoId,autorIndice:(p.confirmados||[]).findIndex(c=>c?.uid===autorUid),jugadorIndice:(p.confirmados||[]).findIndex(c=>c?.uid===targetUid),fecha:serverTimestamp()});
      tx.update(partidoRef,{calificacionesPorUid,calificaciones,ultimaCalificacion:{autorUid,targetUid,opinionId:opinionRef.id}});
      await actualizarStatsJugador(targetUid,estrellas,tags,tx,perfilSnap.data(),opinionRef.id);
      return {duplicada:false,p:{...p,calificacionesPorUid,calificaciones}};
    });
    Object.assign(local,resultado.p);
    // También ocultar el botón si encontramos una opinión previa por su ID único.
    const claveAutor = encodeURIComponent(autorUid);
    local.calificacionesPorUid = {...(local.calificacionesPorUid||{}),[claveAutor]:[...new Set([...(local.calificacionesPorUid?.[claveAutor]||[]),targetUid])]};
    window.cerrarModalRating();
    const i = state.partidos.indexOf(local);
    if(i >= 0){
      if(local.creadorUid === autorUid) verDetalle(i); else verInfoPartido(i);
    }
    window.mostrarAviso(resultado.duplicada ? 'Ya calificaste a este jugador en este partido.' : 'Calificación enviada', resultado.duplicada ? 'info' : 'success');
  } catch(e) {
    console.error('Error al calificar:',e);
    window.mostrarAviso(e.message || 'No se pudo guardar la calificación. Probá de nuevo.', 'error');
  } finally {
    enviandoRating = false;
    if(boton){ boton.disabled = false; boton.textContent = 'ENVIAR CALIFICACIÓN'; }
  }
};

async function actualizarStatsJugador(targetUid, estrellas, tags, tx = null, datosPrevios = null, opinionId = null){
  const perfilRef = doc(db, "usuarios", targetUid);
  const snap = datosPrevios ? null : await getDoc(perfilRef);
  if(!datosPrevios && !snap.exists()) return;
  const datos = datosPrevios || snap.data();

  // Actualizar rating promedio (contador propio, independiente de partidos jugados)
  let totalCalificaciones = (datos.calificacionesRecibidas || 0) + 1;
  let ratingViejo = datos.rating || 0;
  let nuevoRating = ((ratingViejo * (totalCalificaciones - 1)) + estrellas) / totalCalificaciones;

  // Actualizar contadores de tags
  let tagContadores = {...(datos.tagContadores || {})};
  let tagsMostrar = [...(datos.tagsMostrar || [])];
  let notifsPendientes = [];

  for(let tagId of tags){
    tagContadores[tagId] = (tagContadores[tagId] || 0) + 1;
    let count = tagContadores[tagId];
    let tagInfo = TAGS.find(t => t.id === tagId);

    // Mostrar tag si supera umbral
    if(count >= TAG_UMBRAL && !tagsMostrar.includes(tagId)){
      tagsMostrar.push(tagId);
    }

    // Notificar tags malos en múltiplos de TAG_NOTIF_CADA
    if(tagInfo && tagInfo.tipo === 'malo' && count % TAG_NOTIF_CADA === 0){
      notifsPendientes.push({
        tipo: 'tag_malo', emisorUid:state.usuario.uid, opinionId, tagId,
        texto: `Recibiste ${count} veces el tag "${tagInfo.emoji} ${tagInfo.label}". ¡Intentá mejorar para la próxima!`,
        visto: false,
        creadoEn: serverTimestamp()
      });
    }

    // Eliminar tag malo si el opuesto supera el doble
    if(tagInfo && tagInfo.tipo === 'bueno'){
      let opuestoId = tagInfo.opuesto;
      let countMalo = tagContadores[opuestoId] || 0;
      let countBueno = tagContadores[tagId] || 0;
      if(countBueno >= countMalo * 2 && tagsMostrar.includes(opuestoId)){
        tagsMostrar = tagsMostrar.filter(t => t !== opuestoId);
      }
    }
  }

  tagsMostrar = TAGS.filter(t => (tagContadores[t.id]||0) >= TAG_UMBRAL && (t.tipo==='bueno' || (tagContadores[t.opuesto]||0) < (tagContadores[t.id]||0)*2)).map(t=>t.id);
  const cambios = {
    ultimaOpinionId:opinionId,
    calificacionesRecibidas: totalCalificaciones,
    rating: nuevoRating,
    tagContadores,
    tagsMostrar
  };
  if(tx) tx.update(perfilRef,cambios);
  else await updateDoc(perfilRef,cambios);

  for(let notif of notifsPendientes){
    if(tx) tx.set(doc(collection(db,'usuarios',targetUid,'notificaciones')),notif);
    else await addDoc(collection(db,'usuarios',targetUid,'notificaciones'),notif);
  }
}

// ---- OPINIONES (tags con conteo real, ordenados de más a menos votados) ----
async function abrirOpiniones(uid, nombre, backFn){
  cambiarPantalla("opiniones");
  document.getElementById("opinionesTitle").textContent = nombre;
  document.getElementById("opinionesBackBtn").onclick = backFn;
  document.getElementById("opinionesContent").innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);">Cargando...</div>`;

  let datos;
  if(uid === state.usuario.uid){
    datos = state.perfil;
  } else {
    const snap = await getDoc(doc(db, "usuarios", uid));
    datos = snap.exists() ? snap.data() : {};
  }
  renderOpiniones(datos);
}

function renderOpiniones(datos){
  let rating = datos.rating || 0;
  let cantidad = datos.calificacionesRecibidas || 0;
  let tagContadores = datos.tagContadores || {};

  let tagsOrdenados = Object.keys(tagContadores)
    .map(id => ({ ...TAGS.find(t => t.id === id), count: tagContadores[id] }))
    .filter(t => t.id && t.count > 0)
    .sort((a,b) => b.count - a.count);

  let starsFull = Math.round(rating);
  let starsHTML = '★'.repeat(starsFull) + '☆'.repeat(5 - starsFull);

  document.getElementById("opinionesContent").innerHTML = `
    <div style="display:flex;align-items:baseline;gap:10px;margin:20px 0;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:48px;color:var(--green);">${cantidad>0?rating.toFixed(1):'-'}</div>
      <div><div class="stars" style="font-size:18px;">${starsHTML}</div><div style="font-size:13px;color:var(--text-muted);">${cantidad} opinion${cantidad!==1?'es':''}</div></div>
    </div>
    <p class="section-title">Tags recibidos</p>
    ${tagsOrdenados.length === 0
      ? `<div style="color:var(--text-muted);font-size:14px;padding:10px 0;">Todavía no recibió tags</div>`
      : tagsOrdenados.map(t => {
          let color = t.tipo === 'bueno' ? 'var(--green)' : 'var(--red)';
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1a1a1a;">
            <span>${t.emoji} ${t.label}</span>
            <span style="color:${color};font-weight:600;">${t.count}</span>
          </div>`;
        }).join('')
    }`;
}
window.verOpinionesPropias = () => abrirOpiniones(state.usuario.uid, state.perfil.nombre, verMiPerfil);


export { ratingActual, tagsSeleccionados, ratingTarget, renderModalRating, actualizarStatsJugador, abrirOpiniones, renderOpiniones };

