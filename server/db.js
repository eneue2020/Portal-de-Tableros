// Persistencia del portal en SQLite (data/portal.db), con el módulo node:sqlite que trae Node.
// Guarda los metadatos de los tableros, los Canvan (columnas, etiquetas, tareas y dependencias) y la
// configuración del Gantt. Los HTML de los tableros siguen en data/tableros/ y los procesos en
// data/procesos/*.json, porque son archivos que se reemplazan o editan enteros.
//
// Las funciones devuelven y reciben los mismos objetos que usaba la API con archivos JSON, así el
// frontend y la app Canvan no cambian.
import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS meta (
  clave TEXT PRIMARY KEY,
  valor TEXT
);
CREATE TABLE IF NOT EXISTS tableros (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  categoria   TEXT NOT NULL DEFAULT 'General',
  archivo     TEXT NOT NULL UNIQUE,
  actualizado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS canvan (
  id            TEXT PRIMARY KEY,
  nombre        TEXT NOT NULL,
  rev           INTEGER NOT NULL DEFAULT 0,
  sincronizados TEXT NOT NULL DEFAULT '[]',  -- pendientes del proceso que ya pasaron a tarjeta (JSON)
  extra         TEXT                         -- otros campos del tablero (JSON)
);
CREATE TABLE IF NOT EXISTS canvan_etiquetas (
  canvan_id TEXT NOT NULL REFERENCES canvan(id) ON DELETE CASCADE,
  id        TEXT NOT NULL,
  nombre    TEXT NOT NULL,
  color     TEXT NOT NULL,
  posicion  INTEGER NOT NULL,
  PRIMARY KEY (canvan_id, id)
);
CREATE TABLE IF NOT EXISTS canvan_columnas (
  canvan_id TEXT NOT NULL REFERENCES canvan(id) ON DELETE CASCADE,
  id        TEXT NOT NULL,
  titulo    TEXT NOT NULL,
  color     TEXT NOT NULL,
  wip       INTEGER NOT NULL DEFAULT 0,
  terminada INTEGER NOT NULL DEFAULT 0,
  posicion  INTEGER NOT NULL,
  PRIMARY KEY (canvan_id, id)
);
CREATE TABLE IF NOT EXISTS tareas (
  canvan_id    TEXT NOT NULL REFERENCES canvan(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  columna_id   TEXT NOT NULL,
  posicion     INTEGER NOT NULL,
  titulo       TEXT NOT NULL,
  descripcion  TEXT NOT NULL DEFAULT '',
  prioridad    TEXT NOT NULL DEFAULT 'medium',
  etiquetas    TEXT NOT NULL DEFAULT '[]',   -- ids de etiquetas (JSON)
  inicio       TEXT NOT NULL DEFAULT '',     -- AAAA-MM-DD
  fecha_limite TEXT NOT NULL DEFAULT '',     -- AAAA-MM-DD
  checklist    TEXT NOT NULL DEFAULT '[]',   -- [{ id, text, done }] (JSON)
  creada       INTEGER,
  actualizada  INTEGER,
  completada   INTEGER,
  extra        TEXT,                         -- otros campos de la tarjeta (JSON)
  PRIMARY KEY (canvan_id, id)
);
CREATE INDEX IF NOT EXISTS tareas_fechas ON tareas (fecha_limite, inicio);
-- Dependencias fin → inicio: la tarea (canvan_id, tarea_id) depende de «depende_de» («proceso/tarjeta»),
-- que puede ser de otro Canvan. Sin clave foránea a propósito: la tarea previa puede borrarse.
CREATE TABLE IF NOT EXISTS dependencias (
  canvan_id  TEXT NOT NULL,
  tarea_id   TEXT NOT NULL,
  depende_de TEXT NOT NULL,
  posicion   INTEGER NOT NULL,
  PRIMARY KEY (canvan_id, tarea_id, depende_de),
  FOREIGN KEY (canvan_id, tarea_id) REFERENCES tareas (canvan_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dependencias_previa ON dependencias (depende_de);
CREATE TABLE IF NOT EXISTS gantt_config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);
-- Orden de las filas de cada proceso en el Gantt
CREATE TABLE IF NOT EXISTS gantt_orden (
  canvan_id TEXT NOT NULL,
  tarea_id  TEXT NOT NULL,
  posicion  INTEGER NOT NULL,
  PRIMARY KEY (canvan_id, tarea_id)
);
`;

const json = (v, def) => {
  try {
    return v == null ? def : JSON.parse(v);
  } catch {
    return def;
  }
};
const extraDe = (obj, conocidos) => {
  const resto = Object.fromEntries(Object.entries(obj).filter(([k]) => !conocidos.includes(k)));
  return Object.keys(resto).length ? JSON.stringify(resto) : null;
};
const CAMPOS_TARJETA = ['id', 'title', 'desc', 'priority', 'labels', 'start', 'due', 'checklist', 'createdAt', 'updatedAt', 'completedAt', 'dependeDe'];
const CAMPOS_TABLERO = ['id', 'name', 'labels', 'cards', 'columns'];

export function abrirBase(archivo) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const db = new DatabaseSync(archivo);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(ESQUEMA);
  db.prepare("INSERT OR IGNORE INTO meta (clave, valor) VALUES ('esquema', '1')").run();

  // Ejecuta fn dentro de una transacción: todo o nada. Si ya hay una abierta (por ejemplo, guardarCanvan
  // llamado desde la importación), fn corre dentro de esa.
  let abiertas = 0;
  const transaccion = (fn) => {
    if (abiertas) return fn();
    db.exec('BEGIN IMMEDIATE');
    abiertas++;
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      abiertas--;
    }
  };

  // ---------- Tableros ----------
  const q = {
    tableros: db.prepare('SELECT id, nombre, descripcion, categoria, archivo, actualizado FROM tableros ORDER BY rowid'),
    tablero: db.prepare('SELECT id, nombre, descripcion, categoria, archivo, actualizado FROM tableros WHERE id = ?'),
    insTablero: db.prepare(
      'INSERT INTO tableros (id, nombre, descripcion, categoria, archivo, actualizado) VALUES (:id, :nombre, :descripcion, :categoria, :archivo, :actualizado)',
    ),
    updTablero: db.prepare(
      'UPDATE tableros SET nombre = :nombre, descripcion = :descripcion, categoria = :categoria, actualizado = :actualizado WHERE id = :id',
    ),
    delTablero: db.prepare('DELETE FROM tableros WHERE id = ?'),
  };

  const tableros = {
    listar: () => q.tableros.all(),
    obtener: (id) => q.tablero.get(id) || null,
    agregar: ({ id, nombre, descripcion = '', categoria = 'General', archivo, actualizado }) =>
      q.insTablero.run({ id, nombre, descripcion, categoria, archivo, actualizado }),
    actualizar: ({ id, nombre, descripcion, categoria, actualizado }) => q.updTablero.run({ id, nombre, descripcion, categoria, actualizado }),
    eliminar: (id) => q.delTablero.run(id),
  };

  // ---------- Canvan ----------
  const c = {
    canvan: db.prepare('SELECT id, nombre, rev, sincronizados, extra FROM canvan WHERE id = ?'),
    etiquetas: db.prepare('SELECT id, nombre, color FROM canvan_etiquetas WHERE canvan_id = ? ORDER BY posicion'),
    columnas: db.prepare('SELECT id, titulo, color, wip, terminada FROM canvan_columnas WHERE canvan_id = ? ORDER BY posicion'),
    tareas: db.prepare('SELECT * FROM tareas WHERE canvan_id = ? ORDER BY columna_id, posicion'),
    deps: db.prepare('SELECT tarea_id, depende_de FROM dependencias WHERE canvan_id = ? ORDER BY tarea_id, posicion'),
    upsCanvan: db.prepare(`INSERT INTO canvan (id, nombre, rev, sincronizados, extra) VALUES (:id, :nombre, :rev, :sincronizados, :extra)
      ON CONFLICT (id) DO UPDATE SET nombre = excluded.nombre, rev = excluded.rev, sincronizados = excluded.sincronizados, extra = excluded.extra`),
    delEtiquetas: db.prepare('DELETE FROM canvan_etiquetas WHERE canvan_id = ?'),
    insEtiqueta: db.prepare('INSERT INTO canvan_etiquetas (canvan_id, id, nombre, color, posicion) VALUES (?, ?, ?, ?, ?)'),
    delColumnas: db.prepare('DELETE FROM canvan_columnas WHERE canvan_id = ?'),
    insColumna: db.prepare('INSERT INTO canvan_columnas (canvan_id, id, titulo, color, wip, terminada, posicion) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    idsTareas: db.prepare('SELECT id FROM tareas WHERE canvan_id = ?'),
    delTarea: db.prepare('DELETE FROM tareas WHERE canvan_id = ? AND id = ?'),
    upsTarea: db.prepare(`INSERT INTO tareas (canvan_id, id, columna_id, posicion, titulo, descripcion, prioridad, etiquetas, inicio, fecha_limite,
        checklist, creada, actualizada, completada, extra)
      VALUES (:canvan_id, :id, :columna_id, :posicion, :titulo, :descripcion, :prioridad, :etiquetas, :inicio, :fecha_limite,
        :checklist, :creada, :actualizada, :completada, :extra)
      ON CONFLICT (canvan_id, id) DO UPDATE SET columna_id = excluded.columna_id, posicion = excluded.posicion, titulo = excluded.titulo,
        descripcion = excluded.descripcion, prioridad = excluded.prioridad, etiquetas = excluded.etiquetas, inicio = excluded.inicio,
        fecha_limite = excluded.fecha_limite, checklist = excluded.checklist, creada = excluded.creada, actualizada = excluded.actualizada,
        completada = excluded.completada, extra = excluded.extra`),
    delDeps: db.prepare('DELETE FROM dependencias WHERE canvan_id = ?'),
    insDep: db.prepare('INSERT OR IGNORE INTO dependencias (canvan_id, tarea_id, depende_de, posicion) VALUES (?, ?, ?, ?)'),
  };

  // Devuelve { rev, sincronizados, board } como el JSON de antes, o null si el Canvan no existe
  function leerCanvan(id) {
    const fila = c.canvan.get(id);
    if (!fila) return null;
    const deps = new Map();
    for (const d of c.deps.all(id)) deps.set(d.tarea_id, [...(deps.get(d.tarea_id) || []), d.depende_de]);
    const columnas = c.columnas.all(id).map((col) => ({
      id: col.id, title: col.titulo, color: col.color, wip: col.wip, isDone: !!col.terminada, cardIds: [],
    }));
    const porId = new Map(columnas.map((col) => [col.id, col]));
    const cards = {};
    for (const t of c.tareas.all(id)) {
      cards[t.id] = {
        ...json(t.extra, {}),
        id: t.id,
        title: t.titulo,
        desc: t.descripcion,
        priority: t.prioridad,
        labels: json(t.etiquetas, []),
        start: t.inicio,
        due: t.fecha_limite,
        checklist: json(t.checklist, []),
        createdAt: t.creada,
        updatedAt: t.actualizada,
        completedAt: t.completada,
        ...(deps.has(t.id) ? { dependeDe: deps.get(t.id) } : {}),
      };
      (porId.get(t.columna_id) || columnas[0])?.cardIds.push(t.id);
    }
    return {
      rev: fila.rev,
      sincronizados: json(fila.sincronizados, []),
      board: {
        ...json(fila.extra, {}),
        id,
        name: fila.nombre,
        labels: c.etiquetas.all(id).map((l) => ({ id: l.id, name: l.nombre, color: l.color })),
        cards,
        columns: columnas,
      },
    };
  }

  // Guarda el Canvan completo en una transacción. Las tarjetas se actualizan en su lugar (las que ya no
  // están se borran), así no se pierden datos si algo falla a mitad de camino.
  function guardarCanvan(id, datos) {
    const { board } = datos;
    transaccion(() => {
      c.upsCanvan.run({
        id,
        nombre: board.name || id,
        rev: datos.rev,
        sincronizados: JSON.stringify(datos.sincronizados || []),
        extra: extraDe(board, CAMPOS_TABLERO),
      });
      c.delEtiquetas.run(id);
      (board.labels || []).forEach((l, i) => c.insEtiqueta.run(id, String(l.id), String(l.name ?? ''), String(l.color ?? ''), i));
      c.delColumnas.run(id);
      board.columns.forEach((col, i) =>
        c.insColumna.run(id, String(col.id), String(col.title ?? ''), String(col.color ?? '#94a3b8'), Number(col.wip) || 0, col.isDone ? 1 : 0, i),
      );

      const ubicacion = new Map();
      for (const col of board.columns) col.cardIds.forEach((cid, i) => ubicacion.set(cid, [col.id, i]));
      const vigentes = new Set(Object.keys(board.cards));
      for (const { id: tid } of c.idsTareas.all(id)) if (!vigentes.has(tid)) c.delTarea.run(id, tid);
      c.delDeps.run(id);
      for (const [cid, t] of Object.entries(board.cards)) {
        const [columna, posicion] = ubicacion.get(cid) || [board.columns[0]?.id, 1e6];
        c.upsTarea.run({
          canvan_id: id,
          id: cid,
          columna_id: String(columna ?? ''),
          posicion,
          titulo: String(t.title ?? ''),
          descripcion: String(t.desc ?? ''),
          prioridad: String(t.priority || 'medium'),
          etiquetas: JSON.stringify(Array.isArray(t.labels) ? t.labels : []),
          inicio: typeof t.start === 'string' ? t.start : '',
          fecha_limite: typeof t.due === 'string' ? t.due : '',
          checklist: JSON.stringify(Array.isArray(t.checklist) ? t.checklist : []),
          creada: Number(t.createdAt) || null,
          actualizada: Number(t.updatedAt) || null,
          completada: Number(t.completedAt) || null,
          extra: extraDe(t, CAMPOS_TARJETA),
        });
        (Array.isArray(t.dependeDe) ? t.dependeDe : []).forEach((k, i) => typeof k === 'string' && c.insDep.run(id, cid, k, i));
      }
    });
  }

  // ---------- Gantt ----------
  const g = {
    config: db.prepare('SELECT clave, valor FROM gantt_config'),
    setConfig: db.prepare('INSERT INTO gantt_config (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor'),
    orden: db.prepare('SELECT canvan_id, tarea_id FROM gantt_orden ORDER BY canvan_id, posicion'),
    delOrden: db.prepare('DELETE FROM gantt_orden WHERE canvan_id = ?'),
    insOrden: db.prepare('INSERT OR IGNORE INTO gantt_orden (canvan_id, tarea_id, posicion) VALUES (?, ?, ?)'),
  };

  function leerGantt(inicial) {
    const datos = { ...inicial, orden: {} };
    for (const { clave, valor } of g.config.all()) datos[clave] = json(valor, valor);
    for (const { canvan_id, tarea_id } of g.orden.all()) (datos.orden[canvan_id] ||= []).push(tarea_id);
    return datos;
  }

  function guardarGantt({ fechaLimite, ordenProceso }) {
    transaccion(() => {
      if (fechaLimite !== undefined) g.setConfig.run('fechaLimite', JSON.stringify(fechaLimite));
      if (ordenProceso !== undefined) {
        g.delOrden.run(ordenProceso.id);
        ordenProceso.ids.forEach((tid, i) => g.insOrden.run(ordenProceso.id, tid, i));
      }
    });
  }

  // ---------- Importación inicial desde los JSON de data/ ----------
  // Se hace una sola vez (queda registrado en meta). Los JSON no se tocan: quedan como respaldo.
  function importarJson(dataDir, log = console.log) {
    if (db.prepare("SELECT valor FROM meta WHERE clave = 'importado_json'").get()) return false;
    const leer = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
    let nTableros = 0;
    let nCanvan = 0;
    let nTareas = 0;
    transaccion(() => {
      for (const t of leer(path.join(dataDir, 'tableros.json')) || []) {
        if (!q.tablero.get(t.id)) {
          tableros.agregar({ descripcion: '', categoria: 'General', ...t });
          nTableros++;
        }
      }
      const dirCanvan = path.join(dataDir, 'canvan');
      for (const f of fs.existsSync(dirCanvan) ? fs.readdirSync(dirCanvan) : []) {
        if (!f.toLowerCase().endsWith('.json')) continue;
        const datos = leer(path.join(dirCanvan, f));
        if (!datos?.board) continue;
        guardarCanvan(f.replace(/\.json$/i, ''), datos);
        nCanvan++;
        nTareas += Object.keys(datos.board.cards || {}).length;
      }
      const gantt = leer(path.join(dataDir, 'gantt.json'));
      if (gantt?.fechaLimite) g.setConfig.run('fechaLimite', JSON.stringify(gantt.fechaLimite));
      for (const [id, ids] of Object.entries(gantt?.orden || {})) {
        if (Array.isArray(ids)) ids.forEach((tid, i) => g.insOrden.run(id, tid, i));
      }
      db.prepare("INSERT INTO meta (clave, valor) VALUES ('importado_json', ?)").run(new Date().toISOString());
    });
    log(`  Base de datos: importados ${nTableros} tableros, ${nCanvan} Canvan (${nTareas} tareas) y la configuración del Gantt desde data/*.json`);
    return true;
  }

  // Copia consistente de la base aunque el portal esté en uso
  const respaldar = (destino) => backup(db, destino);

  return { db, transaccion, tableros, leerCanvan, guardarCanvan, leerGantt, guardarGantt, importarJson, respaldar };
}
