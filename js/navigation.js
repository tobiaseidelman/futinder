
// ---- NAV ----
window.cambiarPantalla = (id) => {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
};
window.irHome = () => { window.limpiarTarjetaPendiente?.(); render(); cambiarPantalla("home"); };

// Avisos breves dentro de la app, sin bloquear la navegación.
let avisoTimer;
let avisoActual;
window.mostrarAviso = (mensaje, tipo = 'info') => {
  clearTimeout(avisoTimer);
  avisoActual?.remove();
  const aviso = document.createElement('div');
  const error = tipo === 'error';
  const color = error ? 'var(--red, #ff4d4d)' : 'var(--green, #39ff14)';
  aviso.setAttribute('role', error ? 'alert' : 'status');
  aviso.setAttribute('aria-live', error ? 'assertive' : 'polite');
  aviso.setAttribute('aria-atomic', 'true');
  aviso.style.cssText = 'position:fixed;inset:auto 16px calc(86px + env(safe-area-inset-bottom, 0px));margin:0 auto;box-sizing:border-box;width:calc(100% - 32px);max-width:400px;padding:14px 16px;border:1px solid '+color+';border-radius:14px;background:#151515;color:#f5f5f5;box-shadow:0 8px 30px #0008;z-index:100000;display:flex;align-items:center;gap:10px;font:500 14px/1.45 "DM Sans",sans-serif;overflow-wrap:anywhere;pointer-events:none;';
  const icono = document.createElement('span');
  icono.textContent = error ? '!' : tipo === 'success' ? '✓' : 'i';
  icono.setAttribute('aria-hidden', 'true');
  icono.style.cssText = 'color:'+color+';font-size:20px;font-weight:700;flex-shrink:0';
  const texto = document.createElement('span');
  texto.textContent = String(mensaje);
  aviso.append(icono, texto);
  // Popover permite que el aviso también se vea encima del editor de fotos.
  if(typeof aviso.showPopover === 'function') aviso.setAttribute('popover', 'manual');
  document.body.append(aviso);
  if(typeof aviso.showPopover === 'function') aviso.showPopover();
  avisoActual = aviso;
  const animar = !window.matchMedia('(prefers-reduced-motion: reduce)').matches && typeof aviso.animate === 'function';
  if(animar) aviso.animate([{opacity:0,transform:'translateY(12px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});
  avisoTimer = setTimeout(async () => {
    if(animar){
      try { await aviso.animate([{opacity:1},{opacity:0,transform:'translateY(8px)'}],{duration:160,fill:'forwards'}).finished; } catch(e) {}
    }
    aviso.remove();
    if(avisoActual === aviso) avisoActual = null;
  }, error ? 6000 : 3000);
};

export function fechaPartido(fecha, ahora = new Date()){
  if(typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Fecha a confirmar';
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const fechaUTC = new Date(Date.UTC(anio, mes - 1, dia));
  if(fechaUTC.getUTCFullYear() !== anio || fechaUTC.getUTCMonth() !== mes - 1 || fechaUTC.getUTCDate() !== dia) return 'Fecha a confirmar';
  const partes = new Intl.DateTimeFormat('en', {timeZone:'America/Montevideo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ahora);
  const valor = tipo => Number(partes.find(p => p.type === tipo).value);
  const hoy = Date.UTC(valor('year'),valor('month') - 1,valor('day'));
  const dias = (fechaUTC.getTime() - hoy) / 86400000;
  if(dias >= 0 && dias <= 7){
    const semana = ['dom.','lun.','mar.','mié.','jue.','vie.','sáb.'];
    return semana[fechaUTC.getUTCDay()] + ' ' + dia;
  }
  return String(dia).padStart(2,'0') + '-' + String(mes).padStart(2,'0') + '-' + anio;
}
