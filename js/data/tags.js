
// ---- TAGS SISTEMA ----
const TAGS = [
  { id: 'puntual',        emoji: '⏰', label: 'Puntual',           tipo: 'bueno',  opuesto: 'llega_tarde' },
  { id: 'llega_tarde',    emoji: '⏰', label: 'Llega tarde',        tipo: 'malo',   opuesto: 'puntual' },
  { id: 'equipo',         emoji: '⚽', label: 'Juega en equipo',    tipo: 'bueno',  opuesto: 'no_pasa' },
  { id: 'no_pasa',        emoji: '❌', label: 'No la pasa',         tipo: 'malo',   opuesto: 'equipo' },
  { id: 'buena_onda',     emoji: '🙌', label: 'Buena onda',         tipo: 'bueno',  opuesto: 'mala_onda' },
  { id: 'mala_onda',      emoji: '😤', label: 'Mala onda',          tipo: 'malo',   opuesto: 'buena_onda' },
  { id: 'corre',          emoji: '💪', label: 'Corre todo el partido', tipo: 'bueno', opuesto: 'no_corre' },
  { id: 'no_corre',       emoji: '🦥', label: 'No corre',           tipo: 'malo',   opuesto: 'corre' },
  { id: 'define',         emoji: '🎯', label: 'Define bien',        tipo: 'bueno',  opuesto: 'no_define' },
  { id: 'no_define',      emoji: '😬', label: 'No define',          tipo: 'malo',   opuesto: 'define' },
  { id: 'pases',          emoji: '🎯', label: 'Buenos pases',       tipo: 'bueno',  opuesto: 'malos_pases' },
  { id: 'malos_pases',    emoji: '❌', label: 'Malos pases',        tipo: 'malo',   opuesto: 'pases' },
  { id: 'habilidoso',     emoji: '🔥', label: 'Muy habilidoso',     tipo: 'bueno',  opuesto: 'falta_tecnica' },
  { id: 'falta_tecnica',  emoji: '👎', label: 'Le falta técnica',   tipo: 'malo',   opuesto: 'habilidoso' },
  { id: 'limpio',         emoji: '🤝', label: 'Juega limpio',       tipo: 'bueno',  opuesto: 'brusco' },
  { id: 'brusco',         emoji: '🦶', label: 'Juega brusco',       tipo: 'malo',   opuesto: 'limpio' },
  { id: 'ganas',          emoji: '🔥', label: 'Va con ganas',       tipo: 'bueno',  opuesto: 'sin_ganas' },
  { id: 'sin_ganas',      emoji: '😒', label: 'Va sin ganas',       tipo: 'malo',   opuesto: 'ganas' },
];
const TAG_UMBRAL = 5; // tags para mostrarse en perfil
const TAG_NOTIF_CADA = 3; // notificar cada X tags malos


export { TAGS, TAG_UMBRAL, TAG_NOTIF_CADA };
