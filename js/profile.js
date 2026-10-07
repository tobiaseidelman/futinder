import { ref, storage, uploadBytes, getDownloadURL, updateDoc, doc, db, arrayUnion, arrayRemove, deleteObject, setDoc, getDoc } from './firebase.js';
import { state } from './state.js';
import { iniciarPartidos } from './matches.js';
import { iniciarNotificaciones } from './notifications.js';
import { TAGS } from './data/tags.js';

// ---- PERFIL ----
let fotoNuevaFile = null;

// Comprime una imagen redimensionándola y bajando la calidad JPEG hasta que pese menos de maxKB
function comprimirImagen(file, maxLado = 1280, maxKB = 1000){
  return new Promise((resolve, reject) => {
    let img = new Image();
    let reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if(width > height && width > maxLado){ height = height * (maxLado / width); width = maxLado; }
      else if(height > maxLado){ width = width * (maxLado / height); height = maxLado; }
      let canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);

      let calidad = 0.85;
      const intentar = () => {
        canvas.toBlob((blob) => {
          if(!blob){ reject(new Error("No se pudo procesar la imagen")); return; }
          if(blob.size / 1024 <= maxKB || calidad <= 0.4){
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
          } else {
            calidad -= 0.15;
            intentar();
          }
        }, "image/jpeg", calidad);
      };
      intentar();
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

window.previsualizarFoto = async (input, previewId) => {
  let file = input.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){ alert("Elegí un archivo de imagen"); input.value = ''; return; }
  let preview = document.getElementById(previewId);
  preview.innerHTML = '⏳';
  try{
    fotoNuevaFile = await comprimirImagen(file);
    let reader = new FileReader();
    reader.onload = (e) => { preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">`; };
    reader.readAsDataURL(fotoNuevaFile);
  }catch(e){
    console.error("Error comprimiendo foto:", e);
    alert("No se pudo procesar esa imagen, probá con otra.");
    preview.innerHTML = '👤';
    input.value = '';
  }
};

async function subirFoto(file, path){
  let fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  return await getDownloadURL(fileRef);
}

let jugadaSubiendo = false;

window.agregarJugada = async (input) => {
  let file = input.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){ alert("Elegí un archivo de imagen"); return; }
  if((state.perfil.jugadas||[]).length >= 6){ alert("Máximo 6 fotos de jugadas por ahora."); return; }
  jugadaSubiendo = true;
  verMiPerfil();
  try{
    let comprimida = await comprimirImagen(file);
    let url = await subirFoto(comprimida, `jugadas/${state.usuario.uid}/${Date.now()}.jpg`);
    state.perfil.jugadas = [...(state.perfil.jugadas||[]), url];
    await updateDoc(doc(db, "usuarios", state.usuario.uid), { jugadas: arrayUnion(url) });
  }catch(e){
    console.error("Error subiendo jugada:", e);
    alert("No se pudo subir la foto, probá de nuevo.");
  }
  jugadaSubiendo = false;
  verMiPerfil();
};

window.eliminarJugada = async (url) => {
  if(!confirm("¿Eliminar esta foto de tus jugadas?")) return;
  state.perfil.jugadas = (state.perfil.jugadas||[]).filter(u => u !== url);
  await updateDoc(doc(db, "usuarios", state.usuario.uid), { jugadas: arrayRemove(url) });
  try{ await deleteObject(ref(storage, url)); }catch(e){ /* puede fallar si ya no existe, no bloquea */ }
  verMiPerfil();
};

window.crearPerfil = async () => {
  let n = document.getElementById("nombreNuevo").value.trim();
  if(!n){ alert("Ingresá tu nombre"); return; }
  if(!state.posSel){ alert("Elegí tu posición"); return; }

  let fotoUrl = state.usuario.photoURL || null;
  if(fotoNuevaFile){
    try{ fotoUrl = await subirFoto(fotoNuevaFile, `fotos-perfil/${state.usuario.uid}.jpg`); }
    catch(e){ console.error("Error subiendo foto:", e); }
  }

  state.perfil = {
    nombre: n,
    posicion: state.posSel,
    bio: document.getElementById("bioNueva").value,
    zona: document.getElementById("zonaNueva").value,
    partidos: 0,
    rating: 0,
    calificacionesRecibidas: 0,
    uid: state.usuario.uid,
    foto: fotoUrl,
    jugadas: [],
    email: state.usuario.email
  };
  await setDoc(doc(db, "usuarios", state.usuario.uid), state.perfil);
  iniciarPartidos();
  iniciarNotificaciones();
  irHome();
};

window.verMiPerfil = () => {
  document.getElementById("perfilContent").innerHTML = `
    <div class="perfil-header">
      <div class="perfil-cover">⚽</div>
      <div class="perfil-avatar-wrap">
        ${state.perfil.foto ? `<img src="${state.perfil.foto}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--bg);">` : `<div class="perfil-avatar">${state.perfil.nombre[0].toUpperCase()}</div>`}
      </div>
    </div>
    <div class="perfil-body">
      <div class="perfil-nombre">${state.perfil.nombre}</div>
      <span class="perfil-pos">${state.perfil.posicion||'Sin posición'}</span>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num">${state.perfil.partidos||0}</div><div class="stat-label">Partidos</div></div>
        <div class="stat-card"><div class="stat-num">${state.perfil.calificacionesRecibidas?state.perfil.rating.toFixed(1):'-'}<span style="display:block;font-size:11px;color:var(--text-muted);font-weight:400;">(${state.perfil.calificacionesRecibidas||0})</span></div><div class="stat-label">Reputación</div></div>
        <div class="stat-card" onclick="verOpinionesPropias()" style="cursor:pointer;"><div class="stat-num">${(state.perfil.tagsMostrar||[]).length}</div><div class="stat-label">Tags ›</div></div>
      </div>
      ${(state.perfil.tagsMostrar||[]).length > 0 ? `
      <p class="section-title">Tags</p>
      <div style="display:flex;flex-wrap:wrap;margin-bottom:8px;">
        ${(state.perfil.tagsMostrar||[]).map(tagId => {
          let t = TAGS.find(x => x.id === tagId);
          if(!t) return '';
          let color = t.tipo === 'bueno' ? 'var(--green)' : 'var(--red)';
          let bg = t.tipo === 'bueno' ? '#001a00' : '#1a0000';
          return `<span style="display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border-radius:20px;margin:4px;font-size:13px;background:${bg};color:${color};">${t.emoji} ${t.label}</span>`;
        }).join('')}
      </div>` : ''}
      <p class="section-title">Bio</p>
      <div class="bio-text">${state.perfil.bio||'Sin bio todavía. ¡Editá tu perfil!'}</div>
      <p class="section-title">Zona</p>
      <div class="zona-row">📍 ${state.perfil.zona||'Sin zona definida'}</div>
      <p class="section-title">Jugadas</p>
      <div class="highlight-list">
        <label class="highlight-item highlight-add" style="cursor:pointer;">
          ${jugadaSubiendo ? '⏳' : '➕'}
          <input type="file" accept="image/*" style="display:none;" onchange="agregarJugada(this)" ${jugadaSubiendo?'disabled':''}>
        </label>
        ${(state.perfil.jugadas||[]).map(url => `
          <div class="highlight-item" style="padding:0;overflow:hidden;position:relative;background-image:url('${url}');background-size:cover;background-position:center;" onclick="eliminarJugada('${url}')">
          </div>`).join('')}
      </div>
      ${(state.perfil.jugadas||[]).length === 0 ? `<div style="color:var(--text-muted);font-size:12px;margin-top:6px;">Todavía no subiste fotos de tus jugadas. Tocá ➕ para agregar una.</div>` : `<div style="color:var(--text-muted);font-size:12px;margin-top:6px;">Tocá una foto para eliminarla.</div>`}
    </div>`;
  cambiarPantalla("perfil");
};

window.editarPerfil = () => {
  document.getElementById("editNombre").value = state.perfil.nombre;
  document.getElementById("editBio").value = state.perfil.bio||'';
  document.getElementById("editZona").value = state.perfil.zona||'';
  state.posEditSel = state.perfil.posicion||'';
  document.querySelectorAll("#editPosGrid .tipo-btn").forEach(b => b.classList.toggle("selected", b.textContent===state.posEditSel));
  fotoNuevaFile = null;
  document.getElementById("previewFotoEdit").innerHTML = state.perfil.foto ? `<img src="${state.perfil.foto}" style="width:100%;height:100%;object-fit:cover;">` : '👤';
  cambiarPantalla("editarPerfil");
};

window.guardarPerfil = async () => {
  state.perfil.nombre = document.getElementById("editNombre").value.trim()||state.perfil.nombre;
  state.perfil.posicion = state.posEditSel||state.perfil.posicion;
  state.perfil.bio = document.getElementById("editBio").value;
  state.perfil.zona = document.getElementById("editZona").value;
  if(fotoNuevaFile){
    try{ state.perfil.foto = await subirFoto(fotoNuevaFile, `fotos-perfil/${state.usuario.uid}.jpg`); }
    catch(e){ console.error("Error subiendo foto:", e); alert("No se pudo subir la foto, se guardó el resto de los cambios."); }
    fotoNuevaFile = null;
  }
  await setDoc(doc(db, "usuarios", state.usuario.uid), state.perfil);
  verMiPerfil();
};

// ---- MODAL JUGADOR ----
window.abrirPerfilJugador = async (uid, nombre) => {
  document.getElementById("modalContent").innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);">Cargando...</div>`;
  document.getElementById("modalJugador").classList.add("show");
  try {
    const snap = await getDoc(doc(db, "usuarios", uid));
    let p = snap.exists() ? snap.data() : { nombre: nombre, posicion: '', bio: 'Sin bio', zona: 'Sin zona', partidos: 0, rating: 0 };
    let foto = p.foto ? `<img src="${p.foto}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid var(--bg);">` : `<div class="modal-avatar">${(p.nombre||nombre)[0].toUpperCase()}</div>`;
    document.getElementById("modalContent").innerHTML = `
      <div class="modal-perfil-header">
        ${foto}
        <div>
          <div style="font-family:'Bebas Neue',sans-serif;font-size:22px;">${p.nombre||nombre}</div>
          ${p.posicion ? `<div style="display:inline-block;background:var(--green);color:#000;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-top:4px;">${p.posicion}</div>` : ''}
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num">${p.partidos||0}</div><div class="stat-label">Partidos</div></div>
        <div class="stat-card"><div class="stat-num">${p.calificacionesRecibidas?p.rating.toFixed(1):'-'}<span style="display:block;font-size:11px;color:var(--text-muted);font-weight:400;">(${p.calificacionesRecibidas||0})</span></div><div class="stat-label">Reputación</div></div>
        <div class="stat-card" onclick="cerrarModal();abrirOpiniones('${uid}','${p.nombre||nombre}',irHome)" style="cursor:pointer;"><div class="stat-num">${(p.tagsMostrar||[]).length}</div><div class="stat-label">Tags ›</div></div>
      </div>
      <p class="section-title" style="margin-top:16px;">Bio</p>
      <div class="bio-text">${p.bio||'Sin bio'}</div>
      <p class="section-title" style="margin-top:12px;">Zona</p>
      <div class="zona-row">📍 ${p.zona||'Sin zona'}</div>
      ${(p.jugadas||[]).length > 0 ? `
      <p class="section-title" style="margin-top:12px;">Jugadas</p>
      <div class="highlight-list">
        ${(p.jugadas||[]).map(url => `<div class="highlight-item" style="padding:0;overflow:hidden;background-image:url('${url}');background-size:cover;background-position:center;"></div>`).join('')}
      </div>` : ''}`;
  } catch(e) {
    document.getElementById("modalContent").innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);">No se pudo cargar el perfil</div>`;
  }
};
window.cerrarModal = () => document.getElementById("modalJugador").classList.remove("show");


export { fotoNuevaFile, comprimirImagen, subirFoto, jugadaSubiendo };
