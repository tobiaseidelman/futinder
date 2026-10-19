import { CANCHAS } from './data/canchas.js';
import { state } from './state.js';
import { calcularDistancia } from './location.js';

// ---- FILTROS DEL HOME ----
let filtros = { tipo: null, zonaModo: 'barrio', zona: '', distancia: null, precio: null, fecha: '', horaDesde: '' };

window.abrirFiltros = () => {
  // Cargar zonas disponibles (únicas, ordenadas) en el select
  let zonasDisponibles = [...new Set(CANCHAS.map(c => c.zona))].sort();
  let sel = document.getElementById("filtroZonaSelect");
  sel.innerHTML = `<option value="">Todas las zonas</option>` + zonasDisponibles.map(z => `<option value="${z}">${z}</option>`).join('');
  sel.value = filtros.zona;
  document.getElementById("filtroDistanciaInput").value = filtros.distancia || '';
  document.getElementById("filtroPrecioInput").value = filtros.precio || '';
  document.getElementById("filtroFechaInput").value = filtros.fecha || '';
  document.getElementById("filtroHoraInput").value = filtros.horaDesde || '';
  selFiltroTipo(filtros.tipo, false);
  selFiltroZonaModo(filtros.zonaModo, false);
  document.getElementById("modalFiltros").classList.add("show");
};
window.cerrarFiltros = () => {
  document.getElementById("modalFiltros").classList.remove("show");
  render();
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
  if(modo === 'distancia' && (!state.userLat || !state.userLng)){
    alert("No tengo tu ubicación todavía — activá el GPS para filtrar por distancia.");
  }
  if(aplicar) aplicarFiltrosUI();
};

window.aplicarFiltrosUI = () => {
  filtros.zona = document.getElementById("filtroZonaSelect").value;
  filtros.distancia = parseFloat(document.getElementById("filtroDistanciaInput").value) || null;
  filtros.precio = parseFloat(document.getElementById("filtroPrecioInput").value) || null;
  filtros.fecha = document.getElementById("filtroFechaInput").value;
  filtros.horaDesde = document.getElementById("filtroHoraInput").value;
  actualizarBadgeFiltros();
};

window.resetFiltros = () => {
  filtros = { tipo: null, zonaModo: 'barrio', zona: '', distancia: null, precio: null, fecha: '', horaDesde: '' };
  actualizarBadgeFiltros();
  render();
};

window.limpiarFiltros = () => {
  filtros = { tipo: null, zonaModo: 'barrio', zona: '', distancia: null, precio: null, fecha: '', horaDesde: '' };
  abrirFiltros();
  actualizarBadgeFiltros();
};

function actualizarBadgeFiltros(){
  let activos = (filtros.tipo?1:0) + (filtros.zona||filtros.distancia?1:0) + (filtros.precio?1:0) + (filtros.fecha?1:0) + (filtros.horaDesde?1:0);
  document.getElementById("filtrosBadgeDot").style.display = activos > 0 ? 'block' : 'none';
}

function partidoPasaFiltros(p){
  if(filtros.tipo && p.tipo !== filtros.tipo) return false;
  if(filtros.zonaModo === 'barrio' && filtros.zona && p.canchaZona !== filtros.zona) return false;
  if(filtros.zonaModo === 'distancia' && filtros.distancia && state.userLat && state.userLng && p.canchaLat){
    let dist = parseFloat(calcularDistancia(state.userLat, state.userLng, p.canchaLat, p.canchaLng));
    if(dist > filtros.distancia) return false;
  }
  if(filtros.precio != null && (p.precio||0) > filtros.precio) return false;
  if(filtros.fecha && p.fecha !== filtros.fecha) return false;
  if(filtros.horaDesde && p.hora && p.hora < filtros.horaDesde) return false;
  return true;
}



export { filtros, actualizarBadgeFiltros, partidoPasaFiltros };
