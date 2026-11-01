// Copia de seguridad de la base del portal: data/respaldos/portal-AAAA-MM-DD-HHMM.db
// Se puede correr con el portal en marcha (usa la copia en caliente de SQLite).
//   npm run respaldo                 → guarda en data/respaldos/ y conserva las últimas 30 copias
//   npm run respaldo -- D:\copias    → guarda en otra carpeta
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origen = process.env.PORTAL_DB || path.join(ROOT, 'data', 'portal.db');
const destinoDir = path.resolve(process.argv[2] || path.join(ROOT, 'data', 'respaldos'));
const CONSERVAR = 30;

if (!fs.existsSync(origen)) {
  console.error(`No existe la base ${origen}. ¿Se inició el portal alguna vez?`);
  process.exit(1);
}
fs.mkdirSync(destinoDir, { recursive: true });
const d = new Date();
const sello = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
const destino = path.join(destinoDir, `portal-${sello}.db`);

const db = new DatabaseSync(origen, { readOnly: true });
await backup(db, destino);
db.close();
console.log(`Respaldo guardado en ${destino}`);

// Borra las copias más viejas, dejando las últimas CONSERVAR
const copias = fs.readdirSync(destinoDir).filter((f) => /^portal-\d{4}-\d{2}-\d{2}-\d{4}\.db$/.test(f)).sort();
for (const f of copias.slice(0, Math.max(0, copias.length - CONSERVAR))) fs.rmSync(path.join(destinoDir, f));
