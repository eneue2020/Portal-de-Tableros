// ---------- Fechas (siempre en hora local, como el Canvan: AAAA-MM-DD) ----------
const DIA = 864e5;
export const aISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const deISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const sumar = (iso, n) => {
  const d = deISO(iso);
  d.setDate(d.getDate() + n);
  return aISO(d);
};
export const dias = (a, b) => Math.round((deISO(b) - deISO(a)) / DIA);
export const hoyISO = () => aISO(new Date());
export const fmtCorta = (iso) => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(deISO(iso));
export const fmtLarga = (iso) => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }).format(deISO(iso));
export const fmtMes = (iso) => new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric' }).format(deISO(iso));
export const esISO = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// Inicio y fin de la barra de una tarea. Sin fecha de inicio se toma la de creación (inicio estimado);
// con una sola fecha la tarea se dibuja como hito de un día.
export function rango(t) {
  const fin = t.due || (t.hecha && t.completada) || null;
  if (t.start) return { ini: t.start, fin: fin && fin >= t.start ? fin : t.start, estimado: false };
  if (!fin) return null;
  return { ini: t.creada <= fin ? t.creada : fin, fin, estimado: true };
}
