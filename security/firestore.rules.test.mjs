import {before,after,beforeEach,test} from 'node:test';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp,setLogLevel} from 'firebase/firestore';
setLogLevel('silent');
let env;
const ADMIN='CF4vDb4JcfZ7pDUOmXMKxqnjBM32';
const user=uid=>env.authenticatedContext(uid).firestore();
const ref=(db,p)=>doc(db,p);
const now=Date.now();
const profile=uid=>({uid,nombre:uid,posicion:'Arquero',bio:'',zona:'Centro',partidos:0,rating:0,calificacionesRecibidas:0,foto:null,jugadas:[]});
const game=(extra={})=>({cancha:'Cancha',creadorUid:'owner',creador:'owner',tipo:'5',max:10,jugadores:2,precio:100,
  fecha:'2026-10-24',hora:'20:00',inicioTimestamp:now+7200000,finTimestamp:now+10800000,
  confirmados:[{uid:'owner',nombre:'owner'},{uid:'player',nombre:'player'}],solicitudes:[],...extra});
const seed=async items=>env.withSecurityRulesDisabled(async c=>{const db=c.firestore();for(const [p,d]of Object.entries(items))await setDoc(ref(db,p),d);});
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-futinder-security',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{
  await env.clearFirestore();
  await seed({'usuarios/owner':profile('owner'),'usuarios/player':profile('player'),'usuarios/stranger':profile('stranger'),'partidos/m':game()});
});
test('anonymous reads and writes are denied everywhere',async()=>{
  const db=env.unauthenticatedContext().firestore();
  for(const p of ['usuarios/owner','partidos/m','reportes/r','usuarios/owner/notificaciones/n']){
    await assertFails(getDoc(ref(db,p)));await assertFails(setDoc(ref(db,p),{}));
  }
});
test('profile creation starts reputation at zero; only owner edits personal fields',async()=>{
  const db=user('new');await assertSucceeds(setDoc(ref(db,'usuarios/new'),profile('new')));
  await assertFails(setDoc(ref(user('fake'),'usuarios/fake'),{...profile('fake'),rating:5}));
  await assertSucceeds(updateDoc(ref(db,'usuarios/new'),{bio:'Hola',foto:'data:image/jpeg;base64,AAAA',consentimientoOsrm:true}));
  await assertFails(updateDoc(ref(user('stranger'),'usuarios/new'),{bio:'Alterado'}));
  await assertFails(updateDoc(ref(db,'usuarios/new'),{rating:5,calificacionesRecibidas:100}));
  await assertFails(updateDoc(ref(db,'usuarios/new'),{admin:true}));
});
test('create match, creator editing, outsider restrictions and admin cancellation',async()=>{
  const db=user('owner');
  await assertSucceeds(setDoc(ref(db,'partidos/new'),{...game({jugadores:1,confirmados:[{uid:'owner',nombre:'owner'}]}),creadoEn:serverTimestamp()}));
  await assertFails(setDoc(ref(user('stranger'),'partidos/fake'),{...game(),creadoEn:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref(db,'partidos/m'),{jugadores:4}));
  await assertFails(updateDoc(ref(user('stranger'),'partidos/m'),{jugadores:1}));
  await assertFails(updateDoc(ref(user('stranger'),'partidos/m'),{creadorUid:'stranger'}));
  await assertFails(deleteDoc(ref(user('stranger'),'partidos/m')));
  await assertSucceeds(deleteDoc(ref(user(ADMIN),'partidos/m')));
});
test('own join request and notification atomically; cannot request for another user',async()=>{
  const db=user('stranger'),s={uid:'stranger',nombre:'stranger',posicion:'Arquero'};
  let b=writeBatch(db);b.update(ref(db,'partidos/m'),{solicitudes:[s]});
  b.set(ref(db,'usuarios/owner/notificaciones/m_solicitud_stranger'),{
    tipo:'solicitud',solicitanteUid:'stranger',emisorUid:'stranger',receptorConfirmado:0,receptorSolicitud:-1,
    texto:'Solicitud',partidoId:'m',visto:false,creadoEn:serverTimestamp()});
  await assertSucceeds(b.commit());
  await assertFails(updateDoc(ref(db,'partidos/m'),{solicitudes:[s,{uid:'player',nombre:'player'}]}));
  await assertSucceeds(updateDoc(ref(db,'partidos/m'),{solicitudes:[],solicitudRetirada:s}));
});
test('creator accepts and notifies requested player; outsiders cannot accept themselves',async()=>{
  const solicitud={uid:'stranger',nombre:'stranger',posicion:'Arquero'};
  await seed({'partidos/m':game({solicitudes:[solicitud]})});
  const changes={solicitudes:[],confirmados:[...game().confirmados,{uid:'stranger',nombre:'stranger'}],jugadores:3};
  await assertFails(updateDoc(ref(user('stranger'),'partidos/m'),changes));
  const db=user('owner'),b=writeBatch(db);b.update(ref(db,'partidos/m'),changes);
  b.set(ref(db,'usuarios/stranger/notificaciones/m_aceptado_0'),{tipo:'aceptado',partidoId:'m',texto:'Aceptado',visto:false,creadoEn:serverTimestamp(),emisorUid:'owner',receptorConfirmado:-1,receptorSolicitud:0});
  await assertSucceeds(b.commit());
});
test('only own participation can be removed or reconfirmed',async()=>{
  const db=user('player'),old={uid:'player',nombre:'player'};
  await assertFails(updateDoc(ref(db,'partidos/m'),{confirmados:[old],jugadores:1,participanteModificado:{uid:'owner',nombre:'owner'}}));
  await assertSucceeds(updateDoc(ref(db,'partidos/m'),{confirmados:[{uid:'owner',nombre:'owner'}],jugadores:1,participanteModificado:old}));
  const pending={...old,pendienteReconfirmar:true};
  await seed({'partidos/m':game({confirmados:[{uid:'owner',nombre:'owner'},pending]})});
  await assertSucceeds(updateDoc(ref(db,'partidos/m'),{confirmados:[{uid:'owner',nombre:'owner'},{...old,pendienteReconfirmar:false}],jugadores:2,participanteModificado:pending}));
});
test('expired request can clear only itself and notify the sender',async()=>{
  const s={uid:'stranger',nombre:'stranger',posicion:'Arquero'};
  await seed({'partidos/m':game({inicioTimestamp:now-10000,solicitudes:[s,{uid:'another',nombre:'another'}]})});
  const db=user('stranger'),b=writeBatch(db);b.update(ref(db,'partidos/m'),{solicitudes:[{uid:'another',nombre:'another'}],solicitudRetirada:s});
  b.set(ref(db,'usuarios/stranger/notificaciones/m_solicitud_vencida_0'),{tipo:'solicitud_vencida',partidoId:'m',texto:'Vencida',visto:false,creadoEn:serverTimestamp(),emisorUid:'stranger',receptorConfirmado:-1,receptorSolicitud:0});
  await assertSucceeds(b.commit());
  await assertFails(updateDoc(ref(db,'partidos/m'),{solicitudes:[]}));
});
test('chat only confirmed users, with unforgeable author',async()=>{
  const message={uid:'player',nombre:'player',texto:'Hola',hora:serverTimestamp()};
  await assertSucceeds(setDoc(ref(user('player'),'partidos/m/mensajes/a'),message));
  await assertSucceeds(getDocs(collection(user('owner'),'partidos/m/mensajes')));
  await assertFails(getDocs(collection(user('stranger'),'partidos/m/mensajes')));
  await assertFails(setDoc(ref(user('stranger'),'partidos/m/mensajes/b'),message));
  await assertFails(updateDoc(ref(user('player'),'partidos/m/mensajes/a'),{texto:'Cambio'}));
});
test('friendship requires symmetric request and receiver acceptance',async()=>{
  const db=user('player');const data={estado:'pendiente',solicitanteUid:'player',creadoEn:serverTimestamp()};
  await assertFails(setDoc(ref(db,'usuarios/player/amistades/stranger'),data));
  let b=writeBatch(db);b.set(ref(db,'usuarios/player/amistades/stranger'),data);b.set(ref(db,'usuarios/stranger/amistades/player'),data);await assertSucceeds(b.commit());
  b=writeBatch(db);b.update(ref(db,'usuarios/player/amistades/stranger'),{estado:'amigos'});b.update(ref(db,'usuarios/stranger/amistades/player'),{estado:'amigos'});await assertFails(b.commit());
  const other=user('stranger');b=writeBatch(other);b.update(ref(other,'usuarios/player/amistades/stranger'),{estado:'amigos'});b.update(ref(other,'usuarios/stranger/amistades/player'),{estado:'amigos'});await assertSucceeds(b.commit());
  await assertFails(getDocs(collection(user('owner'),'usuarios/player/amistades')));
  b=writeBatch(other);b.delete(ref(other,'usuarios/player/amistades/stranger'));b.delete(ref(other,'usuarios/stranger/amistades/player'));await assertSucceeds(b.commit());
});
test('notifications private, recipient can mark read and delete; outsider cannot forge',async()=>{
  await seed({'usuarios/player/notificaciones/n':{tipo:'aceptado',texto:'Hi',visto:false}});
  const db=user('player');
  await assertFails(getDocs(collection(user('stranger'),'usuarios/player/notificaciones')));
  await assertSucceeds(updateDoc(ref(db,'usuarios/player/notificaciones/n'),{visto:true}));
  await assertFails(updateDoc(ref(db,'usuarios/player/notificaciones/n'),{texto:'Otro'}));
  await assertFails(setDoc(ref(user('stranger'),'usuarios/player/notificaciones/fake'),{tipo:'aceptado',texto:'Fake',visto:false,creadoEn:serverTimestamp()}));
  await assertSucceeds(deleteDoc(ref(db,'usuarios/player/notificaciones/n')));
});
test('reports can be submitted once; only admin lists or resolves them',async()=>{
  const db=user('stranger'),p='reportes/stranger_usuario_player';
  await assertSucceeds(getDoc(ref(db,p)));
  const data={tipo:'usuario',objetivoId:'player',nombre:'player',autorUid:'stranger',motivo:'Spam',detalle:'Detalle',estado:'pendiente',creadoEn:serverTimestamp()};
  await assertSucceeds(setDoc(ref(db,p),data));await assertFails(setDoc(ref(db,p),data));
  await assertFails(getDocs(collection(user('player'),'reportes')));
  await assertSucceeds(getDocs(collection(user(ADMIN),'reportes')));
  await assertFails(updateDoc(ref(db,p),{estado:'revisado',revisadoPor:'stranger',revisadoEn:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref(user(ADMIN),p),{estado:'revisado',revisadoPor:ADMIN,revisadoEn:serverTimestamp()}));
});
test('completed match count is per user, atomic and nonrepeatable',async()=>{
  await seed({'partidos/m':game({inicioTimestamp:now-100000,finTimestamp:now-1000})});
  const db=user('player');
  const batch=()=>{const b=writeBatch(db);b.set(ref(db,'usuarios/player/partidosContados/m'),{partidoId:'m',creadoEn:serverTimestamp()});
    b.update(ref(db,'usuarios/player'),{partidos:1,ultimoPartidoContado:'m'});
    b.set(ref(db,'usuarios/player/notificaciones/m_calificar'),{tipo:'calificar',partidoId:'m',texto:'Calificá',visto:false,creadoEn:serverTimestamp(),emisorUid:'player',receptorConfirmado:1,receptorSolicitud:-1});return b;};
  await assertSucceeds(batch().commit());await assertFails(batch().commit());
  await assertFails(updateDoc(ref(db,'usuarios/player'),{partidos:2,ultimoPartidoContado:'m'}));
  await assertFails(updateDoc(ref(user('stranger'),'partidos/m'),{notifRatingEnviada:true}));
});
test('rating requires real finished match and atomic exact aggregate, cannot repeat or forge stars',async()=>{
  await seed({'partidos/m':game({inicioTimestamp:now-100000,finTimestamp:now-1000})});
  const batch=(uid='player',rating=4)=>{
    const db=user(uid),b=writeBatch(db),id='m__'+uid;
    b.set(ref(db,'usuarios/owner/ratings/'+id),{de:uid,deUid:uid,estrellas:4,tags:['puntual'],partidoId:'m',autorIndice:1,jugadorIndice:0,fecha:serverTimestamp()});
    b.update(ref(db,'usuarios/owner'),{calificacionesRecibidas:1,rating,tagContadores:{puntual:1},tagsMostrar:[],ultimaOpinionId:id});
    b.update(ref(db,'partidos/m'),{calificacionesPorUid:{[uid]:['owner']},calificaciones:{[uid]:['owner']},ultimaCalificacion:{autorUid:uid,targetUid:'owner',opinionId:id}});
    return b;
  };
  await assertFails(batch('stranger').commit());await assertFails(batch('player',5).commit());
  await assertSucceeds(batch().commit());await assertFails(batch().commit());
});
test('F11 last player can chat and rate within rules evaluation limits',async()=>{
  const confirmados=[{uid:'owner',nombre:'owner'},...Array.from({length:20},(_,i)=>({uid:'f'+i,nombre:'F'+i})),{uid:'player',nombre:'player'}];
  await seed({'partidos/m':game({tipo:'11',max:22,jugadores:22,confirmados,inicioTimestamp:now-100000,finTimestamp:now-1000})});
  const db=user('player'),b=writeBatch(db);
  await assertSucceeds(getDocs(collection(db,'partidos/m/mensajes')));
  b.set(ref(db,'usuarios/owner/ratings/m__player'),{de:'player',deUid:'player',estrellas:3,tags:[],partidoId:'m',autorIndice:21,jugadorIndice:0,fecha:serverTimestamp()});
  b.update(ref(db,'usuarios/owner'),{calificacionesRecibidas:1,rating:3,tagContadores:{},tagsMostrar:[],ultimaOpinionId:'m__player'});
  b.update(ref(db,'partidos/m'),{calificacionesPorUid:{player:['owner']},calificaciones:{player:['owner']},ultimaCalificacion:{autorUid:'player',targetUid:'owner',opinionId:'m__player'}});
  await assertSucceeds(b.commit());
});
test('friend notifications and sharing work, but stranger and finished-match shares fail',async()=>{
  const db=user('player'),data={estado:'pendiente',solicitanteUid:'player',creadoEn:serverTimestamp()};
  let b=writeBatch(db);b.set(ref(db,'usuarios/player/amistades/stranger'),data);b.set(ref(db,'usuarios/stranger/amistades/player'),data);
  b.set(ref(db,'usuarios/stranger/notificaciones/amistad_player'),{tipo:'amistad_solicitud',deUid:'player',texto:'Solicitud',visto:false,creadoEn:serverTimestamp()});
  await assertSucceeds(b.commit());
  const other=user('stranger');b=writeBatch(other);b.update(ref(other,'usuarios/player/amistades/stranger'),{estado:'amigos'});b.update(ref(other,'usuarios/stranger/amistades/player'),{estado:'amigos'});
  b.set(ref(other,'usuarios/player/notificaciones/amistad_aceptada_stranger'),{tipo:'amistad_aceptada',deUid:'stranger',texto:'Amigos',visto:false,creadoEn:serverTimestamp()});
  await assertSucceeds(b.commit());
  const p='usuarios/stranger/notificaciones/m_compartido_player_0';
  await assertSucceeds(getDoc(ref(db,p)));
  const n={tipo:'partido_compartido',partidoId:'m',deUid:'player',texto:'Jugamos',visto:false,creadoEn:serverTimestamp()};
  await assertSucceeds(setDoc(ref(db,p),n));
  await assertFails(setDoc(ref(db,p),n));
  await assertFails(setDoc(ref(user('owner'),'usuarios/stranger/notificaciones/m_compartido_owner_0'),{...n,deUid:'owner'}));
  await seed({'partidos/m':game({inicioTimestamp:now-100000,finTimestamp:now-1000,versionHorario:1})});
  await assertFails(setDoc(ref(db,'usuarios/stranger/notificaciones/m_compartido_player_1'),n));
});
test('reschedule notification and reserved user response work',async()=>{
  const owner=user('owner'),pending={uid:'player',nombre:'player',pendienteReconfirmar:true};
  let b=writeBatch(owner);
  b.update(ref(owner,'partidos/m'),{fecha:'2026-10-25',hora:'21:00',inicioTimestamp:now+15000000,finTimestamp:now+18600000,confirmados:[{uid:'owner',nombre:'owner',pendienteReconfirmar:false},pending],solicitudes:[],versionHorario:1,horarioAnterior:{fecha:'2026-10-24',hora:'20:00'},notifRatingEnviada:false});
  b.set(ref(owner,'usuarios/player/notificaciones/m_horario_1'),{tipo:'reprogramado',partidoId:'m',versionHorario:1,texto:'Cambio',visto:false,creadoEn:serverTimestamp(),emisorUid:'owner',receptorConfirmado:1,receptorSolicitud:-1});
  await assertSucceeds(b.commit());
  const db=user('player');b=writeBatch(db);
  b.update(ref(db,'partidos/m'),{confirmados:[{uid:'owner',nombre:'owner',pendienteReconfirmar:false},{uid:'player',nombre:'player',pendienteReconfirmar:false}],jugadores:2,participanteModificado:pending});
  b.update(ref(db,'usuarios/player/notificaciones/m_horario_1'),{visto:true});
  b.set(ref(db,'usuarios/owner/notificaciones/m_respuesta_1_player'),{tipo:'respuesta_horario',partidoId:'m',texto:'Confirmo',visto:false,creadoEn:serverTimestamp(),emisorUid:'player',receptorConfirmado:0,receptorSolicitud:-1});
  await assertSucceeds(b.commit());
});
test('cancellation notifies confirmed and pending; outsiders cannot fake cancellation',async()=>{
  await seed({'partidos/m':game({solicitudes:[{uid:'stranger',nombre:'stranger',posicion:'Arquero'}]})});
  const db=user(ADMIN),b=writeBatch(db);b.delete(ref(db,'partidos/m'));
  for(const [uid,i,j]of [['owner',0,-1],['player',1,-1],['stranger',-1,0]]){
    b.set(ref(db,'usuarios/'+uid+'/notificaciones/m_cancelado'),{tipo:'cancelado',partidoId:'m',texto:'Cancelado',visto:false,creadoEn:serverTimestamp(),emisorUid:ADMIN,receptorConfirmado:i,receptorSolicitud:j});
  }
  await assertSucceeds(b.commit());
});
test('tag counts and visible tags cannot be forged; valid negative-tag milestone notifies',async()=>{
  await seed({'partidos/m':game({inicioTimestamp:now-100000,finTimestamp:now-1000}),'usuarios/owner':{...profile('owner'),calificacionesRecibidas:5,rating:4,tagContadores:{llega_tarde:5},tagsMostrar:['llega_tarde']}});
  const batch=(count=6,tags=['llega_tarde'])=>{
    const db=user('player'),b=writeBatch(db);
    b.set(ref(db,'usuarios/owner/ratings/m__player'),{de:'player',deUid:'player',estrellas:2,tags:['llega_tarde'],partidoId:'m',autorIndice:1,jugadorIndice:0,fecha:serverTimestamp()});
    b.update(ref(db,'usuarios/owner'),{calificacionesRecibidas:6,rating:22/6,tagContadores:{llega_tarde:count},tagsMostrar:tags,ultimaOpinionId:'m__player'});
    b.update(ref(db,'partidos/m'),{calificacionesPorUid:{player:['owner']},calificaciones:{player:['owner']},ultimaCalificacion:{autorUid:'player',targetUid:'owner',opinionId:'m__player'}});
    b.set(ref(db,'usuarios/owner/notificaciones/tag'),{tipo:'tag_malo',opinionId:'m__player',emisorUid:'player',tagId:'llega_tarde',texto:'Aviso',visto:false,creadoEn:serverTimestamp()});
    return b;
  };
  await assertFails(batch(100).commit());await assertFails(batch(6,[]).commit());await assertSucceeds(batch().commit());
});
test('F11 rating between the last two players supports three tags and fractional averages',async()=>{
  const confirmados=[{uid:'owner',nombre:'owner'},...Array.from({length:19},(_,i)=>({uid:'f'+i,nombre:'F'+i})),{uid:'stranger',nombre:'stranger'},{uid:'player',nombre:'player'}];
  await seed({'partidos/m':game({tipo:'11',max:22,jugadores:22,confirmados,inicioTimestamp:now-100000,finTimestamp:now-1000}),'usuarios/stranger':{...profile('stranger'),rating:4,calificacionesRecibidas:5,tagContadores:{llega_tarde:5,puntual:4,equipo:4},tagsMostrar:[]}});
  const db=user('player'),b=writeBatch(db);
  b.set(ref(db,'usuarios/stranger/ratings/m__player'),{de:'player',deUid:'player',estrellas:2,tags:['llega_tarde','puntual','equipo'],partidoId:'m',autorIndice:21,jugadorIndice:20,fecha:serverTimestamp()});
  b.update(ref(db,'usuarios/stranger'),{calificacionesRecibidas:6,rating:22/6,tagContadores:{llega_tarde:6,puntual:5,equipo:5},tagsMostrar:['puntual','llega_tarde','equipo'],ultimaOpinionId:'m__player'});
  b.update(ref(db,'partidos/m'),{calificacionesPorUid:{player:['stranger']},calificaciones:{player:['stranger']},ultimaCalificacion:{autorUid:'player',targetUid:'stranger',opinionId:'m__player'}});
  b.set(ref(db,'usuarios/stranger/notificaciones/tag'),{tipo:'tag_malo',opinionId:'m__player',emisorUid:'player',tagId:'llega_tarde',texto:'Aviso',visto:false,creadoEn:serverTimestamp()});
  await assertSucceeds(b.commit());
});
test('hiding a match changes only the current user visibility',async()=>{
  const db=user('player');
  await assertSucceeds(updateDoc(ref(db,'partidos/m'),{ocultoParaUid:['player']}));
  await assertFails(updateDoc(ref(db,'partidos/m'),{ocultoParaUid:['player','owner']}));
  await assertFails(updateDoc(ref(db,'partidos/m'),{ocultoPara:['owner']}));
});


test('admin can read match chat without participating but cannot send; outsiders cannot read',async()=>{
  await seed({'partidos/m/mensajes/msg':{uid:'owner',nombre:'owner',texto:'Hola',hora:new Date()}});
  await assertSucceeds(getDocs(collection(user(ADMIN),'partidos/m/mensajes')));
  await assertSucceeds(getDocs(collection(user('player'),'partidos/m/mensajes')));
  await assertFails(getDocs(collection(user('stranger'),'partidos/m/mensajes')));
  await assertFails(setDoc(ref(user(ADMIN),'partidos/m/mensajes/new'),{uid:ADMIN,nombre:'Admin',texto:'Mensaje',hora:serverTimestamp()}));
});

async function seedChatFriends(){
  await seed({'usuarios/owner/amistades/player':{estado:'amigos',solicitanteUid:'owner'},
    'usuarios/player/amistades/owner':{estado:'amigos',solicitanteUid:'owner'}});
}
function privateBatch(uid='owner',id='first',extra={},database=null){
  const db=database||user(uid),b=writeBatch(db),message={uid,tipo:'texto',texto:'Hola',partidoId:'',cancha:'',fecha:'',hora:'',creadoEn:serverTimestamp(),...extra};
  b.set(ref(db,'conversaciones/owner__player/mensajes/'+id),message);
  b.set(ref(db,'conversaciones/owner__player'),{participantes:['owner','player'],ultimoId:id,ultimoTexto:message.tipo==='partido'?'⚽ '+message.cancha:message.texto,actualizadoEn:serverTimestamp()});
  return b;
}
test('private chat requires mutual friendship and binds author',async()=>{
  await assertFails(privateBatch().commit());
  await seedChatFriends();
  await assertSucceeds(privateBatch().commit());
  await assertFails(privateBatch('stranger','fake').commit());
  await assertFails(privateBatch('player','spoof',{uid:'owner'}).commit());
});
test('private messages readable only by participants, immutable and atomic',async()=>{
  await seedChatFriends();await assertSucceeds(privateBatch().commit());
  await assertSucceeds(getDocs(collection(user('player'),'conversaciones/owner__player/mensajes')));
  await assertFails(getDocs(collection(user('stranger'),'conversaciones/owner__player/mensajes')));
  await assertFails(getDocs(collection(user(ADMIN),'conversaciones/owner__player/mensajes')));
  await assertFails(updateDoc(ref(user('owner'),'conversaciones/owner__player/mensajes/first'),{texto:'Changed'}));
  await assertFails(deleteDoc(ref(user('owner'),'conversaciones/owner__player/mensajes/first')));
  await assertFails(updateDoc(ref(user('owner'),'conversaciones/owner__player'),{ultimoTexto:'Forged'}));
  await assertSucceeds(privateBatch('player','reply',{texto:'Hola también'}).commit());
});
test('private shared match must exist, be upcoming and have accurate details',async()=>{
  await seedChatFriends();
  const details={tipo:'partido',texto:'',partidoId:'m',cancha:'Cancha',fecha:game().fecha,hora:game().hora};
  await assertSucceeds(privateBatch('owner','shared',details).commit());
  await assertFails(privateBatch('owner','wrong',{...details,cancha:'Fake'}).commit());
  await seed({'partidos/m':game({inicioTimestamp:now-3600000,finTimestamp:now-1})});
  await assertFails(privateBatch('owner','expired',details).commit());
});
test('removing friend preserves history but prevents new messages',async()=>{
  await seedChatFriends();await assertSucceeds(privateBatch().commit());
  await env.withSecurityRulesDisabled(async c=>{await deleteDoc(ref(c.firestore(),'usuarios/owner/amistades/player'));});
  await assertSucceeds(getDocs(collection(user('owner'),'conversaciones/owner__player/mensajes')));
  await assertFails(privateBatch('player','later').commit());
});

test('unread chat metadata and notice bind new incoming message and recipient',async()=>{
  await seedChatFriends();
  const db=user('owner'),b=privateBatch('owner','unread',{},db);
  b.set(ref(db,'conversaciones/owner__player'),{participantes:['owner','player'],ultimoTexto:'Hola',ultimoId:'unread',actualizadoEn:serverTimestamp(),recibidos:{player:'unread'}});
  b.set(ref(db,'usuarios/player/notificaciones/chat_owner'),{tipo:'mensaje_privado',deUid:'owner',chatId:'owner__player',mensajeId:'unread',texto:'Mensaje',visto:false,creadoEn:serverTimestamp()});
  await assertSucceeds(b.commit());
  await assertSucceeds(setDoc(ref(user('player'),'usuarios/player/lecturasChats/owner__player'),{ultimoId:'unread',leidoEn:serverTimestamp()}));
  await assertFails(getDoc(ref(user('stranger'),'usuarios/player/lecturasChats/owner__player')));
  await assertFails(setDoc(ref(user('owner'),'usuarios/player/lecturasChats/owner__player'),{ultimoId:'unread',leidoEn:serverTimestamp()}));
  await assertFails(setDoc(ref(user('player'),'usuarios/player/lecturasChats/owner__player'),{ultimoId:'fake',leidoEn:serverTimestamp()}));
  const playerDb=user('player'),reply=privateBatch('player','reply',{},playerDb);
  reply.set(ref(playerDb,'conversaciones/owner__player'),{participantes:['owner','player'],ultimoTexto:'Hola',ultimoId:'reply',actualizadoEn:serverTimestamp(),recibidos:{player:'unread',owner:'reply'}});
  await assertSucceeds(reply.commit());
  const erase=privateBatch('owner','erase');await assertFails(erase.commit());
  const forge=privateBatch('owner','forge',{},db);
  forge.set(ref(db,'conversaciones/owner__player'),{participantes:['owner','player'],ultimoTexto:'Hola',ultimoId:'forge',actualizadoEn:serverTimestamp(),recibidos:{owner:'fake',player:'forge'}});
  await assertFails(forge.commit());
});
