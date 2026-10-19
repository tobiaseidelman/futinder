import { state } from './state.js';
import { getEstadoPartido, estadoBadge } from './matches.js';

const ADMIN_UID = "CF4vDb4JcfZ7pDUOmXMKxqnjBM32";
function esAdmin(){ return state.usuario && state.usuario.uid === ADMIN_UID; }
// ---- ADMIN ----
window.verAdminPanel = () => {
  if(!esAdmin()) return;
  let activos = state.partidos.filter(p => getEstadoPartido(p) !== 'finalizado');
  let html = activos.length === 0
    ? `<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">No hay partidos activos ahora mismo.</div></div>`
    : activos.map(p => {
        let estado = getEstadoPartido(p);
        let fechaStr = p.fecha ? `📅 ${p.fecha} · ` : '';
        return `<div class="partido-item" style="position:relative;">
          <button onclick="abrirMotivoCancelacion('${p.id}')" style="position:absolute;top:12px;right:12px;background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;">🚫</button>
          <div class="partido-item-title">${p.cancha}${estadoBadge(estado)}</div>
          <div class="partido-item-sub">${fechaStr}🕓 ${p.hora} · ⚽ Fútbol ${p.tipo} · 👥 ${p.jugadores}/${p.max}</div>
          <div class="partido-item-sub" style="margin-top:4px;">Creado por ${p.creador}</div>
        </div>`;
      }).join('');
  document.getElementById("listaAdminPartidos").innerHTML = html;
  cambiarPantalla("adminPanel");
};


export { ADMIN_UID, esAdmin };
