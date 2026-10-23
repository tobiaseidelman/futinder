import { state } from './state.js';
import { db, doc, collection, query, where, orderBy, onSnapshot, getDoc, runTransaction, serverTimestamp } from './firebase.js';
import { getDocs, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { fechaPartido, confirmarAccion } from './navigation.js';

let socialUid=null, unsubscribe=null, relaciones=[], busqueda=[], buscando=0;
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
}
function relacion(uid){return relaciones.find(r=>r.uid===uid);}
async function dibujarUsuario(parent,uid,datos){
  const fila=document.createElement('div');fila.className='social-row';parent.append(fila);
  persona(fila,uid,datos);
  const r=relacion(uid),acciones=document.createElement('div');acciones.className='social-actions';
  if(r?.estado==='amigos'){
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
async function renderAmigos(){
  const uid=socialUid,version=++renderGeneracion;
  if(!uid || state.usuario?.uid!==uid) return;
  const cont=document.getElementById('listaAmigos');
  cont.replaceChildren();
  const grupos=[
    ['Solicitudes recibidas',relaciones.filter(r=>r.estado==='pendiente'&&r.solicitanteUid!==uid)],
    ['Mis amigos',relaciones.filter(r=>r.estado==='amigos')],
    ['Solicitudes enviadas',relaciones.filter(r=>r.estado==='pendiente'&&r.solicitanteUid===uid)]
  ];
  for(const [titulo,items] of grupos){
    if(!items.length && titulo!=='Mis amigos') continue;
    encabezado(cont,titulo+' · '+items.length);
    if(!items.length) texto(cont,'Buscá a tus amigos para compartir partidos con ellos.');
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
  if(busqueda.length){
    encabezado(resultados,'Resultados');
    for(const u of busqueda) await dibujarUsuario(resultados,u.uid,u.datos);
  }
}
window.detenerSocial=()=>{
  unsubscribe?.();unsubscribe=null;socialUid=null;relaciones=[];busqueda=[];perfiles.clear();buscando++;renderGeneracion++;
  cerrarCompartir?.();
  const buscar=document.getElementById('buscarAmigoBtn');if(buscar){buscar.disabled=false;buscar.textContent='Buscar';}
  document.getElementById('listaAmigos')?.replaceChildren();
  document.getElementById('resultadosAmigos')?.replaceChildren();
};
window.iniciarSocial=()=>{
  window.detenerSocial();
  const uid=state.usuario?.uid;if(!uid) return;socialUid=uid;
  unsubscribe=onSnapshot(collection(db,'usuarios',uid,'amistades'),snap=>{
    if(socialUid!==uid||state.usuario?.uid!==uid) return;
    relaciones=snap.docs.map(d=>({...d.data(),uid:d.id}));
    if(document.getElementById('amigos').classList.contains('active')) void renderAmigos();
  },()=>{
    if(socialUid===uid) window.mostrarAviso('No pudimos cargar Amigos. Revisá la conexión y los permisos de Firebase.','error');
  });
};
window.verAmigos=()=>{
  if(!state.usuario||!state.perfil) return;
  if(socialUid!==state.usuario.uid) window.iniciarSocial();
  window.cambiarPantalla('amigos');void renderAmigos();
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
  cerrarCompartir?.();
  const uid=state.usuario.uid,url=urlPartido(partidoId);
  const dialogo=document.createElement('dialog');dialogo.className='social-dialog';
  dialogo.setAttribute('aria-label','Compartir partido');
  const title=document.createElement('h2');title.textContent='Compartir partido';dialogo.append(title);
  texto(dialogo,p.cancha+' · '+fechaPartido(p.fecha)+' · '+p.hora);
  const mensaje='¿Jugamos? '+p.cancha+' · '+fechaPartido(p.fecha)+' a las '+p.hora;
  const enlace=document.createElement('input');enlace.className='form-input';enlace.readOnly=true;enlace.value=url;enlace.setAttribute('aria-label','Enlace del partido');
  const acciones=document.createElement('div');acciones.className='social-actions';acciones.style.margin='14px 0';
  acciones.append(boton('Compartir enlace',async()=>{
    if(navigator.share){
      try{await navigator.share({title:'Partido en '+p.cancha,text:mensaje,url});return;}
      catch(e){if(e.name==='AbortError') return;}
    }
    try{await navigator.clipboard.writeText(url);window.mostrarAviso('Enlace copiado.','success');}
    catch{enlace.focus();enlace.select();window.mostrarAviso('Mantené presionado el enlace para copiarlo.');}
  },true),boton('Copiar link',async()=>{
    try{await navigator.clipboard.writeText(url);window.mostrarAviso('Enlace copiado.','success');}
    catch{enlace.focus();enlace.select();window.mostrarAviso('Mantené presionado el enlace para copiarlo.');}
  }));
  dialogo.append(acciones,enlace);
  encabezado(dialogo,'Enviar a un amigo');
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
    const enviar=boton('Enviar',async()=>{
      sesion(uid);
      await runTransaction(db,async tx=>{
        sesion(uid);
        const amistad=await tx.get(doc(db,'usuarios',uid,'amistades',amigo.uid));
        const reciproca=await tx.get(doc(db,'usuarios',amigo.uid,'amistades',uid));
        const partido=await tx.get(doc(db,'partidos',partidoId));
        if(!amistad.exists()||amistad.data().estado!=='amigos'||!reciproca.exists()||reciproca.data().estado!=='amigos') throw new Error('Solo podés enviar partidos a tus amigos.');
        if(!partido.exists()) throw new Error('Este partido ya no está disponible.');
        const actual=partido.data();
        const ref=doc(db,'usuarios',amigo.uid,'notificaciones',partidoId+'_compartido_'+uid+'_'+(actual.versionHorario||0));
        const previo=await tx.get(ref);if(previo.exists()) return;
        tx.set(ref,{tipo:'partido_compartido',partidoId,deUid:uid,
          texto:state.perfil.nombre+' te compartió un partido en '+actual.cancha+' para el '+fechaPartido(actual.fecha)+' a las '+actual.hora+'.',
          visto:false,creadoEn:serverTimestamp()});
      });
      enviar.textContent='Enviado';enviar.onclick=null;window.mostrarAviso('Partido enviado.','success');
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
    const url=new URL(window.location.href);url.searchParams.delete('partido');window.history.replaceState(null,'',url);
  }finally{abriendoEnlace=false;}
};
