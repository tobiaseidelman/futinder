import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

// Firebase y DOM simulados: estas pruebas nunca leen ni escriben datos reales.
async function boot(original = false) {
  const elements = new Map(), writes = [], listeners = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        id, dataset: {}, setAttribute(k,v){this[k]=v;}, replaceChildren(){}, innerHTML: '', textContent: '', value: '', style: {},
        classList: {
          add: c => classes.add(c), remove: c => classes.delete(c),
          contains: c => classes.has(c),
          toggle(c, force) { (force ?? !classes.has(c)) ? classes.add(c) : classes.delete(c); }
        },
        addEventListener() {}, querySelector: s => element(id + s),
        querySelectorAll: () => [],
      });
    }
    return elements.get(id);
  }
  const profile = { uid: 'user-1', nombre: 'Tobias', posicion: 'DC', partidos: 2, rating: 4, calificacionesRecibidas: 1, tagsMostrar: [], jugadas: [] };
  const other = { uid: 'user-2', nombre: 'Lucas', posicion: 'MC' };
  const match = { id: 'match-1', cancha: 'Cancha de prueba', tipo: '5', jugadores: 2, max: 10, creador: profile.nombre, creadorUid: profile.uid, confirmados: [profile, other], solicitudes: [], inicioTimestamp: Date.now() + 172800000, finTimestamp: Date.now() + 178200000, hora: '18:00', fecha: '2030-01-01' };
  let authCallback;
  const firestore = {
    getFirestore: () => ({}), collection: (_, ...p) => p.join('/'), doc: (_, ...p) => p.join('/'),
    query: r => r, orderBy: () => null, where: () => null,
    getDoc: async r => ({ exists: () => true, data: () => r.endsWith('user-2') ? other : profile }),
    onSnapshot: (r, cb) => { listeners.set(r, cb); return () => listeners.delete(r); },
    serverTimestamp: () => 'timestamp', increment: n => ({ increment: n }),
    arrayUnion: (...v) => ({ union: v }), arrayRemove: (...v) => ({ remove: v }),
    addDoc: async (...a) => { writes.push(['add', ...a]); return { id: 'new-id' }; },
    updateDoc: async (...a) => writes.push(['update', ...a]),
    setDoc: async (...a) => writes.push(['set', ...a]),
    deleteDoc: async (...a) => writes.push(['delete', ...a]),
  };
  const sdk = {
    'firebase-app.js': { initializeApp: () => ({}) },
    'firebase-firestore.js': firestore,
    'firebase-auth.js': { getAuth: () => ({}), GoogleAuthProvider: class {}, signInWithPopup: async () => {}, signOut: async () => {}, onAuthStateChanged: (_, cb) => { authCallback = cb; } },
    'firebase-storage.js': { getStorage: () => ({}), ref: (_, p) => p, uploadBytes: async () => {}, getDownloadURL: async () => 'image.jpg', deleteObject: async () => {} }
  };
  const sandbox = {
    console, setTimeout: () => {}, clearTimeout() {}, alert() {}, confirm: () => true,
    navigator: {}, document: {
      getElementById: element,
      querySelector: s => element(s),
      querySelectorAll: s => s === '.screen' ? [...elements.values()] : [],
    }
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox), modules = new Map();
  async function getModule(id) {
    if (modules.has(id)) return modules.get(id);
    const pending = (async () => {
    let mod;
    if (id.startsWith('https:')) {
      const api = sdk[id.split('/').at(-1)];
      assert.ok(api, `Unexpected remote import: ${id}`);
      mod = new vm.SyntheticModule(Object.keys(api), function() { for (const [key, value] of Object.entries(api)) this.setExport(key, value); }, { context, identifier: id });
    } else {
      let source = await fs.readFile(id, 'utf8');
      if (original) source = source.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
      mod = new vm.SourceTextModule(source, { context, identifier: id });
    }
    return mod;
    })();
    modules.set(id, pending);
    return pending;
  }
  const entry = await getModule(original || path.join(root, 'js/main.js'));
  await entry.link((specifier, parent) => getModule(specifier.startsWith('https:') ? specifier : path.resolve(path.dirname(parent.identifier), specifier)));
  await entry.evaluate();
  return { sandbox, element, elements, profile, match, listeners, writes, firestore, auth: user => authCallback(user) };
}

async function exercise(app) {
  const {sandbox: w, element: el, auth, match, listeners} = app;
  await auth(null);
  assert.ok(el('login').classList.contains('active'));
  await auth({ uid: 'user-1' });
  listeners.get('partidos')({ docs: [{ id: match.id, data: () => match }] });
  w.verMiPerfil(); assert.match(el('perfilContent').innerHTML, /Tobias/);
  w.editarPerfil(); assert.equal(el('editNombre').value, 'Tobias');
  w.verMisPartidos(); assert.match(el('listaPartidos').innerHTML, /Cancha de prueba/);
  w.verDetalle(0); assert.match(el('listaConfirmados').innerHTML, /Lucas/);
  w.verInfoPartido(0); assert.match(el('infoPartidoContent').innerHTML, /Cancha de prueba/);
  w.abrirChatIdx(0);
  listeners.get('partidos/match-1/mensajes')({ docs: [{ data: () => ({ nombre: 'Lucas', texto: 'Llevo pelota' }) }] });
  assert.match(el('mensajes').innerHTML, /Llevo pelota/);
  el('mensajeInput').value = 'Nos vemos'; await w.enviarMensaje();
  w.abrirModalRating('Lucas', 'match-1', 'user-1'); w.selStar(4); w.selTag('puntual');
  assert.match(el('modalRatingContent').innerHTML, /Lucas/);
  await w.enviarRating();
  await w.abrirPerfilJugador('user-2', 'Lucas');
  assert.match(el('modalContent').innerHTML, /Lucas/);
  await w.verOpinionesPropias(); assert.match(el('opinionesContent').innerHTML, /4.0/);
  w.cambiarPantalla('crear'); assert.equal(el('canchaGroup').style.display, 'none');
  w.selCancha('cortita');
  el('hora').value = '18:00'; el('fecha').value = '2030-01-01';
  el('jugadores').value = '4'; el('precio').value = '300';
  await w.crearPartido();
  const available = { ...match, id: 'match-2', creador: 'Lucas', creadorUid: 'user-2', confirmados: [] };
  listeners.get('partidos')({ docs: [{ id: available.id, data: () => available }] });
  w.irHome(); assert.match(el('card').innerHTML, /Cancha de prueba/);
  await w.match();
  assert.ok(app.writes.some(([kind, target]) => kind === 'update' && target === 'partidos/match-2'));
  await w.cerrarSesion(); assert.ok(el('login').classList.contains('active'));
  return JSON.stringify({html: [...app.elements].map(([id, e]) => [id, e.innerHTML, e.textContent, e.value]), writes: app.writes});
}

test('carga módulos y recorre sesión, perfil, partidos, chat, reputación y cierre', async () => {
  await exercise(await boot());
});

test('los recursos de entrada existen y los estilos salen del HTML', async () => {
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  assert.ok(!html.includes('<style>'));
  assert.match(html, /src="\.\/js\/main.js"/);
  for (const p of ['css/styles.css', 'js/main.js']) assert.ok((await fs.stat(path.join(root, p))).size > 0);
});

if (process.env.FUTINDER_BASELINE) {
  test('conserva el resultado del archivo original en los recorridos comprobados', async () => {
    assert.equal(await exercise(await boot()), await exercise(await boot(process.env.FUTINDER_BASELINE)));
  });
}

test('tarjeta móvil, dirección desplegable y solicitud al partido filtrado', async () => {
 const a=await boot();
 await a.auth({uid:'user-1'});
 const other={...a.match,id:'match-b',creador:'Lucas',creadorUid:'user-2',cancha:'Cancha B',canchaZona:'Pocitos',canchaDireccion:'Dirección de prueba',confirmados:[],jugadores:7,max:10};
 const excluded={...other,id:'match-a',cancha:'Cancha A',canchaZona:'Centro'};
 a.listeners.get('partidos')({docs:[{id:excluded.id,data:()=>excluded},{id:other.id,data:()=>other}]});
 a.element('filtroZonaSelect').value='Pocitos';
 a.sandbox.aplicarFiltrosUI();a.sandbox.render();
 const html=a.element('card').innerHTML;
 assert.match(html,/Cancha B/);assert.doesNotMatch(html,/Cancha A/);
 assert.match(html,/7\/10/);assert.match(html,/Dirección de prueba/);
 assert.match(html,/✅ Quiero/);assert.doesNotMatch(html,/4\.8/);
 a.sandbox.toggleDist();assert.equal(a.element('canchaLocationBtn')['aria-expanded'],'true');
 a.sandbox.toggleDist();assert.equal(a.element('canchaLocationBtn')['aria-expanded'],'false');
 await a.sandbox.match();
 assert.ok(a.writes.some(([kind,target])=>kind==='update'&&target==='partidos/match-b'));
 assert.ok(!a.writes.some(([kind,target])=>kind==='update'&&target==='partidos/match-a'));
});


test('guarda avatar sin Storage y conserva cambios pendientes si Firestore falla', async () => {
  const a = await boot();
  await a.auth({uid:'user-1'});
  const avatar = 'data:image/jpeg;base64,YWJj';
  a.sandbox.Image = class {
    width = 640; height = 480;
    set src(value){ this.onload(); }
  };
  a.sandbox.File = class {
    constructor(parts, name, options){ this.size = parts[0].size; this.name = name; this.type = options.type; }
  };
  a.sandbox.FileReader = class {
    readAsDataURL(){ this.result = avatar; this.onload({target:{result:avatar}}); }
  };
  a.sandbox.document.createElement = () => ({
    getContext: () => ({drawImage(){}}),
    toBlob: cb => cb({size:1024}),
  });
  a.sandbox.editarPerfil();
  await a.sandbox.previsualizarFoto({files:[{name:'foto.jpg',type:'image/jpeg',size:2048}]}, 'previewFotoEdit');
  await a.sandbox.guardarPerfil();
  const saved = a.writes.find(([kind, target, data])=>kind==='update' && target==='usuarios/user-1' && data.foto===avatar);
  assert.ok(saved, 'el avatar se guarda directamente en Firestore');
  assert.equal(a.profile.foto, avatar);
  a.profile.foto = 'anterior.jpg';
  await a.sandbox.previsualizarFoto({files:[{name:'foto.jpg',type:'image/jpeg',size:2048}]}, 'previewFotoEdit');
  // La función de escritura delega en push; simular rechazo sin tocar datos reales.
  const push = a.writes.push;
  a.writes.push = () => { throw new Error('sin conexión'); };
  let aviso = '';
  a.sandbox.alert = text => { aviso = text; };
  a.sandbox.console = { ...console, error(){} };
  await a.sandbox.guardarPerfil();
  assert.equal(a.profile.foto, 'anterior.jpg');
  assert.match(aviso, /No se pudieron guardar/);
  a.writes.push = push;
  await a.sandbox.guardarPerfil();
  assert.equal(a.profile.foto, avatar, 'permite reintentar sin volver a elegir la foto');
});
