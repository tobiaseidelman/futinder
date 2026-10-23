import { ref, storage, uploadBytes, getDownloadURL, updateDoc, doc, db, arrayUnion, arrayRemove, deleteObject, setDoc, getDoc } from './firebase.js';
import { state } from './state.js';
import { iniciarPartidos } from './matches.js';
import { iniciarNotificaciones } from './notifications.js';
import { pedirPermisosSesion } from './location.js';
import { TAGS } from './data/tags.js';


let portadaEditada;
let portadaYEdit = 50;
let portadaProcesando = false;
let portadaEdicion = 0;
function portadaValida(src){
  return typeof src === 'string' && src.length <= 90000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(src);
}
function posicionPortada(valor){
  const n = Number(valor);
  return Number.isFinite(n) ? Math.max(0,Math.min(100,n)) : 50;
}
function portadaHTML(perfil, clase = 'perfil-cover'){
  const y = posicionPortada(perfil.portadaY ?? 50);
  return '<div class="' + clase + '">' + (portadaValida(perfil.portada)
    ? '<img src="' + perfil.portada + '" alt="Portada del perfil" style="object-position:center ' + y + '%;">'
    : '') + '</div>';
}
function actualizarPreviewPortada(){
  const src = portadaEditada === undefined ? state.perfil.portada : portadaEditada;
  const preview = document.getElementById('previewPortadaEdit');
  if(!preview) return;
  preview.innerHTML = portadaValida(src) ? portadaHTML({portada:src,portadaY:portadaYEdit},'portada-preview-img') : '<span>Sin portada</span>';
  document.getElementById('quitarPortadaBtn').hidden = !portadaValida(src);
  document.getElementById('posicionPortadaGroup').hidden = !portadaValida(src);
  document.getElementById('portadaYInput').value = portadaYEdit;
}
window.centrarPortada = valor => {
  portadaYEdit = posicionPortada(valor);
  actualizarPreviewPortada();
};
window.quitarPortada = () => {
  if(portadaProcesando || guardandoPerfil) return;
  portadaEditada = '';
  portadaYEdit = 50;
  actualizarPreviewPortada();
};
window.previsualizarPortada = async input => {
  const file = input.files[0];
  if(!file || portadaProcesando || guardandoPerfil) return;
  if(!file.type.startsWith('image/') || file.size > 15*1024*1024){
    window.mostrarAviso('Elegí una imagen de menos de 15 MB.', 'error');
    input.value = '';
    return;
  }
  const edicion = portadaEdicion;
  const uid = state.usuario?.uid;
  portadaProcesando = true;
  try {
    const comprimida = await comprimirImagen(file,960,64);
    const src = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('No se pudo leer la portada.'));
      reader.readAsDataURL(comprimida);
    });
    if(!portadaValida(src)) throw new Error('No se pudo preparar la portada.');
    if(edicion !== portadaEdicion || uid !== state.usuario?.uid) return;
    portadaEditada = src;
    portadaYEdit = 50;
    actualizarPreviewPortada();
  } catch(e) {
    window.mostrarAviso('No se pudo preparar la portada. Probá con otra imagen.', 'error');
  } finally {
    portadaProcesando = false;
    input.value = '';
  }
};

// ---- PERFIL ----
let fotoNuevaFile = null;
let fotoProcesando = false;

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
            if(blob.size > maxKB * 1024){ reject(new Error("La imagen supera el tamaño permitido")); return; }
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


function dialogoFoto(titulo){
  const anterior = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'foto-dialog';
  const heading = document.createElement('h2');
  heading.textContent = titulo;
  dialog.append(heading);
  dialog.setAttribute('aria-label', titulo);
  document.body.append(dialog);
  dialog.addEventListener('close', () => { dialog.remove(); anterior?.focus?.(); });
  dialog.addEventListener('click', e => { if(e.target === dialog) dialog.close(); });
  return dialog;
}
function limitarRecorte(img, zoom, x, y){
  const escala = Math.max(256 / img.width, 256 / img.height) * zoom;
  const limiteX = Math.max(0, (img.width * escala - 256) / 2);
  const limiteY = Math.max(0, (img.height * escala - 256) / 2);
  return {escala, x:Math.max(-limiteX, Math.min(limiteX, x)), y:Math.max(-limiteY, Math.min(limiteY, y))};
}
function recortarFoto(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen inválida')); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const dialog = dialogoFoto('Centrar foto');
      const ayuda = document.createElement('p');
      ayuda.textContent = 'Arrastrá la foto para centrarla. El círculo muestra cómo quedará tu perfil.';
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      canvas.className = 'foto-recorte';
      canvas.setAttribute('aria-label','Vista circular de la foto. Usá las flechas para moverla.');
      canvas.tabIndex = 0;
      const label = document.createElement('label');
      label.textContent = 'Zoom';
      const zoom = document.createElement('input');
      zoom.type = 'range'; zoom.min = '1'; zoom.max = '4'; zoom.step = '0.01'; zoom.value = '1';
      zoom.setAttribute('aria-label','Zoom de la foto');
      label.append(zoom);
      const acciones = document.createElement('div');
      acciones.className = 'foto-acciones';
      const cancelar = document.createElement('button');
      cancelar.textContent = 'Cancelar'; cancelar.type = 'button';
      cancelar.onclick = () => dialog.close();
      const usar = document.createElement('button');
      usar.textContent = 'Usar foto'; usar.type = 'button'; usar.className = 'foto-confirmar';
      acciones.append(cancelar, usar);
      dialog.append(ayuda, canvas, label, acciones);
      let x = 0, y = 0, drag = null, resultado = null;
      const pintar = () => {
        const r = limitarRecorte(img, Number(zoom.value), x, y);
        x = r.x; y = r.y;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#111'; ctx.fillRect(0,0,256,256);
        ctx.drawImage(img, 128 - img.width*r.escala/2+x, 128-img.height*r.escala/2+y, img.width*r.escala,img.height*r.escala);
      };
      zoom.oninput = pintar;
      canvas.onpointerdown = e => {
        if(drag) return;
        drag = {id:e.pointerId,x:e.clientX,y:e.clientY};
        canvas.setPointerCapture(e.pointerId);
      };
      canvas.onpointermove = e => {
        if(!drag || drag.id !== e.pointerId) return;
        const ratio = 256 / canvas.getBoundingClientRect().width;
        x += (e.clientX-drag.x)*ratio; y += (e.clientY-drag.y)*ratio;
        drag.x=e.clientX; drag.y=e.clientY; pintar();
      };
      canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = () => { drag=null; };
      canvas.onkeydown = e => {
        const pasos = {ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]};
        if(!pasos[e.key]) return;
        e.preventDefault(); x+=pasos[e.key][0]; y+=pasos[e.key][1]; pintar();
      };
      usar.onclick = () => {
        usar.disabled=true;
        canvas.toBlob(blob => {
          if(!dialog.open) return;
          if(!blob){ usar.disabled=false; window.mostrarAviso('No se pudo preparar la foto. Probá de nuevo.', 'error'); return; }
          resultado = new File([blob], 'perfil.jpg', {type:'image/jpeg'});
          dialog.close();
        }, 'image/jpeg', 0.9);
      };
      dialog.addEventListener('close', () => resolve(resultado), {once:true});
      dialog.showModal(); pintar();
    };
    img.src = url;
  });
}

window.prepararFotoAmpliable = img => {
  img.classList.add('foto-ampliable');
  img.setAttribute('role','button');
  img.setAttribute('tabindex','0');
  img.setAttribute('aria-label','Ampliar foto de perfil');
  img.onclick = e => { e.preventDefault(); e.stopPropagation(); ampliarFotoPerfil(img.src, img); };
  img.onkeydown = e => {
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); e.stopPropagation(); ampliarFotoPerfil(img.src, img); }
  };
};

window.ampliarFotoPerfil = (src, origen) => {
  if(typeof src !== 'string' || !/^(https?:\/\/|data:image\/)/.test(src)) return;
  const anterior = document.activeElement;
  const focoDeTeclado = !!origen?.matches(':focus-visible');
  const dialog = document.createElement('dialog');
  dialog.className = 'foto-circulo-dialog';
  dialog.setAttribute('aria-label','Foto de perfil ampliada. Tocá para cerrar.');
  const img = document.createElement('img');
  img.src = src; img.alt = 'Foto de perfil ampliada'; img.draggable = false;
  dialog.append(img);
  const overflowAnterior = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    document.body.style.overflow = overflowAnterior;
    dialog.remove();
    if(focoDeTeclado){
      (origen || anterior)?.focus?.({preventScroll:true});
    } else if(document.activeElement === origen || document.activeElement?.classList.contains('foto-ampliable')){
      // El cierre nativo restaura el foco; un toque no debe dejar el aro marcado.
      document.activeElement.blur();
    }
  }, {once:true});
  let cerrando = false;
  let animacion = null;
  let transformOrigen = 'scale(0.8)';
  const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cerrar = async () => {
    if(cerrando || !dialog.open) return;
    cerrando = true;
    if(!reducirMovimiento){
      // Esperar la apertura evita saltos si se toca de nuevo enseguida.
      try { await animacion?.finished; } catch(e) {}
      animacion = dialog.animate([
        {transform:'translate(0,0) scale(1)',opacity:1},
        {transform:transformOrigen,opacity:0.3}
      ],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
      try { await animacion.finished; } catch(e) {}
    }
    dialog.close();
  };
  dialog.addEventListener('click', cerrar);
  dialog.addEventListener('cancel', e => { e.preventDefault(); void cerrar(); });
  dialog.showModal();
  if(!reducirMovimiento){
    const destino = dialog.getBoundingClientRect();
    const inicio = origen?.getBoundingClientRect();
    const transform = inicio
      ? 'translate(' + (inicio.left+inicio.width/2-destino.left-destino.width/2) + 'px,' + (inicio.top+inicio.height/2-destino.top-destino.height/2) + 'px) scale(' + inicio.width/destino.width + ')'
      : 'scale(0.8)';
    transformOrigen = transform;
    animacion = dialog.animate([{transform,opacity:0.3},{transform:'translate(0,0) scale(1)',opacity:1}],{duration:240,easing:'cubic-bezier(.2,.8,.2,1)'});
  }
};

window.previsualizarFoto = async (input, previewId) => {
  const file = input.files[0];
  if(!file || fotoProcesando) return;
  if(!file.type.startsWith('image/')){ window.mostrarAviso('Elegí un archivo de imagen'); input.value=''; return; }
  if(file.size > 15*1024*1024){ window.mostrarAviso('Elegí una imagen de menos de 15 MB'); input.value=''; return; }
  fotoProcesando = true;
  try {
    const recorte = await recortarFoto(file);
    if(!recorte) return;
    const preparada = await comprimirImagen(recorte,256,24);
    const src = await leerFotoPerfil(preparada);
    const img = document.createElement('img');
    img.src=src; img.alt='Vista previa de tu foto';
    img.style.cssText='width:100%;height:100%;object-fit:cover;';
    document.getElementById(previewId).replaceChildren(img);
    fotoNuevaFile=preparada;
  } catch(e) {
    console.error('Error preparando foto:',e);
    window.mostrarAviso('No se pudo preparar esa imagen. Probá con otra.', 'error');
  } finally { fotoProcesando=false; input.value=''; }
};

// Avatar pequeño: máximo 24 KiB JPEG (~32 KiB codificado), guardado en el perfil.
function leerFotoPerfil(file){
  return new Promise((resolve, reject) => {
    if(file.type !== 'image/jpeg' || file.size > 24 * 1024){
      reject(new Error('La foto de perfil debe ser un JPEG de hasta 24 KB')); return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la foto'));
    reader.onload = () => {
      const value = reader.result;
      if(typeof value !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value) || value.length > 32800){
        reject(new Error('Foto de perfil inválida')); return;
      }
      resolve(value);
    };
    reader.readAsDataURL(file);
  });
}

async function subirFoto(file, path){
  let fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  return await getDownloadURL(fileRef);
}

let jugadaSubiendo = false;

window.agregarJugada = async (input) => {
  let file = input.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){ window.mostrarAviso("Elegí un archivo de imagen"); return; }
  if((state.perfil.jugadas||[]).length >= 6){ window.mostrarAviso("Máximo 6 fotos de jugadas por ahora."); return; }
  jugadaSubiendo = true;
  verMiPerfil();
  try{
    let comprimida = await comprimirImagen(file);
    let url = await subirFoto(comprimida, `jugadas/${state.usuario.uid}/${Date.now()}.jpg`);
    state.perfil.jugadas = [...(state.perfil.jugadas||[]), url];
    await updateDoc(doc(db, "usuarios", state.usuario.uid), { jugadas: arrayUnion(url) });
  }catch(e){
    console.error("Error subiendo jugada:", e);
    window.mostrarAviso("No se pudo subir la foto, probá de nuevo.", 'error');
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
  if(fotoProcesando){ window.mostrarAviso('Esperá a que termine de prepararse la foto'); return; }
  let n = document.getElementById("nombreNuevo").value.trim();
  if(!n){ window.mostrarAviso("Ingresá tu nombre"); return; }
  if(!state.posSel){ window.mostrarAviso("Elegí tu posición"); return; }

  let fotoUrl = state.usuario.photoURL || null;
  if(fotoNuevaFile){
    try{ fotoUrl = await leerFotoPerfil(fotoNuevaFile); }
    catch(e){ console.error("Error preparando foto:", e); window.mostrarAviso("No se pudo preparar la foto. Probá con otra.", 'error'); return; }
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
  window.iniciarSocial?.();
  iniciarPartidos();
  iniciarNotificaciones();
  irHome();
  await pedirPermisosSesion(state.usuario.uid);
};

window.verMiPerfil = () => {
  document.getElementById("perfilContent").innerHTML = `
    <div class="perfil-header ${portadaValida(state.perfil.portada) ? 'con-portada' : 'sin-portada'}">
      ${portadaHTML(state.perfil)}
      <div class="perfil-avatar-wrap">
        ${state.perfil.foto ? `<img class="foto-ampliable" role="button" tabindex="0" aria-label="Ampliar foto de perfil" onclick="ampliarFotoPerfil(this.src, this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();ampliarFotoPerfil(this.src, this);}" src="${state.perfil.foto}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--bg);">` : `<div class="perfil-avatar">${state.perfil.nombre[0].toUpperCase()}</div>`}
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
  portadaEdicion++;
  portadaEditada = undefined;
  portadaYEdit = posicionPortada(state.perfil.portadaY ?? 50);
  actualizarPreviewPortada();
  document.getElementById("editNombre").value = state.perfil.nombre;
  document.getElementById("editBio").value = state.perfil.bio||'';
  document.getElementById("editZona").value = state.perfil.zona||'';
  state.posEditSel = state.perfil.posicion||'';
  document.querySelectorAll("#editPosGrid .tipo-btn").forEach(b => b.classList.toggle("selected", b.textContent===state.posEditSel));
  fotoNuevaFile = null;
  document.getElementById("previewFotoEdit").innerHTML = state.perfil.foto ? `<img src="${state.perfil.foto}" style="width:100%;height:100%;object-fit:cover;">` : '👤';
  cambiarPantalla("editarPerfil");
};

let guardandoPerfil = false;
window.guardarPerfil = async () => {
  if(guardandoPerfil) return;
  if(portadaProcesando){ window.mostrarAviso('Esperá a que termine de prepararse la portada'); return; }
  if(fotoProcesando){ window.mostrarAviso('Esperá a que termine de prepararse la foto'); return; }
  guardandoPerfil = true;
  try {
    const cambios = {
      nombre: document.getElementById("editNombre").value.trim() || state.perfil.nombre,
      posicion: state.posEditSel || state.perfil.posicion,
      bio: document.getElementById("editBio").value,
      zona: document.getElementById("editZona").value,
    };
    if(portadaEditada !== undefined) cambios.portada = portadaEditada;
    if(portadaEditada !== undefined || portadaValida(state.perfil.portada)) cambios.portadaY = portadaYEdit;
    if(fotoNuevaFile) cambios.foto = await leerFotoPerfil(fotoNuevaFile);
    await updateDoc(doc(db, "usuarios", state.usuario.uid), cambios);
    Object.assign(state.perfil, cambios);
    fotoNuevaFile = null;
    verMiPerfil();
    window.mostrarAviso('Perfil guardado', 'success');
  } catch(e) {
    console.error('Error guardando perfil:', e);
    window.mostrarAviso('No se pudieron guardar los cambios. Tu foto anterior se conserva. Probá de nuevo.', 'error');
  } finally { guardandoPerfil = false; }
};

// ---- MODAL JUGADOR ----
window.abrirPerfilJugador = async (uid, nombre) => {
  document.getElementById("modalContent").innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);">Cargando...</div>`;
  document.getElementById("modalJugador").classList.add("show");
  try {
    const snap = await getDoc(doc(db, "usuarios", uid));
    let p = snap.exists() ? snap.data() : { nombre: nombre, posicion: '', bio: 'Sin bio', zona: 'Sin zona', partidos: 0, rating: 0 };
    let foto = p.foto ? `<img class="foto-ampliable" role="button" tabindex="0" aria-label="Ampliar foto de perfil" onclick="ampliarFotoPerfil(this.src, this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();ampliarFotoPerfil(this.src, this);}" src="${p.foto}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid var(--bg);">` : `<div class="modal-avatar">${(p.nombre||nombre)[0].toUpperCase()}</div>`;
    document.getElementById("modalContent").innerHTML = `
      ${portadaValida(p.portada) ? portadaHTML(p, 'modal-portada') : ''}
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
