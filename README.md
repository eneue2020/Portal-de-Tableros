# Portal de Tableros

Portal web (Node.js + Express + React) para publicar tableros HTML en la red local.

## Uso

```bash
npm install        # solo la primera vez
npm run serve      # compila el frontend y levanta el servidor en el puerto 3000
```

O doble clic en `iniciar.bat`.

Al arrancar, la consola muestra las direcciones de acceso:

```
Local:  http://localhost:3000
Red:    http://192.168.x.x:3000   <- compartir esta con el resto de la red
```

Para cambiar el puerto: `set PORT=8080 && npm start` (cmd) o `$env:PORT=8080; npm start` (PowerShell).

### Firewall de Windows

La primera vez Windows puede pedir permiso para Node.js: aceptar en **redes privadas**.
Si no aparece y no se puede entrar desde otra PC, ejecutar como administrador:

```powershell
New-NetFirewallRule -DisplayName "Portal de Tableros" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

## Desarrollo

```bash
npm run dev        # API en :3000 + Vite con recarga en caliente en :5173
```

## Estructura

```
server/index.js        API Express y servidor de archivos
server/db.js           Base de datos SQLite: esquema, lectura y escritura
client/src/            App React (Vite)
data/portal.db         Base de datos (tableros, Canvan, tareas, dependencias y Gantt)
data/tableros/         Archivos HTML de los tableros
data/procesos/         Definición de cada proceso (JSON)
data/respaldos/        Copias de la base (npm run respaldo)
dist/                  Frontend compilado (npm run build)
```

Los tableros se agregan desde la web (botón **Agregar tablero**) o copiando el `.html`
directamente en `data/tableros/`: se registran solos al recargar el portal, usando el `<title>` como nombre.

## Base de datos

El portal guarda sus datos en SQLite (`data/portal.db`), con el módulo `node:sqlite` que trae Node 24: no
hay que instalar nada. Tablas: `tableros`, `canvan`, `canvan_columnas`, `canvan_etiquetas`, `tareas`,
`dependencias`, `gantt_config` y `gantt_orden`. Los HTML de los tableros y los procesos siguen como archivos,
porque se reemplazan o editan enteros.

- **Primera vez:** al arrancar, si la base es nueva, importa `data/tableros.json`, `data/canvan/*.json` y
  `data/gantt.json`. Esos archivos no se borran, pero desde ese momento **no se usan más**: quedan como respaldo.
- **Respaldo:** `npm run respaldo` guarda una copia en `data/respaldos/` (conserva las últimas 30). Se puede
  correr con el portal en marcha; para otra carpeta: `npm run respaldo -- D:\copias`. Conviene programarlo
  todos los días con el Programador de tareas de Windows.
- **Restaurar:** detener el portal, reemplazar `data/portal.db` por una copia de `data/respaldos/` (y borrar
  `portal.db-wal` y `portal.db-shm` si están) y volver a iniciarlo.
- Otra ubicación para la base: variable de entorno `PORTAL_DB`.

## Vista de Procesos

Cada proceso es un archivo JSON en `data/procesos/` (ver `carga-convenios.json` como ejemplo) y se
dibuja como diagrama de actividad UML con carriles. Para agregar uno, copiar el ejemplo y editar:

- `carriles`: columnas del diagrama (área o sistema) con sus `responsables`.
- `nodos`: pasos del proceso. `tipo`: `inicio`, `actividad`, `decision` o `fin`; `carril` y `fila` fijan la posición.
  Opcionales: `detalle`, `responsables`, `tareas`, `artefactos` (archivos), `alerta` (problema) y `pendiente`.
- `flujos`: flechas `desde` → `hasta`, con `etiqueta` opcional (Sí/No). `ruta` permite desviar la flecha
  por puntos intermedios `[carril, fila]` cuando atraviesa otros pasos.
- `observaciones`: problemas y pendientes generales del proceso.

Aparece en el portal al recargar la página, sin reiniciar el servidor.

## Canvan

Cada proceso de `data/procesos/` tiene un tablero kanban (Canvan) para gestionar sus pendientes, con las
columnas Por hacer, En progreso y Completado. La app está en `canvan/index.html` y los datos de cada
tablero se guardan en la base del servidor, así todos ven lo mismo.

- Los pendientes del proceso (observaciones de tipo `pendiente` y el `pendiente` de cada paso) entran
  solos a **Por hacer** al abrir el portal. Cada uno entra una sola vez: si se borra la tarjeta, no vuelve.
- Si dos personas guardan a la vez, la segunda recibe la última versión y un aviso para revisar su cambio.

### Gantt

La vista **Gantt** (`#/gantt`, en la sección Canvan del menú) muestra las tareas de todos los Canvan en una
línea de tiempo, agrupadas por proceso. Cada barra va de la **Fecha de inicio** a la **Fecha límite** de la tarjeta
y toma el color de su columna; el avance sale del checklist.

- Arrastrar una barra la mueve; arrastrar sus bordes cambia el inicio o el fin. Se guarda en el Canvan.
- Tocar una tarea abre sus fechas; tocar la fila de una tarea sin fechas la crea desde ese día.
- Sin fecha de inicio, la barra arranca en la fecha de creación (borde punteado). Las vencidas tienen borde rojo.
- La **fecha límite** del plan (por defecto el 31/12/2026) es la línea violeta punteada. Se mueve arrastrando su
  marca en el encabezado, con las flechas ← → o desde el campo «Fecha límite». Se guarda para todos en la
  base. Las tareas que terminan después tienen borde naranja.
- Para **cambiar el orden** de las tareas, arrastralas hacia arriba o abajo desde el asa ⋮⋮ o desde su nombre
  (o Alt + ↑ / ↓). Se mueven dentro de su proceso y el orden se guarda en la base, sin cambiar el Canvan.
- **Dependencias** (fin → inicio): en el editor de la tarea, «Depende de» permite agregar tareas previas, también de
  otros procesos, y quitarlas. Se guardan en la tarjeta (`dependeDe`) y se dibujan como flechas; en rojo si la tarea
  empieza antes de que termine la previa. El editor ofrece correrla al día siguiente y no deja crear ciclos.
- **Estado de salud** del proyecto Bymovi (o del proceso filtrado), arriba del Gantt (`SaludProyecto.jsx`):
  - 🔴 *Atrasado*: tareas vencidas, que terminan después de la fecha límite, o la fecha límite ya pasó.
  - 🟠 *En riesgo*: tareas que debían empezar y siguen en «Por hacer», dependencias en conflicto, tareas que
    esperan a una vencida, o el avance va más de 15 puntos detrás del tiempo transcurrido.
  - 🟢 *En término*: nada de lo anterior.
  - Avance: completada 100 %, con checklist según sus pasos, en curso sin checklist 50 %, por hacer 0 %.
  - Las alertas de atraso se listan por gravedad (los avisos, como «vence esta semana», no cambian el estado);
    un clic abre la tarea, y las filas con alertas críticas o de riesgo llevan una marca «!».

### Modelos de datos desde draw.io

Los diagramas entidad-relación hechos en draw.io (tablas con filas PK/FK) se importan con:

```bash
node scripts/importar-drawio.js data/fuentes/bymovi-app.drawio modelo-app-bymovi
```

Genera `data/procesos/modelo-app-bymovi.json` (tipo `modelo`) respetando la posición de las tablas
del original. Al reimportar un archivo actualizado se conservan el nombre, el área, la descripción y el
enlace a la fuente; para cambiarlos: `--nombre "..." --area "..." --descripcion "..." --fuente URL`.

## API

| Método | Ruta                          | Acción                                |
|--------|-------------------------------|---------------------------------------|
| GET    | `/api/tableros`               | Lista los tableros                    |
| POST   | `/api/tableros`               | Sube uno nuevo (multipart: `archivo`, `nombre`, `categoria`, `descripcion`) |
| PATCH  | `/api/tableros/:id`           | Edita nombre, categoría o descripción |
| PUT    | `/api/tableros/:id/archivo`   | Reemplaza el HTML                     |
| DELETE | `/api/tableros/:id`           | Elimina el tablero                    |
| GET    | `/ver/:id`                    | Muestra el HTML del tablero           |
| GET    | `/api/procesos`               | Lista los procesos                    |
| GET    | `/api/procesos/:id`           | Definición completa de un proceso     |
