import { state } from './state.js';
import { db, doc, getDoc, collection, onSnapshot, runTransaction, serverTimestamp } from './firebase.js';
import { esAdmin } from './admin.js';
let unsubscribe=null, reportes=[], errorCarga='', cerrarReporte=null, generacion=0;
const motivos=['Conducta inapropiada','Información falsa','Spam','Otro motivo'];
function texto(parent,tag,value){const el=document.createElement(tag);el.textContent=value;parent.append(el);return el;}
function boton(parent,label,action){const b=texto(parent,'button',label);b.type='button';b.className='social-action';b.style.minHeight='44px';b.onclick=action;return b;}
window.reportarContenido=(tipo,id,nombre='')=>{
  const uid=state.usuario?.uid;
  if(!uid || !['partido','usuario'].includes(tipo) || typeof id!=='string' || !id || id.includes('/') || (tipo==='usuario' && id===uid)) return;
  cerrarReporte?.();
  const d=document.createElement('dialog');d.className='social-dialog';d.setAttribute('aria-label','Enviar reporte');
  texto(d,'h2',tipo==='partido'?'Reportar partido':'Reportar usuario');
  texto(d,'p',nombre||'El administrador revisará tu reporte.');
  const label=texto(d,'label','Motivo');const select=document.createElement('select');select.className='form-input';label.append(select);
  for(const motivo of motivos){const o=texto(select,'option',motivo);o.value=motivo;}
  select.value=motivos[0];
  const labelDetalle=texto(d,'label','Detalle (opcional)');
  const detalle=document.createElement('textarea');detalle.className='form-input';detalle.maxLength=500;detalle.rows=3;labelDetalle.append(detalle);
  const estado=texto(d,'p','');estado.setAttribute('role','status');
  const overflow=document.body.style.overflow,origen=document.activeElement;let cerrado=false,enviando=false;
  const cerrar=()=>{if(cerrado)return;cerrado=true;d.close();d.remove();document.body.style.overflow=overflow;cerrarReporte=null;if(origen?.isConnected)origen.focus({preventScroll:true});};
  const enviar=boton(d,'Enviar reporte',async()=>{
    if(enviando)return;
    enviando=true;enviar.disabled=true;select.disabled=true;detalle.disabled=true;
    const motivo=select.value,aclaracion=detalle.value.trim().slice(0,500);
    try{
      await runTransaction(db,async tx=>{
        if(state.usuario?.uid!==uid) throw new Error('Volvé a iniciar sesión.');
        const ref=doc(db,'reportes',uid+'_'+tipo+'_'+id);
        const previo=await tx.get(ref);
        if(previo.exists()) throw new Error('Ya enviaste un reporte sobre esto.');
        const objetivo=await tx.get(doc(db,tipo==='partido'?'partidos':'usuarios',id));
        if(!objetivo.exists()) throw new Error('Este '+tipo+' ya no está disponible.');
        if(tipo==='partido' && objetivo.data().creadorUid===uid) throw new Error('No podés reportar tu propio partido.');
        const datos=objetivo.data();
        tx.set(ref,{tipo,objetivoId:id,nombre:String(tipo==='partido'?datos.cancha||'Cancha':datos.nombre||'Jugador').slice(0,120),autorUid:uid,motivo,detalle:aclaracion,estado:'pendiente',creadoEn:serverTimestamp()});
      });
      if(state.usuario?.uid===uid){cerrar();window.mostrarAviso('Reporte enviado al administrador.','success');}
    }catch(e){estado.textContent=e.code==='permission-denied'?'No se pudo enviar el reporte. Intentá de nuevo más tarde.':e.message||'No se pudo enviar el reporte.';}
    finally{enviando=false;enviar.disabled=false;select.disabled=false;detalle.disabled=false;}
  });
  boton(d,'Volver',cerrar);d.addEventListener('cancel',e=>{e.preventDefault();cerrar();});
  document.body.append(d);document.body.style.overflow='hidden';cerrarReporte=cerrar;d.showModal();
};
window.reportarPartido=id=>{
  const p=state.partidos.find(p=>p.id===id);
  if(p && p.creadorUid!==state.usuario?.uid) window.reportarContenido('partido',id,p.cancha);
};
window.detenerReportesAdmin=()=>{
  window.cerrarDetalleAdmin?.();
  generacion++;unsubscribe?.();unsubscribe=null;reportes=[];errorCarga='';cerrarReporte?.();
  document.getElementById('listaAdminReportes')?.replaceChildren();
};
window.iniciarReportesAdmin=()=>{
  if(!esAdmin() || unsubscribe) return;
  const version=++generacion;
  errorCarga='Cargando reportes…';window.renderReportesAdmin();
  unsubscribe=onSnapshot(collection(db,'reportes'),snap=>{
    if(!esAdmin() || version!==generacion)return;
    reportes=snap.docs.map(d=>({...d.data(),id:d.id}));errorCarga='';window.renderReportesAdmin();
  },e=>{
    if(version!==generacion)return;
    errorCarga=e.code==='permission-denied'?'Falta habilitar el acceso del administrador a los reportes en Firebase.':'No se pudieron cargar los reportes. Volvé a entrar para reintentar.';
    unsubscribe?.();unsubscribe=null;window.renderReportesAdmin();
  });
};
window.renderReportesAdmin=()=>{
  const cont=document.getElementById('listaAdminReportes');if(!cont)return;cont.replaceChildren();if(!esAdmin())return;
  const pendientes=reportes.filter(r=>r.estado==='pendiente');
  texto(cont,'h3','Reportes pendientes · '+pendientes.length);
  if(errorCarga){texto(cont,'p',errorCarga);return;}
  if(!pendientes.length)texto(cont,'p','No hay reportes pendientes.');
  for(const r of pendientes){
    const fila=document.createElement('div');fila.className='partido-item';cont.append(fila);
    texto(fila,'strong',(r.tipo==='usuario'?'Usuario: ':'Partido: ')+(r.nombre||r.objetivoId));
    const autor=texto(fila,'p','Reportado por: cargando…');autor.className='admin-muted';
    if(r.autorUid)getDoc(doc(db,'usuarios',r.autorUid)).then(snap=>{
      if(autor.isConnected&&esAdmin())autor.textContent='Reportado por: '+(snap.exists()?snap.data().nombre||r.autorUid:'Usuario eliminado ('+r.autorUid+')');
    }).catch(()=>{if(autor.isConnected)autor.textContent='Reportado por: '+r.autorUid;});
    else autor.textContent='Reportado por: sin datos';
    texto(fila,'p',r.motivo);if(r.detalle)texto(fila,'p',r.detalle);
    const acciones=texto(fila,'div','');acciones.className='admin-actions';
    if(r.tipo==='usuario') boton(acciones,'Ver perfil',()=>window.abrirPerfilJugador(r.objetivoId,r.nombre));
    else if(state.partidos.some(p=>p.id===r.objetivoId)){
      boton(acciones,'Ver partido',()=>window.abrirDetalleAdmin(r.objetivoId));

    }else texto(fila,'p','El partido ya no está disponible.');
    const resolver=boton(acciones,'Marcar revisado',async()=>{
      if(resolver.disabled)return;
      resolver.disabled=true;
      try{
        await runTransaction(db,async tx=>{
          if(!esAdmin())throw new Error('Solo el administrador puede revisar reportes.');
          const ref=doc(db,'reportes',r.id),snap=await tx.get(ref);if(!snap.exists()||snap.data().estado!=='pendiente')return;
          tx.update(ref,{estado:'revisado',revisadoPor:state.usuario.uid,revisadoEn:serverTimestamp()});
        });
        if(esAdmin())window.mostrarAviso('Reporte marcado como revisado.','success');
      }catch(e){window.mostrarAviso('No se pudo actualizar el reporte. Revisá los permisos de Firebase.','error');resolver.disabled=false;}
    });
    if(r.tipo==='partido'&&state.partidos.some(p=>p.id===r.objetivoId)){
      const cancelar=boton(fila,'Cancelar partido',()=>{if(esAdmin())window.abrirMotivoCancelacion(r.objetivoId);});
      cancelar.classList.add('admin-danger');
    }
  }
};

