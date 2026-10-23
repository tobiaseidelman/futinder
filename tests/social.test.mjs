import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../js/social.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'');
function boot(link='https://tobiaseidelman.github.io/futinder/'){
  const records=new Map([['usuarios/a',{nombre:'Ana'}],['usuarios/b',{nombre:'Beto'}]]);
  const writes=[],messages=[],nodes=new Map();
  function el(){
    return {children:[],style:{},value:'',isConnected:true,classList:{contains:()=>false},setAttribute(){},
      append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},addEventListener(){},
      showModal(){},close(){},remove(){this.isConnected=false;},focus(){},select(){}};
  }
  const document={createElement:el,getElementById:id=>{if(!nodes.has(id))nodes.set(id,el());return nodes.get(id);},body:el(),activeElement:null};
  const state={usuario:{uid:'a'},perfil:{nombre:'Ana'},partidos:[],idx:0};
  let route='',callback,shared,clipboard;
  const window={location:{href:link},history:{replaceState(_,__,url){window.location.href=String(url);}},
    mostrarAviso(msg){messages.push(msg);},cambiarPantalla:id=>route=id,irHome:()=>route='home',
    verDetalle:i=>route='creator:'+i,verInfoPartido:i=>route='info:'+i,mostrarTarjetaCompartida:id=>route='card:'+id};
  const snap=key=>({exists:()=>records.has(key),data:()=>structuredClone(records.get(key))});
  const tx=async(_,fn)=>{
    const queue=[];
    const result=await fn({get:async r=>snap(r),
      set:(r,v)=>queue.push(['set',r,v]),update:(r,v)=>queue.push(['update',r,v]),delete:r=>queue.push(['delete',r])});
    for(const [op,r,v] of queue){
      writes.push([op,r,v]);
      if(op==='delete')records.delete(r);
      else records.set(r,op==='update'?{...records.get(r),...v}:v);
    }
    return result;
  };
  const navigator={share:async data=>{shared=data;},clipboard:{writeText:async s=>{clipboard=s;}}};
  const api=new Function('state','db','doc','collection','query','where','orderBy','onSnapshot','getDoc','runTransaction','serverTimestamp','getDocs','limit','fechaPartido','confirmarAccion','window','document','navigator',source+'\nreturn {cambiarAmistad,urlPartido};')
  (state,{},(_, ...p)=>p.join('/'),(_, ...p)=>p.join('/'),()=>{},()=>{},()=>{},(_,cb)=>{callback=cb;return ()=>{};},async r=>snap(r),tx,()=>123,async()=>({docs:[]}),()=>{},s=>s,async()=>true,window,document,navigator);
  return {api,state,records,writes,window,document,messages,get route(){return route;},get shared(){return shared;},
    setRelations(list){callback({docs:list.map(r=>({id:r.uid,data:()=>r}))});}};
}
test('friendship requires a request and receiver acceptance, then supports removal',async()=>{
  const b=boot();
  await b.api.cambiarAmistad('a','solicitar');assert.equal(b.writes.length,0);
  await b.api.cambiarAmistad('b','solicitar');
  assert.equal(b.records.get('usuarios/a/amistades/b').estado,'pendiente');
  assert.equal(b.records.get('usuarios/b/amistades/a').solicitanteUid,'a');
  await assert.rejects(b.api.cambiarAmistad('b','solicitar'));
  await assert.rejects(b.api.cambiarAmistad('b','aceptar'));
  b.state.usuario.uid='b';b.state.perfil.nombre='Beto';
  await b.api.cambiarAmistad('a','aceptar');
  assert.equal(b.records.get('usuarios/a/amistades/b').estado,'amigos');
  assert.equal(b.records.get('usuarios/b/amistades/a').estado,'amigos');
  await b.api.cambiarAmistad('a','eliminar');
  assert.equal(b.records.has('usuarios/a/amistades/b'),false);
  assert.equal(b.records.has('usuarios/b/amistades/a'),false);
});
test('sender can cancel; receiver can reject; stale requests cannot be accepted',async()=>{
  const b=boot();await b.api.cambiarAmistad('b','solicitar');
  await b.api.cambiarAmistad('b','cancelar');
  b.state.usuario.uid='b';await assert.rejects(b.api.cambiarAmistad('a','aceptar'));
  b.state.usuario.uid='a';await b.api.cambiarAmistad('b','solicitar');
  b.state.usuario.uid='b';await b.api.cambiarAmistad('a','rechazar');
  assert.equal(b.records.has('usuarios/a/amistades/b'),false);
});
test('links preserve GitHub Pages path and remove unrelated parameters',()=>{
  const b=boot('https://tobiaseidelman.github.io/futinder/?other=1#old');
  assert.equal(b.api.urlPartido('match_1'),'https://tobiaseidelman.github.io/futinder/?partido=match_1');
  assert.throws(()=>b.api.urlPartido('../bad'));
});
test('shared match survives sign in, ignores filters, and never enrolls automatically',async()=>{
  const b=boot('https://tobiaseidelman.github.io/futinder/?partido=p');
  b.records.set('partidos/p',{cancha:'Cancha',creadorUid:'b',confirmados:[],solicitudes:[],jugadores:9,max:10});
  b.state.usuario=null;b.state.perfil=null;
  await b.window.procesarEnlaceCompartido();assert.equal(b.route,'');
  b.state.usuario={uid:'a'};b.state.perfil={nombre:'Ana'};
  await b.window.procesarEnlaceCompartido();
  assert.equal(b.route,'card:p');assert.equal(b.writes.length,0);
  assert.equal(new URL(b.window.location.href).searchParams.has('partido'),false);
});
test('existing participant and creator go to their match; deleted and invalid links are handled',async()=>{
  const b=boot();b.records.set('partidos/p',{creadorUid:'a',confirmados:[{uid:'a'}]});
  await b.window.abrirPartidoCompartido('p');assert.equal(b.route,'creator:0');
  b.records.set('partidos/p',{creadorUid:'b',confirmados:[{uid:'a'}]});
  await b.window.abrirPartidoCompartido('p');assert.equal(b.route,'info:0');
  await b.window.abrirPartidoCompartido('gone');assert.equal(b.route,'home');
  await b.window.abrirPartidoCompartido('../x');assert.match(b.messages.at(-1),/no es válido/);
});
test('in-app sharing checks friendship and deduplicates notifications',async()=>{
  const b=boot();b.window.iniciarSocial();
  b.setRelations([{uid:'b',estado:'amigos',solicitanteUid:'a'}]);
  const match={id:'p',cancha:'Cancha',fecha:'2099-01-01',hora:'18:00'};
  b.state.partidos=[match];b.records.set('partidos/p',match);
  b.records.set('usuarios/a/amistades/b',{estado:'amigos'});
  b.records.set('usuarios/b/amistades/a',{estado:'amigos'});
  const buttons=e=>[...(e.children||[]).filter(x=>x.type==='button'),...(e.children||[]).flatMap(buttons)];
  b.window.compartirPartido('p');
  await buttons(b.document.body).find(x=>x.textContent==='Compartir enlace').onclick();
  assert.equal(b.shared.url,'https://tobiaseidelman.github.io/futinder/?partido=p');
  await buttons(b.document.body).find(x=>x.textContent==='Enviar').onclick();
  const key='usuarios/b/notificaciones/p_compartido_a_0';
  assert.equal(b.records.get(key).tipo,'partido_compartido');
  const total=b.writes.length;
  b.window.compartirPartido('p');
  const dialogs=b.document.body.children.filter(x=>x.isConnected);
  await buttons(dialogs.at(-1)).find(x=>x.textContent==='Enviar').onclick();
  assert.equal(b.writes.length,total);
  b.records.delete('usuarios/a/amistades/b');b.records.delete(key);
  b.window.compartirPartido('p');
  await buttons(b.document.body.children.filter(x=>x.isConnected).at(-1)).find(x=>x.textContent==='Enviar').onclick();
  assert.equal(b.records.has(key),false);
});
