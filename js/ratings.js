import { TAGS, TAG_UMBRAL, TAG_NOTIF_CADA } from './data/tags.js';
import { state } from './state.js';
import { nombreDeConfirmado, uidDeConfirmado } from './matches.js';
import { updateDoc, doc, db, addDoc, collection, serverTimestamp, getDoc, setDoc } from './firebase.js';

// ---- SISTEMA DE RATING ----
let ratingActual = 0;
let tagsSeleccionados = [];
let ratingTarget = { nombre: '', partidoId: '', creadorUid: '' };

window.abrirModalRating = (nombre, partidoId, creadorUid) => {
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
    <button onclick="enviarRating()" style="width:100%;padding:14px;background:var(--green);color:#000;border:none;border-radius:var(--radius-sm);font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:1px;cursor:pointer;">ENVIAR CALIFICACIÓN</button>
  `;
}

window.selStar = (n) => {
  ratingActual = n;
  renderModalRating();
};

window.selTag = (id) => {
  if(tagsSeleccionados.includes(id)){
    tagsSeleccionados = tagsSeleccionados.filter(t => t !== id);
  } else {
    if(tagsSeleccionados.length >= 3){ alert("Máximo 3 tags"); return; }
    tagsSeleccionados.push(id);
  }
  renderModalRating();
};

window.enviarRating = async () => {
  if(ratingActual === 0){ alert("Elegí al menos una estrella"); return; }

  let nombre = ratingTarget.nombre;
  let partidoId = ratingTarget.partidoId;

  // Buscar uid del jugador a calificar
  let p = state.partidos.find(x => x.id === partidoId);
  if(!p) return;

  // Buscar uid directo en confirmados (ya guarda nombre+uid)
  let confirmadoData = (p.confirmados||[]).find(c => nombreDeConfirmado(c) === nombre);
  let targetUid = confirmadoData ? uidDeConfirmado(confirmadoData) : null;
  if(!targetUid && nombre === p.creador) targetUid = p.creadorUid;

  // Guardar calificacion en el partido (para saber quién ya calificó a quién)
  let calificaciones = p.calificaciones || {};
  let misCalif = calificaciones[state.perfil.nombre] || [];
  misCalif.push(nombre);
  calificaciones[state.perfil.nombre] = misCalif;
  await updateDoc(doc(db, "partidos", partidoId), { calificaciones });

  // Guardar rating en subcoleccion del jugador calificado
  if(targetUid){
    await addDoc(collection(db, "usuarios", targetUid, "ratings"), {
      de: state.perfil.nombre,
      deUid: state.usuario.uid,
      estrellas: ratingActual,
      tags: tagsSeleccionados,
      partidoId,
      fecha: serverTimestamp()
    });

    // Actualizar stats del jugador calificado
    await actualizarStatsJugador(targetUid, ratingActual, tagsSeleccionados);
  }

  cerrarModalRating();
  // Refrescar pantalla (creador ve "creador", el resto ve "infoPartido")
  let i = state.partidos.indexOf(p);
  if(p.creadorUid === state.usuario.uid) verDetalle(i); else verInfoPartido(i);
  alert("¡Calificación enviada! ✅");
};

async function actualizarStatsJugador(targetUid, estrellas, tags){
  const perfilRef = doc(db, "usuarios", targetUid);
  const snap = await getDoc(perfilRef);
  if(!snap.exists()) return;
  let datos = snap.data();

  // Actualizar rating promedio (contador propio, independiente de partidos jugados)
  let totalCalificaciones = (datos.calificacionesRecibidas || 0) + 1;
  let ratingViejo = datos.rating || 0;
  let nuevoRating = ((ratingViejo * (totalCalificaciones - 1)) + estrellas) / totalCalificaciones;

  // Actualizar contadores de tags
  let tagContadores = datos.tagContadores || {};
  let tagsMostrar = datos.tagsMostrar || [];
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
        tipo: 'tag_malo',
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

  await setDoc(perfilRef, {
    ...datos,
    calificacionesRecibidas: totalCalificaciones,
    rating: nuevoRating,
    tagContadores,
    tagsMostrar
  });

  // Enviar notificaciones de tags malos
  for(let notif of notifsPendientes){
    await addDoc(collection(db, "usuarios", targetUid, "notificaciones"), notif);
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
