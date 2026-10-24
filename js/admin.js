import { fechaPartido } from './navigation.js';
import { state } from './state.js';
import { db, doc, collection, query, orderBy, onSnapshot } from './firebase.js';
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
    cancelar.classList.add('admin-danger');
    const acciones=document.createElement('div');acciones.className='admin-actions';
    adminBoton(acciones,'Ver información',()=>window.abrirDetalleAdmin(p.id));
    adminBoton(acciones,'Leer chat',()=>window.abrirDetalleAdmin(p.id,true));
    fila.append(nombre,datos,creador,acciones,cancelar);lista.append(fila);
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


function adminTexto(parent,tag,value,className=''){
  const el=document.createElement(tag);el.textContent=value;el.className=className;parent.append(el);return el;
}
function adminBoton(parent,label,action){
  const el=adminTexto(parent,'button',label,'social-action');el.type='button';el.onclick=action;return el;
}
window.abrirDetalleAdmin=(id,mostrarChat=false)=>{
  if(!esAdmin())return;
  window.cerrarDetalleAdmin?.();
  const d=document.createElement('dialog');d.className='social-dialog admin-detail';
  d.setAttribute('aria-label','Información del partido para administración');
  const header=adminTexto(d,'div','','admin-detail-header');
  const title=adminTexto(header,'h2','Cargando partido…');
  const origen=document.activeElement,overflow=document.body.style.overflow;
  let cerrado=false,stopPartido=null,stopChat=null,chatIniciado=false;
  const cerrar=()=>{
    if(cerrado)return;cerrado=true;stopPartido?.();stopChat?.();d.close();d.remove();
    document.body.style.overflow=overflow;window.cerrarDetalleAdmin=null;
    if(origen?.isConnected)origen.focus({preventScroll:true});
  };
  window.cerrarDetalleAdmin=cerrar;
  adminBoton(header,'Cerrar',cerrar);
  const info=adminTexto(d,'div','','admin-detail-info');
  const chat=adminTexto(d,'details','','admin-chat');chat.open=mostrarChat;
  adminTexto(chat,'summary','Chat del partido · solo lectura');
  const mensajes=adminTexto(chat,'div','Cargando mensajes…','admin-chat-messages');
  mensajes.setAttribute('aria-label','Mensajes del partido');mensajes.tabIndex=0;
  function iniciarChat(){
    if(chatIniciado||cerrado||!esAdmin()||!chat.open)return;
    chatIniciado=true;
    stopChat=onSnapshot(query(collection(db,'partidos',id,'mensajes'),orderBy('hora','asc')),snap=>{
      if(cerrado||!esAdmin())return;
      const bajar=mensajes.scrollHeight-mensajes.clientHeight-mensajes.scrollTop<72;
      const anterior=mensajes.scrollTop;mensajes.replaceChildren();
      for(const item of snap.docs){
        const m=item.data(),fila=adminTexto(mensajes,'div','','admin-chat-message');
        adminTexto(fila,'strong',m.nombre||'Jugador');
        adminTexto(fila,'p',m.texto||'');
        const fecha=m.hora?.toDate?.();
        if(fecha)adminTexto(fila,'small',fecha.toLocaleString('es-UY',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}));
      }
      if(!snap.docs.length)adminTexto(mensajes,'p','Sin mensajes todavía.');
      mensajes.scrollTop=bajar?mensajes.scrollHeight:anterior;
    },e=>{
      if(cerrado)return;
      mensajes.textContent=e.code==='permission-denied'?'Falta publicar las reglas de Firebase que permiten al administrador leer el chat.':'No se pudo cargar el chat. Cerrá esta vista y volvé a intentar.';
    });
  }
  chat.addEventListener('toggle',iniciarChat);
  d.addEventListener('cancel',e=>{e.preventDefault();cerrar();});
  document.body.append(d);document.body.style.overflow='hidden';d.showModal();
  stopPartido=onSnapshot(doc(db,'partidos',id),snap=>{
    if(cerrado||!esAdmin())return;
    info.replaceChildren();
    if(!snap.exists()){
      title.textContent='Partido no disponible';stopChat?.();chat.hidden=true;mensajes.replaceChildren();return;
    }
    const p=snap.data();title.textContent=p.cancha||'Partido';
    const datos=adminTexto(info,'dl','','admin-match-data');
    for(const [label,value]of [
      ['Estado',getEstadoPartido(p)],['Fecha',p.fecha?fechaPartido(p.fecha):'Sin fecha'],
      ['Hora',p.hora||'Sin hora'],['Formato','Fútbol '+p.tipo],['Duración',p.duracion||'Sin indicar'],
      ['Precio por persona','$'+(p.precio??0)],['Dirección',p.canchaDireccion||'Sin dirección'],
      ['Jugadores',(p.jugadores??0)+'/'+(p.max??0)]
    ]){adminTexto(datos,'dt',label);adminTexto(datos,'dd',value);}
    const personas=(titulo,items)=>{
      adminTexto(info,'h3',titulo);
      for(const item of items){
        const c=typeof item==='string'?{nombre:item}:item;
        const fila=adminTexto(info,'div','','admin-person');
        const nombre=adminTexto(fila,'div','');
        adminTexto(nombre,'strong',c.nombre||'Jugador');
        const detalles=[c.uid===p.creadorUid?'Creador':'',c.posicion||'',c.pendienteReconfirmar?'Debe reconfirmar':''].filter(Boolean);
        if(detalles.length)adminTexto(nombre,'small',detalles.join(' · '));
        if(c.uid){const opciones=adminTexto(fila,'span','');opciones.innerHTML=window.botonOpcionesPersonaHTML?.(c.uid,c.nombre)||'';}
        if(c.uid)adminBoton(fila,'Ver perfil',()=>{cerrar();window.abrirPerfilJugador(c.uid,c.nombre);});
      }
    };
    const confirmados=p.confirmados||[];
    if(!confirmados.some(c=>c?.uid===p.creadorUid))personas('Creador',[{uid:p.creadorUid,nombre:p.creador}]);
    personas('Participantes · '+confirmados.length,confirmados);
    const extras=Math.max(0,(Number(p.jugadores)||0)-confirmados.length);
    if(extras)adminTexto(info,'p',extras+' acompañante'+(extras===1?'':'s')+' del creador (incluidos en el total).','admin-muted');
    const solicitudes=p.solicitudes||[];
    if(solicitudes.length)personas('Solicitudes registradas · '+solicitudes.length,solicitudes);
    iniciarChat();
  },()=>{if(!cerrado){title.textContent='No se pudo cargar el partido';info.textContent='Cerrá esta vista y volvé a intentar.';}});
};
