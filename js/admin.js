import { fechaPartido } from './navigation.js';
import { state } from './state.js';
import { getEstadoPartido } from './matches.js';

const ADMIN_UID = "CF4vDb4JcfZ7pDUOmXMKxqnjBM32";
function esAdmin(){ return Boolean(state.usuario && state.usuario.uid === ADMIN_UID); }
window.actualizarAccesoAdmin = () => {
  const btn = document.getElementById('adminBtn');
  if(btn) btn.style.display = esAdmin() ? 'flex' : 'none';
  if(!esAdmin()){
    document.getElementById('listaAdminPartidos')?.replaceChildren();
    window.detenerReportesAdmin?.();
    if(document.getElementById('adminPanel')?.classList.contains('active')) window.cambiarPantalla(state.usuario ? 'home' : 'login');
  }
};
window.renderAdminPanel = () => {
  const lista = document.getElementById('listaAdminPartidos');
  if(!lista) return;
  lista.replaceChildren();
  if(!esAdmin()) return;
  const activos = state.partidos.filter(p => getEstadoPartido(p) !== 'finalizado');
  const titulo = document.createElement('p'); titulo.className='section-title';
  titulo.textContent='Partidos · '+activos.length; lista.append(titulo);
  if(!activos.length){const vacio=document.createElement('p');vacio.textContent='No hay partidos activos ahora mismo.';lista.append(vacio);}
  for(const p of activos){
    const fila=document.createElement('div');fila.className='partido-item';
    const nombre=document.createElement('div');nombre.className='partido-item-title';nombre.textContent=p.cancha||'Cancha';
    const datos=document.createElement('div');datos.className='partido-item-sub';
    datos.textContent=(p.fecha?fechaPartido(p.fecha)+' · ':'')+(p.hora||'')+' · Fútbol '+p.tipo+' · '+p.jugadores+'/'+p.max+' · '+getEstadoPartido(p);
    const creador=document.createElement('div');creador.className='partido-item-sub';creador.textContent='Creado por '+(p.creador||'Jugador');
    const cancelar=document.createElement('button');cancelar.className='social-action';cancelar.textContent='Cancelar partido';
    cancelar.style.cssText='margin-top:10px;color:var(--red);min-height:44px';
    cancelar.onclick=()=>{if(esAdmin()) window.abrirMotivoCancelacion(p.id);};
    fila.append(nombre,datos,creador,cancelar);lista.append(fila);
  }
  const reportes=document.createElement('div');reportes.id='listaAdminReportes';lista.append(reportes);
  window.renderReportesAdmin?.();
};
window.verAdminPanel = () => {
  if(!esAdmin()) return;
  window.renderAdminPanel();
  window.cambiarPantalla('adminPanel');
  window.iniciarReportesAdmin?.();
};
export { ADMIN_UID, esAdmin };
