// Estado compartido de la sesión. Las pantallas leen y actualizan este objeto.
export const state = {
  partidos: [],
  perfil: null,
  usuario: null,
  notificaciones: [],
  idx: 0,
  tipoSel: '5',
  durSel: '1:30h',
  posSel: '',
  posEditSel: '',
  chatUnsub: null,
  notifUnsub: null,
  partidosUnsub: null,
  canchaSeleccionada: null,
  userLat: null,
  userLng: null,
};
