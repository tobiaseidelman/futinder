import { state } from './state.js';

// Indices are evidence, never authority: Firestore checks the referenced UID.
export function evidenciaAviso(partido, receptorUid){
  return {
    emisorUid: state.usuario.uid,
    receptorConfirmado: (partido.confirmados || []).findIndex(c => c && typeof c === 'object' && c.uid === receptorUid),
    receptorSolicitud: (partido.solicitudes || []).findIndex(s => s.uid === receptorUid)
  };
}
