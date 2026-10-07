# Futinder

Aplicación web para encontrar y organizar partidos de fútbol amateur en Montevideo.
HTML, CSS y JavaScript con módulos ES; Firebase Auth, Firestore y Storage. Se publica en GitHub Pages sin compilación.

## Organización

| Archivo o carpeta | Responsabilidad |
| --- | --- |
| `index.html` | Pantallas y formularios |
| `css/styles.css` | Estilos de la aplicación |
| `js/main.js` | Punto de entrada e inicio de sesión |
| `js/firebase.js` | Configuración y servicios de Firebase |
| `js/state.js` | Estado compartido de la sesión |
| `js/data/` | Catálogo de canchas y etiquetas de reputación |
| `js/auth.js` | Inicio y cierre de sesión |
| `js/navigation.js` | Navegación entre pantallas |
| `js/location.js` | Ubicación, distancia y selector de canchas |
| `js/filters.js` | Filtros de búsqueda |
| `js/home.js` | Tarjetas, swipe y solicitudes |
| `js/matches.js` | Creación, participantes, estados y cancelaciones |
| `js/profile.js` | Perfiles y subida de imágenes |
| `js/chat.js` | Mensajes por partido |
| `js/notifications.js` | Notificaciones |
| `js/ratings.js` | Calificaciones y opiniones |
| `js/admin.js` | Panel de administración |
| `assets/` | Recursos estáticos locales |
| `tests/` | Pruebas sin conexión a Firebase |

## Desarrollo

Desde la carpeta del proyecto, ejecutar `python3 -m http.server 8080` y abrir `http://localhost:8080`.
Los módulos necesitan un servidor HTTP; abrir el HTML con `file://` no es suficiente.
El acceso real usa el proyecto Firebase configurado. El dominio debe estar autorizado en Firebase Auth para iniciar sesión con Google.

Los manejadores de botones siguen disponibles en `window` para conservar los eventos del HTML. Los módulos comparten datos mediante `state` e importan sus funciones auxiliares explícitamente. `main.js` inicia el observador de autenticación después de cargar las pantallas.

## Pruebas

Con Node.js 22 o posterior, ejecutar `npm test`. No requiere instalar paquetes.
Las pruebas simulan el DOM y los servicios de Firebase; comprueban que los módulos cargan y recorren sesión, perfiles, partidos, solicitudes, chat y reputación. No sustituyen una prueba visual ni una prueba entre cuentas reales.

## Publicación

Subir **todos** los archivos del proyecto, conservando las rutas. GitHub Pages sigue usando `index.html` en la raíz. Para cada actualización, trabajar en una rama, ejecutar las pruebas y revisar el cambio antes de incorporarlo a `main`.

Esta reorganización conserva la lógica existente. Los ajustes de identidad por UID, selección con filtros, concurrencia de cupos y reputación quedan para cambios posteriores. Las reglas de Firestore y Storage no forman parte de este repositorio; deben revisarse en Firebase. La configuración pública del cliente no reemplaza esas reglas.
