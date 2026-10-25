# Activar las reglas de Firestore

El archivo `firestore.rules` reemplaza por completo las reglas públicas anteriores. Subirlo a GitHub no lo publica en Firebase.

## Publicación

1. Esperar a que GitHub Pages termine de publicar esta versión de la app.
2. En Firebase, abrir el proyecto **futinder-cace8 → Firestore Database → Reglas**.
3. Seleccionar la versión activa. Reemplazar **todo** el editor por el contenido de `firestore.rules`.
4. Publicar. No conservar el bloque anterior `allow read, write: if true`: cualquier permiso amplio que permanezca anularía las restricciones.
5. Recargar Futinder en todas las pestañas y dispositivos que se estén usando.
6. Probar con dos cuentas: solicitud de partido, aceptación, chat, amistad, compartir y reportar. Probar la revisión del reporte desde la cuenta admin.

La versión inicial pasó 20 pruebas en el emulador de Firestore. La ampliación de lectura de chat para el administrador incluye una prueba adicional pendiente de ejecución: falló la descarga del emulador en ese entorno. No se probó contra los datos de producción. No se modificaron registros ni reglas de la base real desde este cambio.

## Permisos

- Sin sesión: no se puede leer ni escribir.
- Perfiles: visibles para usuarios con sesión; cada persona edita sus propios datos personales, pero no sus estrellas ni contadores.
- Partidos: lectura con sesión; creación con el UID autenticado, cambios del organizador y operaciones limitadas del participante sobre su propia solicitud o lugar.
- Amigos: solicitud simétrica; solo el receptor puede aceptarla; cualquiera de los dos puede eliminar la relación.
- Chats: jugadores confirmados pueden leer y escribir; el administrador también puede leer para moderar, sin permiso adicional para escribir. Autor del mensaje ligado a la sesión.
- Calificaciones: una por jugador/autor/partido terminado, sin autocalificación. Los índices de participantes se comprueban contra los UID guardados. Promedio y etiquetas se validan junto con la nueva opinión en la misma operación.
- Notificaciones: inbox privado; los avisos enviados a otra persona requieren la amistad o el partido correspondiente.
- Reportes: creación por el autor; solo el administrador puede listar todos y marcarlos revisados.
- El UID del administrador está fijado en las reglas; editar un campo de perfil no concede permisos.

## Compatibilidad y datos existentes

- Se mantiene la estructura de los partidos y perfiles; los participantes deben tener UID. No se identifica a una persona solo por su nombre. Registros antiguos sin UID requieren una revisión/migración antes de conceder acceso.
- Los partidos necesitan `inicioTimestamp` y `finTimestamp` numéricos. El creador actual ya guarda esos campos; los registros más antiguos sin ellos requieren revisión.
- Las solicitudes vencidas se retiran al abrir la app con la cuenta que las envió. La vista del creador las oculta desde el inicio del partido.
- El conteo al terminar ahora se registra por usuario en `usuarios/{uid}/partidosContados/{partidoId}`, en una operación junto al incremento y al aviso. No se necesitan permisos para aumentar contadores ajenos. Los partidos que ya tienen `notifRatingEnviada: true` conservan el conteo anterior.
- El aviso para calificar aparece cuando ese usuario vuelve a abrir la app. No hay un proceso de servidor que ejecute tareas con la app cerrada.
- Las nuevas solicitudes y perfiles ya no copian el email de Google. Los emails que ya existan en documentos de perfiles o solicitudes no se borran automáticamente y continúan visibles para usuarios autenticados que puedan leer esos documentos. La limpieza de datos históricos es una tarea pendiente; no poner nuevos datos privados en perfiles públicos.
- Estas reglas no reparan datos que hayan sido alterados mientras la base estuvo abierta. Tampoco sustituyen el tratamiento seguro de textos en la interfaz, controles de abuso ni una auditoría completa antes de una publicación amplia.
- Este archivo protege **Cloud Firestore**. No cambia las reglas de Firebase Storage ni de otros servicios.

## Pruebas

Con Node y Java 17 instalados:

```sh
npm install
npm run test:rules
```

Se usa exclusivamente el proyecto local `demo-futinder-security`. Las pruebas cubren accesos permitidos y denegados, cambios de dueño, perfiles, solicitudes, participantes, amistad, chats, notificaciones, reportes, reputación, F11 y duplicados.

Las reglas de producción no se despliegan al ejecutar las pruebas. Para publicar se usa el editor de Firebase siguiendo los pasos anteriores.

## Chats privados en Amigos

Publicar nuevamente el archivo completo `firestore.rules` para habilitar `conversaciones/{id}/mensajes`. Solo sus dos participantes pueden leer, incluido el historial después de quitar una amistad. Para enviar se requiere amistad mutua. Los mensajes son inmutables y se guardan junto al resumen de conversación. Los partidos compartidos nuevos se guardan en el chat; los avisos anteriores siguen en la campana y no se migran automáticamente. Los mensajes de texto se ven dentro de Amigos (no son notificaciones push).

Las 25 pruebas de `security/firestore.rules.test.mjs` pasaron en el emulador, incluidas amistad mutua, privacidad, autoría, inmutabilidad y partidos compartidos válidos. No se modificaron las reglas de producción desde estas pruebas.


## Avisos y conversaciones sin leer
Volver a publicar las reglas completas para habilitar `usuarios/{uid}/lecturasChats` y los avisos `mensaje_privado`. Las lecturas se guardan por cuenta. Cada mensaje nuevo actualiza el aviso de esa conversación en la campana; no envía notificaciones push al teléfono. El contador de Chats suma conversaciones sin leer, no mensajes individuales. Los mensajes históricos previos a esta versión no generan avisos retroactivos.

Las 26 pruebas de reglas pasaron en el emulador, incluyendo privacidad de los recibos de lectura, autoría del aviso, destinatario y preservación de mensajes pendientes al responder.
