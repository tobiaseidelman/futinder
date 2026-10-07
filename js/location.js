import { state } from './state.js';
import { CANCHAS } from './data/canchas.js';

function calcularDistancia(lat1, lng1, lat2, lng2){
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLng = (lng2-lng1) * Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
    Math.sin(dLng/2)*Math.sin(dLng/2);
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return (R*c).toFixed(1);
}

function renderCanchaSelector(){
  const cont = document.getElementById("canchaSelector");
  if(!cont) return;
  let canchasFiltradas = state.tipoSel ? CANCHAS.filter(c => c.tipo === state.tipoSel) : CANCHAS;
  cont.innerHTML = canchasFiltradas.map(c => {
    let dist = (state.userLat && state.userLng) ? `📍 ${calcularDistancia(state.userLat, state.userLng, c.lat, c.lng)} km` : '';
    return `
      <div class="cancha-item ${state.canchaSeleccionada?.id===c.id?'selected':''}" onclick="selCancha('${c.id}')">
        <img class="cancha-thumb" src="${c.foto}" alt="${c.nombre}" onerror="this.style.background='var(--surface3)'">
        <div class="cancha-info">
          <div class="cancha-nombre">${c.nombre}</div>
          <div class="cancha-dir">${c.direccion}</div>
          ${dist ? `<div style="font-size:12px;color:var(--green);margin-top:2px;">${dist}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

window.selTipoCancha = (btn, tipo) => {
  state.tipoSel = tipo;
  state.canchaSeleccionada = null;
  btn.parentElement.querySelectorAll(".tipo-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  document.getElementById("canchaGroup").style.display = "block";
  renderCanchaSelector();
};

window.selCancha = (id) => {
  state.canchaSeleccionada = CANCHAS.find(c => c.id === id);
  state.tipoSel = state.canchaSeleccionada.tipo;
  renderCanchaSelector();
};

// Pedir ubicación del usuario
function pedirUbicacion(){
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos => {
      state.userLat = pos.coords.latitude;
      state.userLng = pos.coords.longitude;
      renderCanchaSelector();
    }, () => {});
  }
}


export { calcularDistancia, renderCanchaSelector, pedirUbicacion };
