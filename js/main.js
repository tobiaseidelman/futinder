// Cargar las pantallas antes de observar la sesión de Firebase.
import './navigation.js';
import './filters.js';
import './home.js';
import './matches.js';
import './profile.js';
import './admin.js';
import './chat.js';
import './notifications.js';
import './ratings.js';
import { iniciarAuth } from './auth.js';
import { pedirUbicacion } from './location.js';

pedirUbicacion();
const hoy = new Date().toISOString().split('T')[0];
const fechaInput = document.getElementById('fecha');
if (fechaInput) fechaInput.value = hoy;
iniciarAuth();
