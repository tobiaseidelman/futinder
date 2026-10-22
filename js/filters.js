import { CANCHAS } from './data/canchas.js';
import { state } from './state.js';
import { pedirUbicacion } from './location.js';

// ---- FILTROS DEL HOME ----
let filtros = { tipo: null, zonaModo: 'barrio', zona: '', distancia: null, precio: null, fecha: '', horaDesde: '' };

window.abrirFiltros = () => {
  // Cargar zonas disponibles (únicas, ordenadas) en el select
  let zonasDisponibles = [...new Set(CANCHAS.map(c => c.zona))].sort();
  let sel = document.getElementById("filtroZonaSelect");
  sel.innerHTML = `<option value="">Todas las zonas</option>` + zonasDisponibles.map(z => `<option value="${z}">${z}</option>`).join('');
  sel.value = filtros.zona;
  document.getElementById("filtroDistanciaInput").value = filtros.distancia ?? '';
  document.getElementById("filtroPrecioInput").value = filtros.precio ?? '';
  document.getElementById("filtroFechaInput").value = filtros.fecha || '';
  document.getElementById("filtroHoraInput").value = filtros.horaDesde || '';
  selFiltroTipo(filtros.tipo, false);
  selFiltroZonaModo(filtros.zonaModo, false);
  document.getElementById("modalFiltros").classList.add("show");
};
let aplicandoFiltros = false;
window.cerrarFiltros = async () => {
  if(aplicandoFiltros || !aplicarFiltrosUI()) return;
  aplicandoFiltros = true;
  try {
    if(filtros.zonaModo === 'distancia' && filtros.distancia !== null && !ubicacionValida(state.userLat,state.userLng)){
      window.mostrarAviso('Necesitamos tu ubicación para filtrar por distancia.');
      await pedirUbicacion();
      if(!ubicacionValida(state.userLat,state.userLng)){
        window.mostrarAviso('No pudimos obtener tu ubicación. Permití el acceso o elegí filtrar por barrio.', 'error');
        return;
      }
    }
    state.idx = 0;
    document.getElementById("modalFiltros").classList.remove("show");
    render();
  } finally { aplicandoFiltros = false; }
};

window.selFiltroTipo = (tipo, aplicar = true) => {
  filtros.tipo = tipo;
  document.querySelectorAll("#modalFiltros .tipo-grid")[0].querySelectorAll(".tipo-btn").forEach(b => b.classList.remove("selected"));
  (tipo ? document.querySelector(`#modalFiltros .tipo-grid button[onclick="selFiltroTipo('${tipo}')"]`) : document.getElementById("filtroTipoTodos")).classList.add("selected");
  if(aplicar) aplicarFiltrosUI();
};

window.selFiltroZonaModo = (modo, aplicar = true) => {
  filtros.zonaModo = modo;
  document.getElementById("filtroZonaModoBarrio").classList.toggle("selected", modo === 'barrio');
  document.getElementById("filtroZonaModoDistancia").classList.toggle("selected", modo === 'distancia');
  document.getElementById("filtroZonaSelect").style.display = modo === 'barrio' ? 'block' : 'none';
  document.getElementById("filtroDistanciaInput").style.display = modo === 'distancia' ? 'block' : 'none';
  if(aplicar) aplicarFiltrosUI();
};

window.aplicarFiltrosUI = () => {
  filtros.zona = document.getElementById("filtroZonaSelect").value;
  const distancia = document.getElementById("filtroDistanciaInput");
  const precio = document.getElementById("filtroPrecioInput");
  for(const campo of [distancia,precio]){
    campo.setCustomValidity('');
    if(campo === distancia && filtros.zonaModo !== 'distancia') continue;
    if(!campo.checkValidity()){
      campo.reportValidity();
      return false;
    }
  }
  filtros.distancia = distancia.value.trim() === '' ? null : Number(distancia.value);
  filtros.precio = precio.value.trim() === '' ? null : Number(precio.value);
  filtros.fecha = document.getElementById("filtroFechaInput").value;
  filtros.horaDesde = document.getElementById("filtroHoraInput").value;
  actualizarBadgeFiltros();
  return true;
};

window.resetFiltros = () => {
  filtros = { tipo: null, zonaModo: 'barrio', zona: '', distancia: null, precio: null, fecha: '', horaDesde: '' };
  actualizarBadgeFiltros();
  state.idx = 0;
  render();
};

window.limpiarFiltros = () => {
  filtros = { tipo: null, zonaModo: 'barrio', zona: '', distancia: null, precio: null, fecha: '', horaDesde: '' };
  abrirFiltros();
  actualizarBadgeFiltros();
};

function actualizarBadgeFiltros(){
  let activos = (filtros.tipo?1:0) + ((filtros.zonaModo === 'barrio' ? !!filtros.zona : filtros.distancia !== null)?1:0) + (filtros.precio !== null?1:0) + (filtros.fecha?1:0) + (filtros.horaDesde?1:0);
  document.getElementById("filtrosBadgeDot").style.display = activos > 0 ? 'block' : 'none';
}

function ubicacionValida(lat,lng){
  return typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat)<=90 &&
    typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lng)<=180;
}
function distanciaExacta(lat1,lng1,lat2,lng2){
  const rad = n => n*Math.PI/180;
  const a = Math.sin(rad(lat2-lat1)/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(rad(lng2-lng1)/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
}
function partidoPasaFiltros(p){
  if(filtros.tipo && String(p.tipo) !== filtros.tipo) return false;
  if(filtros.zonaModo === 'barrio' && filtros.zona && p.canchaZona !== filtros.zona) return false;
  if(filtros.zonaModo === 'distancia' && filtros.distancia !== null){
    if(!ubicacionValida(state.userLat,state.userLng) || !ubicacionValida(p.canchaLat,p.canchaLng)) return false;
    if(distanciaExacta(state.userLat,state.userLng,p.canchaLat,p.canchaLng) > filtros.distancia) return false;
  }
  if(filtros.precio !== null){
    const precio = Number(p.precio ?? 0);
    if(!Number.isFinite(precio) || precio > filtros.precio) return false;
  }
  if(filtros.fecha && p.fecha !== filtros.fecha) return false;
  if(filtros.horaDesde && (!p.hora || p.hora < filtros.horaDesde)) return false;
  return true;
}



export { filtros, actualizarBadgeFiltros, partidoPasaFiltros };
