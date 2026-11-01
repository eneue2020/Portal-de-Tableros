// Convierte un diagrama entidad-relación de draw.io (.drawio) en una vista del portal.
//
// Uso:
//   node scripts/importar-drawio.js <archivo.drawio> <id> [--nombre "..."] [--area "..."] [--descripcion "..."] [--fuente URL]
//
// Genera data/procesos/<id>.json. Si el archivo ya existe, conserva nombre, área,
// descripción y fuente salvo que se indiquen de nuevo.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [archivo, id, ...resto] = process.argv.slice(2);
if (!archivo || !id || !/^[\w-]+$/.test(id)) {
  console.error('Uso: node scripts/importar-drawio.js <archivo.drawio> <id> [--nombre "..."] [--area "..."] [--descripcion "..."] [--fuente URL]');
  process.exit(1);
}
const opciones = {};
for (let i = 0; i < resto.length; i += 2) opciones[resto[i].replace(/^--/, '')] = resto[i + 1];

// ---------- Lectura del XML ----------

function expandir(xml) {
  return xml.replace(/(<diagram[^>]*>)([^<]+)(<\/diagram>)/g, (m, a, cuerpo, c) => {
    try {
      const raw = zlib.inflateRawSync(Buffer.from(cuerpo.trim(), 'base64')).toString('utf8');
      return a + decodeURIComponent(raw) + c;
    } catch {
      return m;
    }
  });
}

const entidades = (s = '') =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#xa;|&#10;/g, ' ').replace(/&amp;/g, '&');

const texto = (s) => entidades(entidades(s)).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const atributos = (s) => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

const xml = expandir(fs.readFileSync(archivo, 'utf8'));
const pagina = xml.match(/<diagram[\s\S]*?<\/diagram>/)?.[0] ?? xml;

const celdas = [...pagina.matchAll(/<mxCell ([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g)].map((m) => {
  const a = atributos(m[1]);
  const g = (m[2] || '').match(/<mxGeometry ([^>]*)/);
  const geo = g ? atributos(g[1]) : {};
  return {
    id: a.id,
    padre: a.parent,
    estilo: a.style || '',
    valor: texto(a.value),
    arista: a.edge === '1',
    origen: a.source,
    destino: a.target,
    x: Number(geo.x) || 0,
    y: Number(geo.y) || 0,
    ancho: Number(geo.width) || 0,
    alto: Number(geo.height) || 0,
  };
});

const porId = new Map(celdas.map((c) => [c.id, c]));
const hijos = (id) => celdas.filter((c) => c.padre === id && !c.arista);

// ---------- Tablas ----------

function campo(textoClave, textoCampo) {
  // "prestador_id (int) *", "nombre String *", "cod_nomenclador(int) *", "id_plantilla_pract"
  const m = textoCampo.match(/^(.+?)\s*(?:\(([^)]*)\)|\s+([A-Za-z]\w*))?\s*(\*)?$/);
  return {
    clave: textoClave || '',
    nombre: (m?.[1] || textoCampo).trim(),
    tipo: (m?.[2] || m?.[3] || '').trim(),
    requerido: Boolean(m?.[4]),
  };
}

const tablas = [];
const filaATabla = new Map(); // id de fila draw.io -> { tabla, campo }

for (const t of celdas.filter((c) => /(^|;)shape=table(;|$)/.test(c.estilo))) {
  const tabla = { id: t.id, nombre: t.valor, x: t.x, y: t.y, ancho: t.ancho, campos: [] };
  for (const fila of hijos(t.id).filter((c) => c.estilo.includes('shape=tableRow')).sort((a, b) => a.y - b.y)) {
    const [k, v] = hijos(fila.id).sort((a, b) => a.x - b.x);
    if (!v?.valor) continue;
    const c = { id: fila.id, ...campo(k?.valor, v.valor) };
    tabla.campos.push(c);
    filaATabla.set(fila.id, { tabla: tabla.id, campo: c.id });
  }
  filaATabla.set(t.id, { tabla: t.id, campo: tabla.campos.find((c) => c.clave === 'PK')?.id ?? null });
  tablas.push(tabla);
}

// ---------- Otros elementos (notas, textos, rombos, cajas) ----------

const esTabla = (c) => c.estilo.includes('shape=table') || c.estilo.includes('shape=tableRow') || c.estilo.includes('partialRectangle');
const todos = celdas
  .filter((c) => c.padre === '1' && !c.arista && !esTabla(c) && c.valor)
  .map((c) => ({
    id: c.id,
    tipo: c.estilo.includes('shape=note') ? 'nota' : c.estilo.startsWith('text;') ? 'texto' : c.estilo.includes('rhombus') ? 'rombo' : 'caja',
    texto: c.valor,
    x: c.x,
    y: c.y,
    ancho: c.ancho,
    alto: c.alto,
  }));
// La primera nota se usa como título del diagrama y no se dibuja
const titulo = todos.find((e) => e.tipo === 'nota')?.texto;
const elementos = todos.filter((e) => e.texto !== titulo);
const idsElementos = new Set(elementos.map((e) => e.id));

// ---------- Relaciones ----------

const relaciones = [];
const conexiones = [];
const visto = new Set();

for (const e of celdas.filter((c) => c.arista && c.origen && c.destino)) {
  const desde = filaATabla.get(e.origen);
  const hasta = filaATabla.get(e.destino);
  if (desde && hasta) {
    relaciones.push({ desde, hasta });
  } else if (idsElementos.has(e.origen) && idsElementos.has(e.destino)) {
    const clave = [e.origen, e.destino].sort().join('|');
    if (!visto.has(clave)) conexiones.push({ desde: e.origen, hasta: e.destino });
    visto.add(clave);
  }
}

// Normaliza coordenadas para que el diagrama empiece en (0, 0)
const xs = [...tablas, ...elementos].map((o) => o.x);
const ys = [...tablas, ...elementos].map((o) => o.y);
const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
for (const o of [...tablas, ...elementos]) {
  o.x = Math.round(o.x - minX);
  o.y = Math.round(o.y - minY);
}

// ---------- Salida ----------

const destino = path.join(ROOT, 'data', 'procesos', `${id}.json`);
const previo = fs.existsSync(destino) ? JSON.parse(fs.readFileSync(destino, 'utf8')) : {};

const vista = {
  tipo: 'modelo',
  nombre: opciones.nombre || previo.nombre || titulo || id,
  area: opciones.area || previo.area || 'Sistemas',
  descripcion: opciones.descripcion || previo.descripcion || `Modelo de datos importado de ${path.basename(archivo)}.`,
  fuente: opciones.fuente || previo.fuente,
  tablas,
  relaciones,
  elementos,
  conexiones,
};

if (previo.correcciones && !('forzar' in opciones)) {
  console.error(
    `${path.relative(ROOT, destino)} tiene correcciones manuales (${previo.correcciones.fuente}).\n` +
      'Reimportar las reemplaza por el contenido del .drawio. Para hacerlo igual, agregá --forzar si',
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify(vista, null, 2), 'utf8');
console.log(`${tablas.length} tablas, ${relaciones.length} relaciones, ${elementos.length} elementos -> ${path.relative(ROOT, destino)}`);
