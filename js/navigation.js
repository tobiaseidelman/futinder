
// ---- NAV ----
window.cambiarPantalla = (id) => {
  if(id !== 'adminPanel') window.detenerReportesAdmin?.();
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.actualizarPuntosNav?.();
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

let confirmacionAbierta = false;
export function confirmarAccion({titulo, mensaje, aceptar}){
  if(confirmacionAbierta) return Promise.resolve(false);
  confirmacionAbierta = true;
  return new Promise(resolve => {
    const origen = document.activeElement;
    const dialogo = document.createElement('dialog');
    dialogo.className = 'fut-confirmacion';
    dialogo.setAttribute('aria-labelledby', 'fut-confirmacion-titulo');
    dialogo.setAttribute('aria-describedby', 'fut-confirmacion-texto');
    const estilo = document.createElement('style');
    estilo.textContent = `
      .fut-confirmacion{box-sizing:border-box;width:calc(100% - 32px);max-width:380px;max-height:calc(100dvh - 48px);margin:auto;padding:24px;border:1px solid #343434;border-radius:24px;background:#151515;color:#f5f5f5;box-shadow:0 24px 80px #0009;font-family:'DM Sans',sans-serif;overflow:auto}
      .fut-confirmacion::backdrop{background:rgba(0,0,0,.72);backdrop-filter:blur(4px)}
      .fut-confirmacion h2{margin:0 0 10px;font-size:22px;line-height:1.2;font-weight:700;letter-spacing:-.5px}
      .fut-confirmacion p{margin:0 0 24px;color:#aaa;font-size:14px;line-height:1.5;overflow-wrap:anywhere}
      .fut-confirmacion-acciones{display:flex;flex-wrap:wrap;gap:10px}
      .fut-confirmacion button{box-sizing:border-box;flex:1 1 120px;min-height:48px;padding:12px;border:1px solid #3a3a3a;border-radius:13px;background:#222;color:#eee;font:600 14px/1.3 'DM Sans',sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent}
      .fut-confirmacion button:last-child{background:var(--green,#39ff14);border-color:var(--green,#39ff14);color:#090909}
      .fut-confirmacion button:focus-visible{outline:2px solid var(--green,#39ff14);outline-offset:4px}
      .fut-confirmacion button:active{opacity:.8}
      @media(prefers-reduced-motion:no-preference){.fut-confirmacion[open]{animation:fut-confirmar-entrada .18s ease-out}@keyframes fut-confirmar-entrada{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}}
    `;
    const encabezado = document.createElement('h2');
    encabezado.id = 'fut-confirmacion-titulo';
    encabezado.textContent = titulo;
    const texto = document.createElement('p');
    texto.id = 'fut-confirmacion-texto';
    texto.textContent = mensaje;
    const acciones = document.createElement('div');
    acciones.className = 'fut-confirmacion-acciones';
    const volver = document.createElement('button');
    volver.type = 'button';
    volver.textContent = 'Volver';
    volver.autofocus = true;
    const confirmar = document.createElement('button');
    confirmar.type = 'button';
    confirmar.textContent = aceptar;
    acciones.append(volver, confirmar);
    dialogo.append(estilo, encabezado, texto, acciones);
    const overflowAnterior = document.body.style.overflow;
    let terminado = false;
    const cerrar = resultado => {
      if(terminado) return;
      terminado = true;
      dialogo.close();
      dialogo.remove();
      document.body.style.overflow = overflowAnterior;
      confirmacionAbierta = false;
      if(origen?.isConnected) origen.focus({preventScroll:true});
      resolve(resultado);
    };
    volver.addEventListener('click', () => cerrar(false));
    confirmar.addEventListener('click', () => cerrar(true));
    dialogo.addEventListener('cancel', e => { e.preventDefault(); cerrar(false); });
    dialogo.addEventListener('close', () => cerrar(false));
    dialogo.addEventListener('click', e => {
      const r = dialogo.getBoundingClientRect();
      if(e.target === dialogo && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) cerrar(false);
    });
    document.body.append(dialogo);
    document.body.style.overflow = 'hidden';
    dialogo.showModal();
    volver.focus({preventScroll:true});
  });
}
