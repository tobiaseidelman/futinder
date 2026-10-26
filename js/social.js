import { avatarMensaje, horaMensaje } from './chat.js';
import { state } from './state.js';
import { getEstadoPartido } from './matches.js';
import { db, doc, collection, query, where, orderBy, onSnapshot, getDoc, runTransaction, serverTimestamp } from './firebase.js';
import { getDocs, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { fechaPartido, confirmarAccion } from './navigation.js';

let socialUid=null, unsubscribe=null, relaciones=[], busqueda=[], buscando=0;
let amistadesCargadas=false;
const perfiles=new Map();
const ocupados=new Set();
let cerrarCompartir=null;
const idValido=id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
let enlacePendiente=new URL(window.location.href).searchParams.get('partido');
let abriendoEnlace=false;

function avisoError(e){window.mostrarAviso(e.message || 'No se pudo completar. Intentá de nuevo.','error');}
function sesion(uid){
  if(!uid || state.usuario?.uid!==uid || !state.perfil) throw new Error('Iniciá sesión para continuar.');
}
function boton(texto,accion,principal=false){
  const b=document.createElement('button');b.type='button';b.className='social-action'+(principal?' primary':'');b.textContent=texto;
  b.onclick=async()=>{
    if(b.disabled) return;
    b.disabled=true;
    try {await accion();}catch(e){avisoError(e);}finally{b.disabled=false;}
  };
  return b;
}
function texto(parent,text,clase='social-help'){
  const el=document.createElement('p');el.className=clase;el.textContent=text;parent.append(el);return el;
}
function encabezado(parent,titulo){const el=document.createElement('h2');el.className='section-title';el.style.marginTop='24px';el.textContent=titulo;parent.append(el);}
async function perfilDe(uid){
  if(perfiles.has(uid)) return perfiles.get(uid);
  const snap=await getDoc(doc(db,'usuarios',uid));
  const datos=snap.exists()?snap.data():{nombre:'Jugador no disponible'};
  perfiles.set(uid,datos);return datos;
}
function persona(parent,uid,datos){
  const b=document.createElement('button');b.type='button';b.className='social-person';
  const avatar=document.createElement('span');avatar.className='social-avatar';avatar.textContent=(datos.nombre||'?')[0].toUpperCase();
  if(typeof datos.foto==='string' && /^(https?:\/\/|data:image\/jpeg;base64,)/.test(datos.foto)){
    const img=document.createElement('img');img.className='social-avatar';img.alt='';img.src=datos.foto;img.onerror=()=>img.replaceWith(avatar);b.append(img);
  }else b.append(avatar);
  const nombre=document.createElement('span');nombre.textContent=datos.nombre||'Jugador';b.append(nombre);
  b.onclick=()=>window.abrirPerfilJugador(uid,datos.nombre||'Jugador');parent.append(b);
  const opciones=document.createElement('span');opciones.innerHTML=window.botonOpcionesPersonaHTML(uid,datos.nombre);parent.append(opciones);
}
function relacion(uid){return relaciones.find(r=>r.uid===uid);}
async function dibujarUsuario(parent,uid,datos){
  const fila=document.createElement('div');fila.className='social-row';parent.append(fila);
  persona(fila,uid,datos);
  const r=relacion(uid),acciones=document.createElement('div');acciones.className='social-actions';
  if(r?.estado==='amigos'){
    acciones.append(boton('Chatear',()=>window.abrirChatAmigo(uid),true));
    acciones.append(boton('Eliminar',async()=>{
      if(await confirmarAccion({titulo:'¿Eliminar de amigos?',mensaje:datos.nombre+' dejará de aparecer en tu lista.',aceptar:'Eliminar'})) await cambiarAmistad(uid,'eliminar');
    }));
  }else if(r?.estado==='pendiente'){
    if(r.solicitanteUid===state.usuario.uid) acciones.append(boton('Cancelar solicitud',()=>cambiarAmistad(uid,'cancelar')));
    else acciones.append(boton('Aceptar',()=>cambiarAmistad(uid,'aceptar'),true),boton('Rechazar',()=>cambiarAmistad(uid,'rechazar')));
  }else acciones.append(boton('Agregar',()=>cambiarAmistad(uid,'solicitar'),true));
  fila.append(acciones);
}
let renderGeneracion=0;
let tabAmigos='chats';
window.mostrarTabAmigos=tab=>{
  tabAmigos=['chats','amigos','solicitudes'].includes(tab)?tab:'chats';
  void renderAmigos();
};
async function renderAmigos(){
  const uid=socialUid,version=++renderGeneracion;
  if(!uid || state.usuario?.uid!==uid) return;
  const cont=document.getElementById('listaAmigos');
  cont.replaceChildren();
  const recibidas=relaciones.filter(r=>r.estado==='pendiente'&&r.solicitanteUid!==uid);
  document.getElementById('cantidadSolicitudesAmistad').textContent=String(recibidas.length);
  document.getElementById('tabMisAmigos').setAttribute('aria-pressed',String(tabAmigos==='amigos'));
  document.getElementById('tabSolicitudesAmigos').setAttribute('aria-pressed',String(tabAmigos==='solicitudes'));
  document.getElementById('buscadorAmigos').hidden=tabAmigos!=='amigos';
  document.getElementById('tabChatsAmigos')?.setAttribute('aria-pressed',String(tabAmigos==='chats'));
  if(tabAmigos==='chats'){await renderChatsPrivados(cont,uid,version);return;}
  const grupos=tabAmigos==='solicitudes' ? [
    ['Solicitudes de amistad',recibidas],
    ['Solicitudes enviadas',relaciones.filter(r=>r.estado==='pendiente'&&r.solicitanteUid===uid)]
  ] : [['Mis amigos',relaciones.filter(r=>r.estado==='amigos')]];
  for(const [titulo,items] of grupos){
    if(!items.length && titulo==='Solicitudes enviadas') continue;
    encabezado(cont,titulo+' · '+items.length);
    if(!items.length) texto(cont,titulo==='Solicitudes de amistad'?'No tenés solicitudes pendientes. Todas las solicitudes de amistad que recibas van a aparecer acá.':'Buscá a tus amigos para compartir partidos con ellos.');
    for(const r of items){
      try{
        const datos=await perfilDe(r.uid);
        if(version!==renderGeneracion||uid!==socialUid) return;
        await dibujarUsuario(cont,r.uid,datos);
      }catch(e){if(version===renderGeneracion) texto(cont,'No se pudo cargar un jugador. Volvé a abrir Amigos.');}
    }
  }
  const resultados=document.getElementById('resultadosAmigos');
  resultados.replaceChildren();
  if(busqueda.length && tabAmigos==='amigos'){
    encabezado(resultados,'Resultados');
    for(const u of busqueda) await dibujarUsuario(resultados,u.uid,u.datos);
  }
}
window.detenerSocial=()=>{
  tabAmigos='chats';
  detenerChatsPrivados();
  amistadesCargadas=false;
  unsubscribe?.();unsubscribe=null;socialUid=null;relaciones=[];busqueda=[];perfiles.clear();buscando++;renderGeneracion++;
  window.actualizarPuntosNav?.();
  cerrarCompartir?.();
  cerrarMenuPersona?.();
  const buscar=document.getElementById('buscarAmigoBtn');if(buscar){buscar.disabled=false;buscar.textContent='Buscar';}
  document.getElementById('listaAmigos')?.replaceChildren();
  document.getElementById('resultadosAmigos')?.replaceChildren();
};
window.iniciarSocial=()=>{
  window.detenerSocial();
  const uid=state.usuario?.uid;if(!uid) return;socialUid=uid;
  iniciarChatsPrivados(uid);
  unsubscribe=onSnapshot(collection(db,'usuarios',uid,'amistades'),snap=>{
    if(socialUid!==uid||state.usuario?.uid!==uid) return;
    relaciones=snap.docs.map(d=>({...d.data(),uid:d.id}));
    amistadesCargadas=true;
    window.actualizarPuntosNav?.();
    window.actualizarBotonesAmistad();
    if(document.getElementById('amigos').classList.contains('active')) void renderAmigos();
  },()=>{
    if(socialUid===uid) window.mostrarAviso('No pudimos cargar Amigos. Revisá la conexión y los permisos de Firebase.','error');
  });
};
window.verAmigos=(tab=tabAmigos)=>{
  if(!state.usuario||!state.perfil) return;
  if(socialUid!==state.usuario.uid) window.iniciarSocial();
  tabAmigos=['chats','amigos','solicitudes'].includes(tab)?tab:'chats';
  window.cambiarPantalla('amigos');return renderAmigos();
};
window.buscarAmigos=async()=>{
  const nombre=document.getElementById('buscarAmigoInput').value.trim(),uid=state.usuario?.uid;
  if(nombre.length<2){window.mostrarAviso('Escribí al menos dos letras del nombre.');return;}
  const generacion=++buscando,b=document.getElementById('buscarAmigoBtn');
  b.disabled=true;b.textContent='Buscando…';
  try{
    sesion(uid);
    const snap=await getDocs(query(collection(db,'usuarios'),where('nombre','>=',nombre),where('nombre','<=',nombre+'\uf8ff'),orderBy('nombre'),limit(20)));
    if(generacion!==buscando||uid!==socialUid) return;
    busqueda=snap.docs.filter(d=>d.id!==uid).map(d=>({uid:d.id,datos:d.data()}));
    busqueda.forEach(u=>perfiles.set(u.uid,u.datos));
    await renderAmigos();
    if(!busqueda.length) texto(document.getElementById('resultadosAmigos'),'No encontramos jugadores con ese nombre. Revisá las mayúsculas y cómo aparece en su perfil.');
  }catch(e){avisoError(e);}
  finally{if(generacion===buscando){b.disabled=false;b.textContent='Buscar';}}
};

async function cambiarAmistad(otro,accion){
  const uid=state.usuario?.uid;sesion(uid);
  if(!idValido(otro)||otro===uid||ocupados.has(otro)) return;
  ocupados.add(otro);
  try{
    await runTransaction(db,async tx=>{
      sesion(uid);
      const mia=doc(db,'usuarios',uid,'amistades',otro),suya=doc(db,'usuarios',otro,'amistades',uid);
      const [a,b,perfil]=await Promise.all([tx.get(mia),tx.get(suya),tx.get(doc(db,'usuarios',otro))]);
      if(!perfil.exists()) throw new Error('Este jugador ya no está disponible.');
      const r=a.exists()?a.data():null,espejo=b.exists()?b.data():null;
      if(accion==='solicitar'){
        if(r?.estado==='amigos') throw new Error('Ya son amigos.');
        if(r?.estado==='pendiente') throw new Error('Ya hay una solicitud pendiente. Podés responder desde Amigos.');
        if(espejo) throw new Error('La amistad cambió. Volvé a abrir Amigos.');
        const datos={estado:'pendiente',solicitanteUid:uid,creadoEn:serverTimestamp()};
        tx.set(mia,datos);tx.set(suya,datos);
        tx.set(doc(db,'usuarios',otro,'notificaciones','amistad_'+uid),{
          tipo:'amistad_solicitud',deUid:uid,texto:state.perfil.nombre+' te envió una solicitud de amistad.',visto:false,creadoEn:serverTimestamp()
        });
      }else{
        if(!r || !espejo || r.estado!==espejo.estado || r.solicitanteUid!==espejo.solicitanteUid) throw new Error('Esta solicitud ya cambió. Volvé a abrir Amigos.');
        if(accion==='aceptar'||accion==='rechazar'){
          if(r.estado!=='pendiente'||r.solicitanteUid!==otro) throw new Error('No hay una solicitud recibida pendiente.');
        }else if(accion==='cancelar'){
          if(r.estado!=='pendiente'||r.solicitanteUid!==uid) throw new Error('Esta solicitud ya fue respondida.');
        }else if(accion==='eliminar' && r.estado!=='amigos') throw new Error('Ya no son amigos.');
        if(accion==='aceptar'){
          tx.update(mia,{estado:'amigos'});tx.update(suya,{estado:'amigos'});
          tx.set(doc(db,'usuarios',otro,'notificaciones','amistad_aceptada_'+uid),{
            tipo:'amistad_aceptada',deUid:uid,texto:state.perfil.nombre+' aceptó tu solicitud. Ya pueden compartir partidos.',visto:false,creadoEn:serverTimestamp()
          });
        }else{tx.delete(mia);tx.delete(suya);}
      }
    });
    window.mostrarAviso(({solicitar:'Solicitud enviada.',aceptar:'Ahora son amigos.',rechazar:'Solicitud rechazada.',cancelar:'Solicitud cancelada.',eliminar:'Amigo eliminado.'})[accion],'success');
  }finally{ocupados.delete(otro);}
}

function urlPartido(id){
  if(!idValido(id)) throw new Error('El enlace del partido no es válido.');
  const url=new URL(window.location.href);url.search='';url.hash='';url.searchParams.set('partido',id);return url.href;
}
window.compartirPartidoActual=()=>{
  const p=state.partidos[state.idx];if(p) window.compartirPartido(p.id);
};
window.compartirPartido=partidoId=>{
  const p=state.partidos.find(p=>p.id===partidoId);
  if(!p||!state.usuario) return;
  if(getEstadoPartido(p) !== 'activo'){window.mostrarAviso('Solo podés compartir partidos que todavía no empezaron.');return;}
  cerrarCompartir?.();
  const uid=state.usuario.uid,url=urlPartido(partidoId);
  const dialogo=document.createElement('dialog');dialogo.className='social-dialog';
  dialogo.setAttribute('aria-label','Compartir partido');
  const title=document.createElement('h2');title.textContent='Compartir partido';dialogo.append(title);
  texto(dialogo,p.cancha+' · '+fechaPartido(p.fecha)+' · '+p.hora);
  const mensaje='¿Jugamos? '+p.cancha+' · '+fechaPartido(p.fecha)+' a las '+p.hora;
  const enlace=document.createElement('input');enlace.className='form-input';enlace.readOnly=true;enlace.value=url;enlace.setAttribute('aria-label','Enlace del partido');
  const acciones=document.createElement('div');acciones.className='social-actions';acciones.style.margin='14px 0';
  const puedeCompartir=()=>{
    const actual=state.partidos.find(partido=>partido.id===partidoId);
    if(actual && getEstadoPartido(actual)==='activo') return true;
    window.mostrarAviso('Este partido ya no está disponible para compartir.');
    cerrarCompartir?.();return false;
  };
  acciones.append(boton('Compartir enlace',async()=>{
    if(!puedeCompartir()) return;
    if(navigator.share){
      try{await navigator.share({title:'Partido en '+p.cancha,text:mensaje,url});return;}
      catch(e){if(e.name==='AbortError') return;}
    }
    try{await navigator.clipboard.writeText(url);window.mostrarAviso('Enlace copiado.','success');}
    catch{enlace.focus();enlace.select();window.mostrarAviso('Mantené presionado el enlace para copiarlo.');}
  },true),boton('Copiar link',async()=>{
    if(!puedeCompartir()) return;
    try{await navigator.clipboard.writeText(url);window.mostrarAviso('Enlace copiado.','success');}
    catch{enlace.focus();enlace.select();window.mostrarAviso('Mantené presionado el enlace para copiarlo.');}
  }));
  dialogo.append(acciones,enlace);
  encabezado(dialogo,'Enviar a un amigo');
  texto(dialogo,'Le llegará al chat en Amigos y también a la campana de Futinder.');
  const lista=document.createElement('div');dialogo.append(lista);
  const amigos=relaciones.filter(r=>r.estado==='amigos');
  if(!amigos.length){
    texto(lista,'Agregá amigos para enviarles partidos dentro de Futinder.');
    lista.append(boton('Ir a Amigos',()=>{cerrar();window.verAmigos();}));
  }
  for(const amigo of amigos){
    const fila=document.createElement('div');fila.className='social-row';lista.append(fila);
    const nombre=document.createElement('span');nombre.textContent='Cargando…';nombre.style.flex='1';fila.append(nombre);
    perfilDe(amigo.uid).then(datos=>{if(fila.isConnected)nombre.textContent=datos.nombre||'Jugador';}).catch(()=>{nombre.textContent='Jugador';});
    const estadoEnvio=texto(fila,'');estadoEnvio.setAttribute('role','status');estadoEnvio.style.cssText='flex-basis:100%;margin-top:4px';
    const enviar=boton('Enviar',async()=>{
      estadoEnvio.textContent='Enviando…';
      try{
      sesion(uid);
      const nuevo=await runTransaction(db,async tx=>{
        sesion(uid);
        const amistad=await tx.get(doc(db,'usuarios',uid,'amistades',amigo.uid));
        const reciproca=await tx.get(doc(db,'usuarios',amigo.uid,'amistades',uid));
        const partido=await tx.get(doc(db,'partidos',partidoId));
        if(!amistad.exists()||amistad.data().estado!=='amigos'||!reciproca.exists()||reciproca.data().estado!=='amigos') throw new Error('Solo podés enviar partidos a tus amigos.');
        if(!partido.exists()) throw new Error('Este partido ya no está disponible.');
        const actual=partido.data();
        if(getEstadoPartido(actual) !== 'activo') throw new Error('Solo podés enviar partidos que todavía no empezaron.');
        const ref=doc(db,'usuarios',amigo.uid,'notificaciones',partidoId+'_compartido_'+uid+'_'+(actual.versionHorario||0));
        const previo=await tx.get(ref);
        guardarMensajePrivado(tx,uid,amigo.uid,{tipo:'partido',texto:'',partidoId,cancha:actual.cancha,fecha:actual.fecha,hora:actual.hora});
        if(previo.exists()) return false;
        tx.set(ref,{tipo:'partido_compartido',partidoId,deUid:uid,
          texto:state.perfil.nombre+' te compartió un partido en '+actual.cancha+' para el '+fechaPartido(actual.fecha)+' a las '+actual.hora+'.',
          visto:false,creadoEn:serverTimestamp()});
        return true;
      });
      if(state.usuario?.uid!==uid)return;
      enviar.textContent='Enviado';enviar.onclick=null;
      estadoEnvio.textContent='Listo. El partido está en su chat de Amigos.';
      window.mostrarAviso('Partido enviado al chat.','success');
      }catch(e){
        estadoEnvio.textContent=e.code==='permission-denied'?'No se pudo enviar: Firebase rechazó la operación. Revisá las reglas publicadas.':e.message||'No se pudo enviar. Intentá de nuevo.';
        throw e;
      }
    },true);fila.append(enviar);
  }
  const overflow=document.body.style.overflow,origen=document.activeElement;
  let cerrado=false;
  const cerrar=()=>{
    if(cerrado) return;cerrado=true;dialogo.close();dialogo.remove();document.body.style.overflow=overflow;cerrarCompartir=null;
    if(origen?.isConnected)origen.focus({preventScroll:true});
  };
  dialogo.append(boton('Volver',cerrar));
  dialogo.addEventListener('cancel',e=>{e.preventDefault();cerrar();});dialogo.addEventListener('close',cerrar);
  cerrarCompartir=cerrar;document.body.append(dialogo);document.body.style.overflow='hidden';dialogo.showModal();
};

window.abrirPartidoCompartido=async id=>{
  if(!idValido(id)){window.mostrarAviso('El enlace del partido no es válido.','error');return;}
  if(!state.usuario || !state.perfil){enlacePendiente=id;window.cambiarPantalla('login');return;}
  const uid=state.usuario.uid;
  try{
    const snap=await getDoc(doc(db,'partidos',id));if(state.usuario?.uid!==uid)return;
    if(!snap.exists()){window.mostrarAviso('Este partido ya no está disponible.');window.irHome();return;}
    const p={...snap.data(),id};let i=state.partidos.findIndex(p=>p.id===id);
    if(i<0){state.partidos.push(p);i=state.partidos.length-1;}else state.partidos[i]=p;
    if(p.creadorUid===uid)window.verDetalle(i);
    else if((p.confirmados||[]).some(c=>typeof c==='string'?c===state.perfil.nombre:c.uid?c.uid===uid:c.nombre===state.perfil.nombre))window.verInfoPartido(i);
    else window.mostrarTarjetaCompartida(id);
  }catch(e){avisoError(e);}
};
window.procesarEnlaceCompartido=async()=>{
  if(!enlacePendiente || abriendoEnlace || !state.usuario || !state.perfil)return;
  const id=enlacePendiente;enlacePendiente=null;abriendoEnlace=true;
  try{
    await window.abrirPartidoCompartido(id);
    const url=new URL(window.location.href);url.searchParams.delete('partido');window.history.replaceState(window.history.state,'',url);
  }finally{abriendoEnlace=false;}
};

window.actualizarBotonesAmistad=()=>{
  for(const b of document.querySelectorAll('[data-amigo-partido]')){
    const otro=b.dataset.amigoPartido;
    b.onclick=null;
    const mostrar=(icono,etiqueta)=>{
      b.textContent=icono;b.title=etiqueta;b.setAttribute('aria-label',etiqueta);
    };
    if(!amistadesCargadas || socialUid!==state.usuario?.uid){mostrar('…','Cargando amistad');b.disabled=true;continue;}
    const r=relacion(otro);
    b.disabled=false;
    if(r?.estado==='amigos'){mostrar('✓','Ya son amigos');b.disabled=true;}
    else if(r?.estado==='pendiente' && r.solicitanteUid===socialUid){mostrar('⏳','Solicitud de amistad enviada');b.disabled=true;}
    else if(r?.estado==='pendiente'){
      mostrar('📩','Ver solicitud de amistad recibida');
      b.onclick=()=>window.verAmigos('solicitudes');
    }else{
      mostrar('👥','Agregar amigo');
      b.onclick=async()=>{
        if(b.disabled) return;
        b.disabled=true;mostrar('…','Enviando solicitud de amistad');
        try{
          await cambiarAmistad(otro,'solicitar');
          mostrar('⏳','Solicitud de amistad enviada');b.disabled=true;
        }catch(e){avisoError(e);window.actualizarBotonesAmistad();}
      };
    }
  }
};

let cerrarMenuPersona=null;
const escaparPersona=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.botonOpcionesPersonaHTML=(uid,nombre)=>{
  if(!idValido(uid)||uid===state.usuario?.uid)return '';
  return '<button type="button" class="person-options" aria-label="Opciones de '+escaparPersona(nombre||'jugador')+'" aria-haspopup="dialog" data-uid="'+escaparPersona(uid)+'" data-nombre="'+escaparPersona(nombre||'Jugador')+'" onclick="event.stopPropagation();abrirOpcionesPersona(this)">⋯</button>';
};
window.abrirOpcionesPersona=async origen=>{
  const uid=state.usuario?.uid,otro=origen.dataset.uid,nombre=origen.dataset.nombre||'Jugador';
  if(!uid||!idValido(otro)||uid===otro)return;
  cerrarMenuPersona?.();
  const d=document.createElement('dialog');d.className='social-dialog person-options-dialog';d.setAttribute('aria-label','Opciones de '+nombre);
  const titulo=document.createElement('h2');titulo.textContent=nombre;d.append(titulo);
  let cerrado=false;
  const cerrar=()=>{if(cerrado)return;cerrado=true;d.close();d.remove();cerrarMenuPersona=null;if(origen.isConnected)origen.focus({preventScroll:true});};
  cerrarMenuPersona=cerrar;
  const amigo=boton('Cargando amistad…',()=>{});amigo.disabled=true;d.append(amigo);
  const reporte=boton('Reportar usuario',()=>{cerrar();window.reportarContenido('usuario',otro,nombre);});reporte.classList.add('person-report');d.append(reporte);
  d.append(boton('Volver',cerrar));
  d.addEventListener('cancel',e=>{e.preventDefault();cerrar();});
  d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)cerrar();}});
  document.body.append(d);d.showModal();
  try{
    const snap=await getDoc(doc(db,'usuarios',uid,'amistades',otro));
    if(cerrado||state.usuario?.uid!==uid)return;
    const r=snap.exists()?snap.data():null;
    if(r?.estado==='amigos'){amigo.textContent='Ya son amigos';return;}
    if(r?.estado==='pendiente'&&r.solicitanteUid===uid){amigo.textContent='Solicitud enviada';return;}
    amigo.disabled=false;
    if(r?.estado==='pendiente'){
      amigo.textContent='Ver solicitud de amistad';
      amigo.onclick=()=>{cerrar();window.cerrarModal?.();window.verAmigos('solicitudes');};
    }else{
      amigo.textContent='Agregar amigo';
      amigo.onclick=async()=>{
        if(amigo.disabled)return;amigo.disabled=true;
        try{sesion(uid);await cambiarAmistad(otro,'solicitar');if(!cerrado)amigo.textContent='Solicitud enviada';}
        catch(e){avisoError(e);if(!cerrado)amigo.disabled=false;}
      };
    }
  }catch(e){if(!cerrado){amigo.textContent='No se pudo consultar la amistad';}}
};

let chatsPrivados=[],stopChats=null,stopLecturas=null,lecturasChats=new Map(),errorChats='',cerrarChatPrivado=null;
const lecturasEnCurso=new Set();
function chatSinLeer(chat,uid=state.usuario?.uid){return Boolean(chat.recibidos?.[uid]&&lecturasChats.get(chat.id)!==chat.recibidos[uid]);}
window.novedadesSocial = () => ({
  chats: chatsPrivados.some(c=>chatSinLeer(c)),
  solicitudes: relaciones.some(r=>r.estado==='pendiente' && r.solicitanteUid!==state.usuario?.uid)
});
function actualizarContadorChats(){
 window.actualizarPuntosNav?.();
 const total=chatsPrivados.filter(c=>chatSinLeer(c)).length,tab=document.getElementById('tabChatsAmigos');
 if(tab){tab.textContent='Chats';if(total){const b=document.createElement('span');b.className='chat-unread-count';b.textContent=total;tab.append(b);}tab.setAttribute('aria-label','Chats, '+total+' conversaciones sin leer');}
}
function refrescarChats(){actualizarContadorChats();if(tabAmigos==='chats'&&document.getElementById('amigos').classList.contains('active'))void renderAmigos();}
function detenerChatsPrivados(){stopChats?.();stopLecturas?.();stopChats=null;stopLecturas=null;lecturasChats=new Map();chatsPrivados=[];errorChats='';cerrarChatPrivado?.();actualizarContadorChats();}
function iniciarChatsPrivados(uid){
  errorChats='Cargando conversaciones…';
  stopLecturas=onSnapshot(collection(db,'usuarios',uid,'lecturasChats'),snap=>{
    if(state.usuario?.uid!==uid)return;lecturasChats=new Map(snap.docs.map(d=>[d.id,d.data().ultimoId]));refrescarChats();
  },()=>{if(state.usuario?.uid===uid)window.mostrarAviso('No se pudo sincronizar lo leído. Revisá las reglas de Firebase.','error');});
  stopChats=onSnapshot(query(collection(db,'conversaciones'),where('participantes','array-contains',uid)),snap=>{
    if(state.usuario?.uid!==uid)return;
    chatsPrivados=snap.docs.map(d=>({...d.data(),id:d.id})).sort((a,b)=>(b.actualizadoEn?.seconds||0)-(a.actualizadoEn?.seconds||0));
    errorChats='';
    refrescarChats();
  },()=>{
    if(state.usuario?.uid!==uid)return;
    errorChats='No se pudieron cargar los chats. Revisá la conexión y que las reglas nuevas estén publicadas en Firebase.';
    if(tabAmigos==='chats')void renderAmigos();
  });
}
async function renderChatsPrivados(cont,uid,version){
  if(errorChats)texto(cont,errorChats);
  const vistos=new Set(),items=[];
  const ordenados=[...chatsPrivados].sort((a,b)=>Number(chatSinLeer(b,uid))-Number(chatSinLeer(a,uid))||(b.actualizadoEn?.seconds||0)-(a.actualizadoEn?.seconds||0));
  for(const chat of ordenados){const otro=chat.participantes.find(p=>p!==uid);if(otro){vistos.add(otro);items.push({uid:otro,preview:chat.ultimoTexto,chat,sinLeer:chatSinLeer(chat,uid)});}}
  for(const amigo of relaciones.filter(r=>r.estado==='amigos'))if(!vistos.has(amigo.uid))items.push({uid:amigo.uid,preview:'Empezá una conversación'});
  if(!items.length&&!errorChats)texto(cont,'Agregá un amigo para chatear y compartir partidos.');
  for(const item of items){
    const datos=await perfilDe(item.uid).catch(()=>({nombre:'Jugador'}));
    if(version!==renderGeneracion||state.usuario?.uid!==uid)return;
    const fila=boton('',()=>window.abrirChatAmigo(item.uid));fila.className='friend-chat-row'+(item.sinLeer?' is-unread':'');
    if(item.sinLeer){fila.setAttribute('aria-label',(datos.nombre||'Jugador')+', mensajes sin leer');const marca=document.createElement('span');marca.className='chat-unread-dot';marca.setAttribute('aria-hidden','true');fila.append(marca);}
    const avatar=document.createElement('span');avatar.className='social-avatar';avatar.textContent=(datos.nombre||'?')[0];
    if(typeof datos.foto==='string'&&/^(https?:\/\/|data:image\/jpeg;base64,)/.test(datos.foto)){const img=document.createElement('img');img.className='social-avatar';img.src=datos.foto;img.alt='';img.onerror=()=>img.replaceWith(avatar);fila.append(img);}else fila.append(avatar);
    const info=document.createElement('span');info.className='friend-chat-preview';
    const nombre=document.createElement('strong');nombre.textContent=datos.nombre||'Jugador';info.append(nombre);
    const preview=texto(info,item.preview||'Conversación');fila.append(info);cont.append(fila);
    if(item.chat){
      const mostrarAutor=autor=>{preview.textContent=(autor===uid?'Vos':autor===item.uid?(datos.nombre||'Jugador'): 'Mensaje')+': '+(item.preview||'Partido compartido');};
      if(item.chat.recibidos?.[item.uid]===item.chat.ultimoId)mostrarAutor(uid);
      else if(item.chat.recibidos?.[uid]===item.chat.ultimoId)mostrarAutor(item.uid);
      else if(item.chat.ultimoId){
        // Conversaciones anteriores a los recibos de lectura: consultar solo
        // el último mensaje, sin agregar campos ni cambiar las reglas.
        void getDoc(doc(db,'conversaciones',item.chat.id,'mensajes',item.chat.ultimoId)).then(s=>{
          if(s.exists()&&version===renderGeneracion&&state.usuario?.uid===uid)mostrarAutor(s.data().uid);
        }).catch(()=>{});
      }
    }
  }
}
function idChatPrivado(a,b){return [a,b].sort().join('__');}
function guardarMensajePrivado(tx,uid,otro,contenido){
  const participantes=[uid,otro].sort(),ref=doc(db,'conversaciones',idChatPrivado(uid,otro));
  const mensaje=doc(collection(db,'conversaciones',idChatPrivado(uid,otro),'mensajes'));
  const ultimoTexto=contenido.tipo==='partido'?'⚽ '+contenido.cancha:contenido.texto;
  tx.set(mensaje,{...contenido,uid,creadoEn:serverTimestamp()});
  tx.set(ref,{participantes,ultimoTexto,ultimoId:mensaje.id,actualizadoEn:serverTimestamp(),recibidos:{[otro]:mensaje.id}},{merge:true});
  if(contenido.tipo==='texto')tx.set(doc(db,'usuarios',otro,'notificaciones','chat_'+uid),{
    tipo:'mensaje_privado',deUid:uid,chatId:idChatPrivado(uid,otro),mensajeId:mensaje.id,
    texto:(state.perfil?.nombre||'Tu amigo')+' te escribió: '+contenido.texto.slice(0,120),visto:false,creadoEn:serverTimestamp()
  });
}
window.abrirChatAmigo=async otro=>{
  const uid=state.usuario?.uid;if(!uid||!idValido(otro)||otro===uid)return;
  cerrarChatPrivado?.();
  const dialogo=document.createElement('dialog');dialogo.className='friend-chat-dialog';dialogo.setAttribute('aria-label','Chat privado');
  const header=document.createElement('header');header.className='friend-chat-header';
  const titulo=document.createElement('strong');titulo.textContent='Chat';
  let cerrado=false,stop=null,cantidad=100,primera=true,ultimoRecibido=null,salirNavegacion=null;
  const tarjetasPartidos=new Map();
  const refrescarTarjetas=()=>{if(!cerrado)for(const actualizar of tarjetasPartidos.values())actualizar();};
  const relojTarjetas=setInterval(refrescarTarjetas,15000);
  window.addEventListener('futinder-partidos-actualizados',refrescarTarjetas);
  const marcarLeido=()=>{if(!cerrado&&!document.hidden&&ultimoRecibido)void leerChatPrivado(uid,otro,ultimoRecibido);};
  document.addEventListener('visibilitychange',marcarLeido);
  const ajustar=()=>{dialogo.style.height=(window.visualViewport?.height||window.innerHeight)+'px';dialogo.style.top=(window.visualViewport?.offsetTop||0)+'px';};
  const cerrar=()=>{if(cerrado)return;cerrado=true;salirNavegacion?.();stop?.();clearInterval(relojTarjetas);window.removeEventListener('futinder-partidos-actualizados',refrescarTarjetas);tarjetasPartidos.clear();document.removeEventListener('visibilitychange',marcarLeido);window.visualViewport?.removeEventListener('resize',ajustar);window.visualViewport?.removeEventListener('scroll',ajustar);window.removeEventListener('resize',ajustar);dialogo.close();dialogo.remove();cerrarChatPrivado=null;};
  cerrarChatPrivado=cerrar;header.append(boton('←',cerrar),titulo);dialogo.append(header);
  const lista=document.createElement('div');lista.className='friend-chat-messages';dialogo.append(lista);
  const estado=document.createElement('p');estado.className='social-help friend-chat-status';estado.setAttribute('role','status');dialogo.append(estado);
  const form=document.createElement('form');form.className='friend-chat-form';
  const input=document.createElement('input');input.className='form-input';input.placeholder='Escribí un mensaje…';input.maxLength=2000;input.setAttribute('aria-label','Mensaje');input.autocomplete='off';
  const enviar=document.createElement('button');enviar.className='social-action primary';enviar.type='submit';enviar.textContent='Enviar';form.append(input,enviar);dialogo.append(form);
  form.onsubmit=async e=>{
    e.preventDefault();const mensaje=input.value.trim();if(!mensaje||enviar.disabled)return;
    enviar.disabled=true;estado.textContent='Enviando…';
    try{
      await runTransaction(db,async tx=>{
        sesion(uid);
        const a=await tx.get(doc(db,'usuarios',uid,'amistades',otro)),b=await tx.get(doc(db,'usuarios',otro,'amistades',uid));
        if(!a.exists()||!b.exists()||a.data().estado!=='amigos'||b.data().estado!=='amigos')throw new Error('Solo podés enviar mensajes a tus amigos.');
        guardarMensajePrivado(tx,uid,otro,{tipo:'texto',texto:mensaje,partidoId:'',cancha:'',fecha:'',hora:''});
      });
      if(!cerrado&&state.usuario?.uid===uid){if(input.value.trim()===mensaje)input.value='';estado.textContent='';input.focus();}
    }catch(e){if(!cerrado)estado.textContent=e.code==='permission-denied'?'No se pudo enviar. Revisá la amistad y las reglas publicadas de Firebase.':e.message||'No se pudo enviar.';}
    finally{enviar.disabled=false;}
  };
  const escuchar=()=>{
    stop?.();estado.textContent='Cargando mensajes…';
    stop=onSnapshot(query(collection(db,'conversaciones',idChatPrivado(uid,otro),'mensajes'),orderBy('creadoEn','desc'),limit(cantidad)),snap=>{
      if(cerrado||state.usuario?.uid!==uid)return;
      ultimoRecibido=snap.docs.find(d=>d.data().uid!==uid)?.id||null;
      marcarLeido();
      const bajar=primera||lista.scrollHeight-lista.scrollTop-lista.clientHeight<80;
      const anterior=lista.scrollHeight,scroll=lista.scrollTop;tarjetasPartidos.clear();lista.replaceChildren();estado.textContent='';
      if(snap.size===cantidad)lista.append(boton('Ver mensajes anteriores',()=>{cantidad+=100;escuchar();}));
      for(const item of [...snap.docs].reverse()){
        const m=item.data(),bubble=document.createElement('div');bubble.className='friend-message'+(m.uid===uid?' own':'');
        if(m.tipo==='partido'){
          bubble.classList.add('shared-match-message');
          const tarjeta=document.createElement('div');tarjeta.className='shared-match-card';
          const foto=document.createElement('img');foto.alt='';foto.loading='lazy';foto.hidden=true;
          foto.onerror=()=>{foto.hidden=true;};
          const cuerpo=document.createElement('div');cuerpo.className='shared-match-body';
          const nombre=document.createElement('strong'),fecha=document.createElement('p'),cupos=document.createElement('p'),situacion=document.createElement('span');
          situacion.className='shared-match-status';
          const abrir=boton('Ver partido',()=>{cerrar();window.abrirPartidoCompartido(m.partidoId);},true);
          cuerpo.append(nombre,fecha,cupos,situacion,abrir);tarjeta.append(foto,cuerpo);bubble.append(tarjeta);
          const actualizar=()=>{
            const p=state.partidos.find(p=>p.id===m.partidoId);
            const estado=p?getEstadoPartido(p):null;
            nombre.textContent=p?.cancha||m.cancha||'Partido compartido';
            fecha.textContent=fechaPartido(p?.fecha||m.fecha)+' · '+(p?.hora||m.hora||'');
            const url=typeof p?.canchaFoto==='string'&&/^https?:\/\//.test(p.canchaFoto)?p.canchaFoto:'';
            if(foto.dataset.url!==url){foto.dataset.url=url;foto.hidden=!url;if(url)foto.src=url;}
            const disponibles=p?Math.max(0,Number(p.max)-Number(p.jugadores)):0;
            cupos.textContent=p?'Fútbol '+p.tipo+' · '+p.jugadores+'/'+p.max+' jugadores':'';
            cupos.hidden=!p;
            situacion.textContent=!p?'Cancelado o no disponible':estado==='finalizado'?'Finalizado':estado==='en curso'?'Ya empezó':disponibles>0?disponibles+' lugar'+(disponibles===1?' disponible':'es disponibles'):'Completo';
            situacion.classList.toggle('available',!!p&&estado==='activo'&&disponibles>0);
            abrir.disabled=!p;abrir.textContent=p?'Ver partido':'No disponible';
          };
          tarjetasPartidos.set(item.id,actualizar);actualizar();
        }else{const contenido=document.createElement('p');contenido.textContent=m.texto;bubble.append(contenido);}
        bubble.append(horaMensaje(m.creadoEn));
        const fila=document.createElement('div');fila.className='message-row'+(m.uid===uid?' own':'');
        fila.append(avatarMensaje(m.uid,m.uid===uid?state.perfil?.nombre:titulo.textContent),bubble);
        lista.append(fila);
      }
      if(!snap.size)texto(lista,'Todavía no hay mensajes. ¡Saludá a tu amigo!');
      lista.scrollTop=bajar?lista.scrollHeight:scroll+Math.max(0,lista.scrollHeight-anterior);primera=false;
    },()=>{if(!cerrado)estado.textContent='No se pudo leer el chat. Revisá la conexión y publicá las reglas nuevas de Firebase.';});
  };
  document.body.append(dialogo);dialogo.showModal();salirNavegacion=window.registrarDialogoNavegacion?.(cerrar);ajustar();window.visualViewport?.addEventListener('resize',ajustar);window.visualViewport?.addEventListener('scroll',ajustar);window.addEventListener('resize',ajustar);dialogo.addEventListener('cancel',e=>{e.preventDefault();cerrar();});
  perfilDe(otro).then(p=>{if(!cerrado)titulo.textContent=p.nombre||'Jugador';}).catch(()=>{});
  // Crear el encabezado al primer mensaje; sin conversación aún, no consultar su subcolección.
  const existente=await getDoc(doc(db,'conversaciones',idChatPrivado(uid,otro))).catch(()=>null);
  if(cerrado)return;
  if(existente?.exists())escuchar();
  else{
    texto(lista,'Escribí para empezar la conversación.');
    // La lista de conversaciones se actualiza al primer envío de cualquiera de los dos.
    stop=onSnapshot(query(collection(db,'conversaciones'),where('participantes','array-contains',uid)),snap=>{
      if(!cerrado&&snap.docs.some(d=>d.id===idChatPrivado(uid,otro)))escuchar();
    },()=>{if(!cerrado)estado.textContent='Publicá las reglas nuevas de Firebase para habilitar los chats.';});
  }
};

async function leerChatPrivado(uid,otro,ultimoId){
  const chatId=idChatPrivado(uid,otro),clave=uid+':'+chatId+':'+ultimoId;
  if(state.usuario?.uid!==uid||lecturasChats.get(chatId)===ultimoId||lecturasEnCurso.has(clave))return;
  lecturasEnCurso.add(clave);
  try{
    await runTransaction(db,async tx=>{
      sesion(uid);
      const aviso=doc(db,'usuarios',uid,'notificaciones','chat_'+otro),snap=await tx.get(aviso);
      const recibo=doc(db,'usuarios',uid,'lecturasChats',chatId),previo=await tx.get(recibo);
      const chat=await tx.get(doc(db,'conversaciones',chatId));
      if(!chat.exists()||chat.data().recibidos?.[uid]!==ultimoId)return;
      if(!previo.exists()||previo.data().ultimoId!==ultimoId)tx.set(recibo,{ultimoId,leidoEn:serverTimestamp()});
      if(snap.exists()&&snap.data().mensajeId===ultimoId&&!snap.data().visto)tx.update(aviso,{visto:true});
    });
  }catch(e){if(state.usuario?.uid===uid)window.mostrarAviso('No se pudo guardar la lectura del chat. Volvé a abrirlo para reintentar.','error');}
  finally{lecturasEnCurso.delete(clave);}
}
