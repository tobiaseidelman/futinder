import { signInWithPopup, auth, provider, signOut, onAuthStateChanged, doc, db, getDoc } from './firebase.js';
import { state } from './state.js';
import { iniciarPartidos } from './matches.js';
import { iniciarNotificaciones } from './notifications.js';
import { pedirPermisosSesion, reiniciarPermisosSesion } from './location.js';
import { esAdmin } from './admin.js';

// ---- LOGIN CON GOOGLE ----
window.loginGoogle = async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch(e) {
    alert("Error al iniciar sesión: " + e.message);
  }
};

window.cerrarSesion = async () => {
  if(state.notifUnsub) state.notifUnsub();
  if(state.partidosUnsub) state.partidosUnsub();
  if(state.chatUnsub) state.chatUnsub();
  window.detenerSocial?.();
  reiniciarPermisosSesion();
  state.perfil = null; state.usuario = null; state.partidos = []; state.notificaciones = [];
  await signOut(auth);
  cambiarPantalla("login");
};

// ---- AUTH STATE ----
function iniciarAuth(){
  return onAuthStateChanged(auth, async (user) => {
  document.getElementById("loading").style.display = "none";
  if(!user){
    window.detenerSocial?.();
    reiniciarPermisosSesion();
    cambiarPantalla("login");
    return;
  }
  state.usuario = user;
  // Cargar o crear perfil en Firestore
  const perfilRef = doc(db, "usuarios", user.uid);
  const perfilSnap = await getDoc(perfilRef);
  if(perfilSnap.exists()){
    state.perfil = perfilSnap.data();
    window.iniciarSocial?.();
    iniciarPartidos();
    iniciarNotificaciones();
    if(esAdmin()) document.getElementById("adminBtn").style.display = "flex";
    cambiarPantalla("home");
  } else {
    // Nuevo usuario — pre-llenar con datos de Google
    document.getElementById("nombreNuevo").value = user.displayName || "";
    cambiarPantalla("crearPerfil");
  }
  await pedirPermisosSesion(user.uid);
});
}

export { iniciarAuth };
