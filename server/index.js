import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const FILES_DIR = path.join(DATA_DIR, 'tableros');
const META_FILE = path.join(DATA_DIR, 'tableros.json');
const PROC_DIR = path.join(DATA_DIR, 'procesos');
const CANVAN_DIR = path.join(DATA_DIR, 'canvan');
const CANVAN_APP = path.join(ROOT, 'canvan', 'index.html');
const DIST_DIR = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

await fs.mkdir(FILES_DIR, { recursive: true });
await fs.mkdir(PROC_DIR, { recursive: true });
await fs.mkdir(CANVAN_DIR, { recursive: true });

// ---------- Metadatos ----------

async function readMeta() {
  try {
    return JSON.parse(await fs.readFile(META_FILE, 'utf8'));
  } catch {
    return [];
  }
}

async function writeMeta(list) {
  await fs.writeFile(META_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function slugify(text) {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60) || 'tablero';
}

async function titleFromHtml(file) {
  const html = await fs.readFile(file, 'utf8');
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

// Registra HTML presentes en la carpeta que todavía no figuran en tableros.json
async function syncFolder() {
  const list = await readMeta();
  const known = new Set(list.map((t) => t.archivo));
  const files = (await fs.readdir(FILES_DIR)).filter((f) => f.toLowerCase().endsWith('.html'));
  let changed = false;

  for (const archivo of files) {
    if (known.has(archivo)) continue;
    const full = path.join(FILES_DIR, archivo);
    const stat = await fs.stat(full);
    const nombre = (await titleFromHtml(full)) || archivo.replace(/\.html$/i, '');
    list.push({
      id: uniqueId(slugify(nombre), list),
      nombre,
      descripcion: '',
      categoria: 'General',
      archivo,
      actualizado: stat.mtime.toISOString(),
    });
    changed = true;
  }

  const filtered = list.filter((t) => files.includes(t.archivo));
  if (changed || filtered.length !== list.length) await writeMeta(filtered);
  return filtered;
}

function uniqueId(base, list) {
  let id = base;
  for (let i = 2; list.some((t) => t.id === id); i++) id = `${base}-${i}`;
  return id;
}

// ---------- App ----------

const app = express();
app.use(express.json({ limit: '5mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.html?$/i.test(file.originalname);
    cb(ok ? null : new Error('Solo se aceptan archivos .html'), ok);
  },
});

app.get('/api/tableros', async (_req, res, next) => {
  try {
    res.json(await syncFolder());
  } catch (err) {
    next(err);
  }
});

app.post('/api/tableros', upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo HTML' });

    const list = await syncFolder();
    const html = req.file.buffer.toString('utf8');
    const titulo = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
    const nombre = (req.body.nombre || '').trim() || titulo || req.file.originalname.replace(/\.html?$/i, '');
    const id = uniqueId(slugify(nombre), list);
    const archivo = `${id}.html`;

    await fs.writeFile(path.join(FILES_DIR, archivo), req.file.buffer);
    const tablero = {
      id,
      nombre,
      descripcion: (req.body.descripcion || '').trim(),
      categoria: (req.body.categoria || '').trim() || 'General',
      archivo,
      actualizado: new Date().toISOString(),
    };
    list.push(tablero);
    await writeMeta(list);
    res.status(201).json(tablero);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/tableros/:id', async (req, res, next) => {
  try {
    const list = await syncFolder();
    const t = list.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Tablero no encontrado' });
    for (const key of ['nombre', 'descripcion', 'categoria']) {
      if (typeof req.body[key] === 'string') t[key] = req.body[key].trim() || t[key];
    }
    await writeMeta(list);
    res.json(t);
  } catch (err) {
    next(err);
  }
});

// Reemplaza el HTML de un tablero existente (nueva versión de los datos)
app.put('/api/tableros/:id/archivo', upload.single('archivo'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo HTML' });
    const list = await syncFolder();
    const t = list.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Tablero no encontrado' });
    await fs.writeFile(path.join(FILES_DIR, t.archivo), req.file.buffer);
    t.actualizado = new Date().toISOString();
    await writeMeta(list);
    res.json(t);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/tableros/:id', async (req, res, next) => {
  try {
    const list = await syncFolder();
    const t = list.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Tablero no encontrado' });
    await fs.rm(path.join(FILES_DIR, t.archivo), { force: true });
    await writeMeta(list.filter((x) => x.id !== t.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------- Procesos (diagramas definidos en data/procesos/*.json) ----------

async function leerProceso(archivo) {
  const full = path.join(PROC_DIR, archivo);
  const [texto, stat] = await Promise.all([fs.readFile(full, 'utf8'), fs.stat(full)]);
  return { id: archivo.replace(/\.json$/i, ''), actualizado: stat.mtime.toISOString(), ...JSON.parse(texto) };
}

app.get('/api/procesos', async (_req, res, next) => {
  try {
    const archivos = (await fs.readdir(PROC_DIR)).filter((f) => f.toLowerCase().endsWith('.json'));
    const procesos = await Promise.all(archivos.map(leerProceso));
    res.json(
      procesos.map(({ id, tipo = 'flujo', nombre, area, descripcion, actualizado }) => ({ id, tipo, nombre, area, descripcion, actualizado })),
    );
  } catch (err) {
    next(err);
  }
});

app.get('/api/procesos/:id', async (req, res, next) => {
  try {
    if (!/^[\w-]+$/.test(req.params.id)) return res.status(404).json({ error: 'Proceso no encontrado' });
    res.json(await leerProceso(`${req.params.id}.json`));
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Proceso no encontrado' });
    next(err);
  }
});

// ---------- Canvan (un tablero kanban por proceso, en data/canvan/*.json) ----------

const COLORES_ETIQUETA = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#3b82f6', '#22c55e'];
const nuevoId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

// Pendientes del proceso: los de cada paso y las observaciones de tipo «pendiente».
// Si el mismo texto figura en un paso y en las observaciones, queda uno solo (el del paso).
function pendientesDe(proceso) {
  const carriles = Object.fromEntries((proceso.carriles || []).map((c) => [c.id, c.nombre]));
  const porTexto = new Map();
  for (const n of proceso.nodos || []) {
    if (n.pendiente && !porTexto.has(n.pendiente)) {
      porTexto.set(n.pendiente, { texto: n.pendiente, origen: `Paso «${n.titulo}»`, area: carriles[n.carril] });
    }
  }
  for (const o of proceso.observaciones || []) {
    if (o.tipo === 'pendiente' && !porTexto.has(o.texto)) {
      porTexto.set(o.texto, { texto: o.texto, origen: 'Observación general del proceso' });
    }
  }
  return [...porTexto.values()];
}

function canvanVacio(proceso) {
  const areas = (proceso.carriles || []).map((c) => c.nombre);
  return {
    rev: 0,
    sincronizados: [],
    board: {
      id: proceso.id,
      name: proceso.nombre,
      labels: areas.map((name, i) => ({ id: nuevoId(), name, color: COLORES_ETIQUETA[i % COLORES_ETIQUETA.length] })),
      cards: {},
      columns: [
        { id: nuevoId(), title: 'Por hacer', color: '#94a3b8', wip: 0, isDone: false, cardIds: [] },
        { id: nuevoId(), title: 'En progreso', color: '#3b82f6', wip: 0, isDone: false, cardIds: [] },
        { id: nuevoId(), title: 'Completado', color: '#22c55e', wip: 0, isDone: true, cardIds: [] },
      ],
    },
  };
}

// Agrega a «Por hacer» los pendientes del proceso que todavía no pasaron al canvan.
// Cada pendiente se agrega una sola vez: si se borra la tarjeta, no vuelve a aparecer.
function sincronizarCanvan(datos, proceso) {
  const ya = new Set(datos.sincronizados);
  const nuevos = pendientesDe(proceso).filter((p) => !ya.has(p.texto));
  if (!nuevos.length) return false;
  const { board } = datos;
  const porHacer = board.columns.find((c) => !c.isDone) || board.columns[0];
  const now = Date.now();
  for (const p of nuevos) {
    const etiqueta = p.area && board.labels.find((l) => l.name === p.area);
    const card = {
      id: nuevoId(), title: p.texto, desc: `${p.origen} · ${proceso.nombre}`, priority: 'medium',
      labels: etiqueta ? [etiqueta.id] : [], due: '', checklist: [], createdAt: now, updatedAt: now, completedAt: null,
    };
    board.cards[card.id] = card;
    porHacer?.cardIds.push(card.id);
    datos.sincronizados.push(p.texto);
  }
  return true;
}

async function leerCanvan(id) {
  const proceso = await leerProceso(`${id}.json`);
  const archivo = path.join(CANVAN_DIR, `${id}.json`);
  let datos;
  try {
    datos = JSON.parse(await fs.readFile(archivo, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    datos = canvanVacio(proceso);
  }
  datos.board.name = proceso.nombre;
  if (sincronizarCanvan(datos, proceso) || datos.rev === 0) {
    datos.rev += 1;
    await fs.writeFile(archivo, JSON.stringify(datos, null, 2), 'utf8');
  }
  return { proceso, datos };
}

const idValido = (id) => /^[\w-]+$/.test(id);

app.get('/api/canvan', async (_req, res, next) => {
  try {
    const archivos = (await fs.readdir(PROC_DIR)).filter((f) => f.toLowerCase().endsWith('.json'));
    const lista = await Promise.all(
      archivos.map(async (f) => {
        const { proceso, datos } = await leerCanvan(f.replace(/\.json$/i, ''));
        const cols = datos.board.columns;
        const total = cols.reduce((s, c) => s + c.cardIds.length, 0);
        const hechas = cols.filter((c) => c.isDone).reduce((s, c) => s + c.cardIds.length, 0);
        return { id: proceso.id, nombre: proceso.nombre, area: proceso.area, porHacer: cols[0]?.cardIds.length || 0, total, hechas };
      }),
    );
    res.json(lista);
  } catch (err) {
    next(err);
  }
});

app.get('/api/canvan/:id', async (req, res, next) => {
  try {
    if (!idValido(req.params.id)) return res.status(404).json({ error: 'Canvan no encontrado' });
    const { datos } = await leerCanvan(req.params.id);
    res.json({ rev: datos.rev, board: datos.board });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Canvan no encontrado' });
    next(err);
  }
});

// Guarda el tablero completo. «rev» evita pisar cambios de otra persona: si no coincide, responde 409.
app.put('/api/canvan/:id', async (req, res, next) => {
  try {
    if (!idValido(req.params.id)) return res.status(404).json({ error: 'Canvan no encontrado' });
    const { datos } = await leerCanvan(req.params.id);
    const { rev, board } = req.body || {};
    if (!board || !Array.isArray(board.columns) || typeof board.cards !== 'object') {
      return res.status(400).json({ error: 'Tablero inválido' });
    }
    if (rev !== datos.rev) return res.status(409).json({ error: 'Otra persona modificó este canvan', rev: datos.rev, board: datos.board });
    datos.board = { ...board, id: req.params.id };
    datos.rev += 1;
    await fs.writeFile(path.join(CANVAN_DIR, `${req.params.id}.json`), JSON.stringify(datos, null, 2), 'utf8');
    res.json({ rev: datos.rev });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Canvan no encontrado' });
    next(err);
  }
});

app.get('/canvan', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(CANVAN_APP);
});

// ---------- Gantt (configuración compartida en data/gantt.json) ----------

const GANTT_FILE = path.join(DATA_DIR, 'gantt.json');
// fechaLimite: fecha límite del plan · orden: { <proceso>: [ids de tarjeta] }, el orden de las filas en el Gantt
const GANTT_INICIAL = { fechaLimite: '2026-12-31', orden: {} };
const esFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

async function leerGantt() {
  try {
    return { ...GANTT_INICIAL, ...JSON.parse(await fs.readFile(GANTT_FILE, 'utf8')) };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...GANTT_INICIAL };
    throw err;
  }
}

app.get('/api/gantt', async (_req, res, next) => {
  try {
    res.json(await leerGantt());
  } catch (err) {
    next(err);
  }
});

// Cambios parciales: la fecha límite y/o el orden de un proceso (solo ese, para no pisar el de los demás)
app.put('/api/gantt', async (req, res, next) => {
  try {
    const { fechaLimite, ordenProceso } = req.body || {};
    if (fechaLimite === undefined && ordenProceso === undefined) return res.status(400).json({ error: 'Sin cambios' });
    if (fechaLimite !== undefined && !esFecha(fechaLimite)) return res.status(400).json({ error: 'Fecha límite inválida' });
    if (
      ordenProceso !== undefined &&
      !(typeof ordenProceso?.id === 'string' && idValido(ordenProceso.id) && Array.isArray(ordenProceso.ids) && ordenProceso.ids.every((x) => typeof x === 'string'))
    ) {
      return res.status(400).json({ error: 'Orden inválido' });
    }
    const datos = await leerGantt();
    if (fechaLimite !== undefined) datos.fechaLimite = fechaLimite;
    if (ordenProceso !== undefined) datos.orden = { ...datos.orden, [ordenProceso.id]: ordenProceso.ids };
    await fs.writeFile(GANTT_FILE, JSON.stringify(datos, null, 2), 'utf8');
    res.json(datos);
  } catch (err) {
    next(err);
  }
});

// Sirve el HTML de cada tablero (se muestra dentro de un iframe aislado)
app.get('/ver/:id', async (req, res, next) => {
  try {
    const t = (await readMeta()).find((x) => x.id === req.params.id);
    if (!t) return res.status(404).send('Tablero no encontrado');
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(FILES_DIR, t.archivo));
  } catch (err) {
    next(err);
  }
});

// Frontend compilado (npm run build)
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api|\/ver).*/, (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res.send('Frontend no compilado. Ejecutá <code>npm run build</code> o usá <code>npm run dev</code>.'),
  );
}

app.use((err, _req, res, _next) => {
  const status = err instanceof multer.MulterError || /\.html/.test(err.message) ? 400 : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message });
});

app.listen(PORT, HOST, () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log('\n  Portal de Tableros en marcha');
  console.log(`  Local:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Red:    http://${ip}:${PORT}`);
  console.log('');
});
