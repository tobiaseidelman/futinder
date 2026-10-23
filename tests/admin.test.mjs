import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const admin='CF4vDb4JcfZ7pDUOmXMKxqnjBM32';
function setup(){
  const nodes=new Map(),all=[];
  class El{
    constructor(tag){this.tag=tag;this.children=[];this.style={};this.value='';this.disabled=false;this.classList={contains:()=>false};all.push(this);}
    set id(v){this._id=v;nodes.set(v,this);}get id(){return this._id;}
    set innerHTML(v){throw Error('Unsafe HTML write');}
    append(...v){this.children.push(...v);}
    replaceChildren(...v){this.children=v;}
    setAttribute(){} addEventListener(){} showModal(){} close(){} remove(){this.removed=true;}
  }
  for(const id of ['adminBtn','adminPanel','listaAdminPartidos']){const e=new El('div');e.id=id;}
  const document={createElement:t=>new El(t),getElementById:id=>nodes.get(id)||null,body:new El('body')};
  const state={usuario:{uid:admin},partidos:[]};
  const records=new Map(),writes=[],warnings=[];let snapshot,fail,stopped=0;
  const context={state,document,window:null,fechaPartido:x=>x,getEstadoPartido:p=>p.estado||'activo',db:{},
    doc:(_, ...p)=>p.join('/'),collection:(_,p)=>p,serverTimestamp:()=>123,
    onSnapshot:(_,cb,err)=>{snapshot=cb;fail=err;return ()=>stopped++;},
    runTransaction:async(_,fn)=>{const pending=[];await fn({get:async ref=>({exists:()=>records.has(ref),data:()=>records.get(ref)}),set:(ref,data)=>pending.push([ref,data]),update:(ref,data)=>pending.push([ref,{...records.get(ref),...data}])});for(const [ref,data]of pending){records.set(ref,data);writes.push(ref);}}
  };
  context.window=context;context.mostrarAviso=(...v)=>warnings.push(v);context.cambiarPantalla=id=>{context.screen=id;};
  vm.createContext(context);
  for(const name of ['admin','reports']){
    const code=readFileSync(new URL('../js/'+name+'.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export .*;\n?/gm,'');
    vm.runInContext(code,context);
  }
  return {context,state,nodes,all,records,writes,warnings,snap:docs=>snapshot({docs:docs.map(([id,data])=>({id,data:()=>data}))}),fail:e=>fail(e),stopped:()=>stopped};
}
test('admin safely displays hostile names, filters finished matches, refreshes and blocks normal accounts',()=>{
  const h=setup();h.state.partidos=[{id:'a',cancha:'<img onerror=alert(1)>',creador:'<script>',estado:'activo'},{id:'b',estado:'finalizado'}];
  h.context.verAdminPanel();assert.equal(h.context.screen,'adminPanel');
  assert.ok(h.all.some(e=>e.textContent==='<img onerror=alert(1)>'));
  assert.equal(h.all.filter(e=>e.textContent==='Cancelar partido').length,1);
  h.state.partidos=[];h.context.renderAdminPanel();assert.ok(h.nodes.get('listaAdminPartidos').children.some(e=>e.textContent==='No hay partidos activos ahora mismo.'));
  h.state.usuario={uid:'other'};h.context.actualizarAccesoAdmin();assert.equal(h.nodes.get('adminBtn').style.display,'none');assert.equal(h.nodes.get('listaAdminPartidos').children.length,0);assert.equal(h.stopped(),1);
  h.context.screen='home';h.context.verAdminPanel();assert.equal(h.context.screen,'home');
});
test('report creation, duplicate prevention, own content and nonexistent targets',async()=>{
  const h=setup();h.state.usuario={uid:'reporter'};h.records.set('partidos/m',{cancha:'Cancha',creadorUid:'owner'});
  const send=async(tipo,id)=>{h.context.reportarContenido(tipo,id);const button=h.all.filter(e=>e.textContent==='Enviar reporte').at(-1);await button.onclick();};
  await send('partido','m');assert.equal(h.records.get('reportes/reporter_partido_m').estado,'pendiente');assert.equal(h.writes.length,1);
  await send('partido','m');assert.equal(h.writes.length,1);assert.ok(h.all.some(e=>e.textContent==='Ya enviaste un reporte sobre esto.'));
  h.records.set('partidos/own',{creadorUid:'reporter'});await send('partido','own');assert.equal(h.writes.length,1);
  await send('usuario','missing');assert.equal(h.writes.length,1);
});
test('report review requires admin and keeps data as text; late snapshots ignored after logout',async()=>{
  const h=setup();h.context.verAdminPanel();
  const r={estado:'pendiente',tipo:'usuario',objetivoId:'u',nombre:'<img>',detalle:'<script>',motivo:'Spam'};h.records.set('reportes/r',r);h.snap([['r',r]]);
  assert.ok(h.all.some(e=>e.textContent==='<script>'));
  const review=h.all.find(e=>e.textContent==='Marcar revisado');h.state.usuario={uid:'other'};await review.onclick();assert.equal(h.writes.length,0);
  h.state.usuario={uid:admin};await review.onclick();assert.equal(h.records.get('reportes/r').estado,'revisado');
  h.context.detenerReportesAdmin();h.snap([['r',r]]);assert.equal(h.nodes.get('listaAdminReportes').children.length,0);
});
test('permission error is visible and does not claim report sent',async()=>{
  const h=setup();h.state.usuario={uid:'reporter'};
  h.context.runTransaction=async()=>{throw {code:'permission-denied'};};
  h.context.reportarContenido('usuario','u');await h.all.find(e=>e.textContent==='Enviar reporte').onclick();
  assert.equal(h.warnings.length,0);assert.ok(h.all.some(e=>e.textContent==='No se pudo enviar el reporte. Intentá de nuevo más tarde.'));
});
test('profile text and photo helpers reject script content while preserving uploaded photos',()=>{
  const source=readFileSync(new URL('../js/profile.js',import.meta.url),'utf8');
  const helpers=source.slice(source.indexOf('function textoPerfilSeguro'),source.indexOf('window.abrirPerfilJugador'));
  const context=vm.createContext({URL});vm.runInContext(helpers,context);
  assert.equal(context.textoPerfilSeguro('<img src=x onerror="bad()">'), '&lt;img src=x onerror=&quot;bad()&quot;&gt;');
  assert.equal(context.imagenPerfilSegura('javascript:alert(1)'),false);
  assert.equal(context.imagenPerfilSegura('data:image/svg+xml;base64,AAAA'),false);
  assert.equal(context.imagenPerfilSegura('data:image/jpeg;base64,AAAA'),true);
  assert.equal(context.imagenPerfilSegura('https://example.com/photo.jpg'),true);
});
