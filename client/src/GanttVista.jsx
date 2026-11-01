import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './Icon.jsx';
import { SaludProyecto, calcularSalud } from './SaludProyecto.jsx';
import { aISO, deISO, sumar, dias, hoyISO, fmtCorta, fmtLarga, fmtMes, esISO, rango } from './fechas.js';

const ESCALAS = { semanas: { dw: 26, nombre: 'Semanas' }, meses: { dw: 7, nombre: 'Meses' } };
const ANCHO_IZQ = 320;
const PRIORIDAD = { urgent: 'Urgente', high: 'Alta', medium: 'Media', low: 'Baja' };

const LIMITE_INICIAL = '2026-12-31';

// Un 404 en /api/gantt significa que el servidor sigue corriendo una versión anterior del portal
const motivo = (e) => (e.status === 404 ? 'el servidor del portal está desactualizado, hay que reiniciarlo' : e.message);

// Todas las tarjetas de todos los canvan, en el orden de sus columnas, y la fecha límite general del Gantt
async function cargarTareas() {
  const [lista, config] = await Promise.all([api.listarCanvan(), api.gantt().catch(() => ({ fechaLimite: LIMITE_INICIAL }))]);
  const tableros = await Promise.all(lista.map((k) => api.canvan(k.id).then((d) => ({ k, board: d.board }))));
  const tareas = [];
  for (const { k, board } of tableros) {
    for (const col of board.columns) {
      for (const id of col.cardIds) {
        const c = board.cards[id];
        if (!c) continue;
        const pasos = c.checklist || [];
        tareas.push({
          key: `${k.id}/${id}`,
          canvan: k.id,
          proceso: k.nombre,
          id,
          titulo: c.title,
          desc: c.desc,
          prioridad: c.priority,
          columna: col.title,
          color: col.color,
          hecha: col.isDone,
          sinEmpezar: !col.isDone && board.columns[0] === col, // sigue en la primera columna («Por hacer»)
          start: esISO(c.start) ? c.start : '',
          due: esISO(c.due) ? c.due : '',
          creada: aISO(new Date(c.createdAt || Date.now())),
          completada: c.completedAt ? aISO(new Date(c.completedAt)) : '',
          avance: pasos.length ? pasos.filter((p) => p.done).length / pasos.length : null,
          // Tareas de las que depende (fin → inicio), como claves «proceso/tarjeta»; pueden ser de otro proceso
          deps: Array.isArray(c.dependeDe) ? c.dependeDe.filter((k) => typeof k === 'string' && k.includes('/')) : [],
        });
      }
    }
  }
  const orden = config.orden && typeof config.orden === 'object' ? config.orden : {};
  return { procesos: lista, tareas: ordenar(tareas, orden), orden, limite: esISO(config.fechaLimite) ? config.fechaLimite : LIMITE_INICIAL };
}

// Orden de las filas guardado en el Gantt (por proceso). Las tareas que no figuran, por ejemplo las nuevas,
// quedan al final en el orden en que están en el Canvan.
function ordenar(tareas, orden) {
  const pos = new Map();
  for (const [canvan, ids] of Object.entries(orden)) if (Array.isArray(ids)) ids.forEach((id, i) => pos.set(`${canvan}/${id}`, i));
  return tareas
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.canvan.localeCompare(b.t.canvan) || (pos.get(a.t.key) ?? Infinity) - (pos.get(b.t.key) ?? Infinity) || a.i - b.i)
    .map(({ t }) => t);
}

// Guarda cambios de una tarjeta (fechas y dependencias) en el canvan del proceso. Si otra persona guardó a la vez
// (409), reintenta una vez sobre la versión nueva: solo cambia esta tarjeta, así que no pisa el cambio ajeno.
async function guardarTarea(t, cambios) {
  for (let intento = 0; ; intento++) {
    const { rev, board } = await api.canvan(t.canvan);
    const c = board.cards[t.id];
    if (!c) throw new Error('La tarea ya no existe en el Canvan');
    Object.assign(c, cambios);
    c.updatedAt = Date.now();
    try {
      return await api.guardarCanvan(t.canvan, rev, board);
    } catch (e) {
      if (e.status !== 409 || intento) throw e;
    }
  }
}

export function GanttVista({ ir, onAviso }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [escala, setEscala] = useState('semanas');
  const [filtroProceso, setFiltroProceso] = useState('');
  const [ocultas, setOcultas] = useState(() => new Set()); // columnas (estados) ocultas
  const [soloConFechas, setSoloConFechas] = useState(false);
  const [editando, setEditando] = useState(null); // { tarea, start, due }
  const [arrastre, setArrastre] = useState(null); // { key, ini, fin }
  const [reorden, setReorden] = useState(null); // { canvan, key, destino, valido }: fila que se arrastra para cambiar el orden
  const evitarClic = useRef(false);
  const [limiteArrastre, setLimiteArrastre] = useState(null); // fecha límite mientras se arrastra
  const scrollRef = useRef(null);

  const recargar = useCallback(async () => {
    try {
      setDatos(await cargarTareas());
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const hoy = hoyISO();
  const { dw } = ESCALAS[escala];

  const columnas = useMemo(() => {
    const m = new Map();
    for (const t of datos?.tareas || []) if (!m.has(t.columna)) m.set(t.columna, t.color);
    return [...m];
  }, [datos]);

  const visibles = useMemo(
    () =>
      (datos?.tareas || []).filter(
        (t) => (!filtroProceso || t.canvan === filtroProceso) && !ocultas.has(t.columna) && (!soloConFechas || rango(t)),
      ),
    [datos, filtroProceso, ocultas, soloConFechas],
  );

  const grupos = useMemo(() => {
    const m = new Map();
    for (const t of visibles) {
      if (!m.has(t.canvan)) m.set(t.canvan, { id: t.canvan, nombre: t.proceso, tareas: [] });
      m.get(t.canvan).tareas.push(t);
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [visibles]);

  // Período visible: todas las barras más hoy, con margen; arranca un lunes (semanas) o el día 1 (meses)
  const periodo = useMemo(() => {
    let min = sumar(hoy, -7);
    let max = sumar(hoy, 56);
    if (datos?.limite) {
      if (datos.limite < min) min = datos.limite;
      if (datos.limite > max) max = datos.limite;
    }
    for (const t of datos?.tareas || []) {
      const r = rango(t);
      if (!r) continue;
      if (r.ini < min) min = r.ini;
      if (r.fin > max) max = r.fin;
    }
    let desde = sumar(min, -3);
    const d = deISO(desde);
    desde = escala === 'meses' ? aISO(new Date(d.getFullYear(), d.getMonth(), 1)) : sumar(desde, -((d.getDay() + 6) % 7));
    const hasta = sumar(max, escala === 'meses' ? 45 : 21);
    return { desde, n: dias(desde, hasta) + 1 };
  }, [datos, escala, hoy]);

  const x = (iso) => dias(periodo.desde, iso) * dw;
  const anchoLinea = periodo.n * dw;

  // Encabezado: meses arriba; abajo, días (semanas) o el lunes de cada semana (meses)
  const encabezado = useMemo(() => {
    const meses = [];
    const marcas = [];
    for (let i = 0; i < periodo.n; i++) {
      const iso = sumar(periodo.desde, i);
      const d = deISO(iso);
      if (i === 0 || d.getDate() === 1) meses.push({ iso, i });
      if (escala === 'semanas') marcas.push({ i, texto: d.getDate(), finde: d.getDay() === 0 || d.getDay() === 6, lunes: d.getDay() === 1 });
      else if (d.getDay() === 1) marcas.push({ i, texto: d.getDate(), lunes: true });
    }
    return {
      meses: meses.map((m, j) => ({ ...m, ancho: ((meses[j + 1]?.i ?? periodo.n) - m.i) * dw })),
      marcas,
    };
  }, [periodo, escala, dw]);

  // Al abrir (y al cambiar de escala) se muestra hoy cerca del borde izquierdo
  const irAHoy = () => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, x(hoy) - 7 * dw);
  };
  const cargado = !!datos;
  useEffect(() => irAHoy(), [cargado, escala, periodo.desde]); // eslint-disable-line react-hooks/exhaustive-deps

  function alternarColumna(c) {
    setOcultas((s) => {
      const n = new Set(s);
      n.has(c) ? n.delete(c) : n.add(c);
      return n;
    });
  }

  function abrirEditor(t, desdeClic) {
    const r = rango(t);
    const start = t.start || (desdeClic ?? r?.ini ?? hoy);
    const due = t.due || (desdeClic ? sumar(desdeClic, 6) : r?.fin ?? sumar(start, 6));
    setEditando({ tarea: t, start, due });
  }

  // cambios: { start, due } y/o { deps }. Se ve enseguida y se confirma recargando del servidor.
  async function aplicar(t, cambios, aviso) {
    setDatos((d) => d && { ...d, tareas: d.tareas.map((x) => (x.key === t.key ? { ...x, ...cambios } : x)) });
    const { deps, ...resto } = cambios;
    try {
      await guardarTarea(t, deps ? { ...resto, dependeDe: deps } : resto);
      onAviso(aviso || (cambios.start || cambios.due ? 'Fechas guardadas en el Canvan' : 'Fechas quitadas'));
    } catch (e) {
      onAviso(`No se pudo guardar: ${e.message}`);
    }
    recargar();
  }

  // Arrastre: el centro de la barra la mueve; los bordes cambian el inicio o el fin. Ajusta por días.
  function empezarArrastre(e, t, r) {
    if (e.button !== 0) return;
    const caja = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - caja.left;
    const borde = Math.min(8, caja.width / 3);
    const modo = px < borde ? 'ini' : px > caja.width - borde ? 'fin' : 'mover';
    const x0 = e.clientX;
    let actual = { key: t.key, ini: r.ini, fin: r.fin, movio: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    const mover = (ev) => {
      const d = Math.round((ev.clientX - x0) / dw);
      let ini = r.ini;
      let fin = r.fin;
      if (modo === 'mover') {
        ini = sumar(r.ini, d);
        fin = sumar(r.fin, d);
      } else if (modo === 'ini') ini = sumar(r.ini, Math.min(d, dias(r.ini, r.fin)));
      else fin = sumar(r.fin, Math.max(d, -dias(r.ini, r.fin)));
      actual = { key: t.key, ini, fin, movio: actual.movio || Math.abs(ev.clientX - x0) > 3 };
      setArrastre(actual);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      setArrastre(null);
      if (!actual.movio) abrirEditor(t);
      else if (actual.ini !== r.ini || actual.fin !== r.fin || r.estimado) aplicar(t, { start: actual.ini, due: actual.fin });
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  // Lleva la tarea t a la posición «destino» entre las filas visibles de su proceso (0 = arriba de todo,
  // g.tareas.length = abajo de todo). Las filas ocultas por los filtros conservan su lugar relativo.
  function reubicar(t, g, destino) {
    const vis = g.tareas.map((x) => x.key);
    const desde = vis.indexOf(t.key);
    if (destino < 0 || destino > vis.length || destino === desde || destino === desde + 1) return;
    const keys = datos.tareas.filter((x) => x.canvan === t.canvan).map((x) => x.key).filter((k) => k !== t.key);
    const pos = destino < vis.length ? keys.indexOf(vis[destino]) : keys.indexOf(vis[vis.length - 1]) + 1;
    keys.splice(pos, 0, t.key);
    guardarOrden(t.canvan, keys.map((k) => k.slice(t.canvan.length + 1)));
  }

  async function guardarOrden(canvan, ids) {
    setDatos((d) => {
      if (!d) return d;
      const orden = { ...d.orden, [canvan]: ids };
      return { ...d, orden, tareas: ordenar(d.tareas, orden) };
    });
    try {
      await api.guardarGantt({ ordenProceso: { id: canvan, ids } });
    } catch (e) {
      onAviso(`No se pudo guardar el orden: ${motivo(e)}`);
      recargar();
    }
  }

  // Arrastre vertical desde el nombre (o el asa) de la tarea: después de 5 px se convierte en cambio de orden
  // y el clic que sigue al soltar no abre el editor.
  function empezarReorden(e, t, g) {
    if (e.button !== 0) return;
    const grupo = e.currentTarget.closest('.gantt-grupo');
    const desde = g.tareas.findIndex((x) => x.key === t.key);
    const y0 = e.clientY;
    let activo = false;
    let destino = desde;
    if (e.target.closest('.gantt-asa')) e.preventDefault();
    const mover = (ev) => {
      if (!activo) {
        if (Math.abs(ev.clientY - y0) < 5) return;
        activo = true;
        evitarClic.current = true;
        document.body.classList.add('gantt-reordenando');
      }
      const sc = scrollRef.current;
      const caja = sc.getBoundingClientRect();
      if (ev.clientY < caja.top + 80) sc.scrollTop -= 14;
      else if (ev.clientY > caja.bottom - 30) sc.scrollTop += 14;
      const filas = [...grupo.querySelectorAll('.gantt-fila[data-key]')];
      destino = filas.findIndex((f) => {
        const r = f.getBoundingClientRect();
        return ev.clientY < r.top + r.height / 2;
      });
      if (destino < 0) destino = filas.length;
      setReorden({ canvan: t.canvan, key: t.key, destino, valido: destino !== desde && destino !== desde + 1 });
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.classList.remove('gantt-reordenando');
      setReorden(null);
      if (!activo) return;
      setTimeout(() => (evitarClic.current = false), 0);
      reubicar(t, g, destino);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  async function guardarLimite(fecha) {
    if (!esISO(fecha) || fecha === datos.limite) return;
    const anterior = datos.limite;
    setDatos((d) => d && { ...d, limite: fecha });
    try {
      await api.guardarGantt({ fechaLimite: fecha });
      onAviso(`Fecha límite: ${fmtLarga(fecha)}`);
    } catch (e) {
      setDatos((d) => d && { ...d, limite: anterior });
      onAviso(`No se pudo guardar la fecha límite: ${motivo(e)}`);
    }
  }

  // La fecha límite se arrastra desde su marca en el encabezado, de a un día y dentro del período visible
  function arrastrarLimite(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const base = datos.limite;
    let actual = base;
    const mover = (ev) => {
      const d = Math.round((ev.clientX - x0) / dw);
      const tope = dias(periodo.desde, base);
      actual = sumar(base, Math.max(-tope, Math.min(periodo.n - 1 - tope, d)));
      setLimiteArrastre(actual);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      setLimiteArrastre(null);
      guardarLimite(actual);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  if (error) return <div className="estado">{error}</div>;
  if (!datos) return <div className="estado">Cargando…</div>;

  const limite = limiteArrastre || datos.limite;
  const conFechas = datos.tareas.filter((t) => rango(t)).length;

  // Estado de salud: de todo el proyecto, o del proceso elegido en el filtro (los demás filtros no lo cambian)
  const procesoFiltrado = datos.procesos.find((p) => p.id === filtroProceso);
  const salud = calcularSalud(procesoFiltrado ? datos.tareas.filter((t) => t.canvan === filtroProceso) : datos.tareas, hoy, datos.limite);
  const alertasDe = new Map();
  for (const a of salud.alertas) {
    if (!a.tarea || a.nivel === 'aviso') continue;
    const prev = alertasDe.get(a.tarea.key);
    alertasDe.set(a.tarea.key, { nivel: prev?.nivel === 'critica' ? 'critica' : a.nivel, textos: [...(prev?.textos || []), a.texto] });
  }
  function abrirDesdeAlerta(t) {
    document.querySelector(`.gantt-fila[data-key="${CSS.escape(t.key)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    abrirEditor(t);
  }

  // Dependencias (fin → inicio). Hay conflicto si la tarea empieza antes de que termine una de la que depende.
  const porKey = new Map(datos.tareas.map((t) => [t.key, t]));
  const rangoVista = (t) => (arrastre?.key === t.key ? { ...rango(t), ini: arrastre.ini, fin: arrastre.fin, estimado: false } : rango(t));
  const enConflicto = (previa, t) => {
    const rp = rangoVista(previa);
    const rt = rangoVista(t);
    return !!(rp && rt && !t.hecha && rt.ini <= rp.fin);
  };

  // Centro vertical de cada fila visible, para dibujar las flechas: encabezado 52 px, proceso 34 px, tarea 36 px
  const filaY = new Map();
  let altoTabla = 52;
  for (const g of grupos) {
    altoTabla += 34;
    for (const t of g.tareas) {
      filaY.set(t.key, altoTabla + 18);
      altoTabla += 36;
    }
  }
  const flechas = [];
  for (const t of visibles) {
    const rt = rangoVista(t);
    if (!rt) continue;
    for (const k of t.deps) {
      const previa = porKey.get(k);
      const rp = previa && filaY.has(k) ? rangoVista(previa) : null;
      if (!rp) continue;
      const x1 = x(rp.fin) + dw;
      const y1 = filaY.get(k);
      const x2 = x(rt.ini);
      const y2 = filaY.get(t.key);
      const g = 8;
      // Si hay lugar, codo simple; si no, la flecha baja (o sube) hasta el borde de la fila y vuelve hacia la izquierda
      const d =
        x2 - x1 >= 2 * g
          ? `M${x1} ${y1}H${x1 + g}V${y2}H${x2 - 1}`
          : `M${x1} ${y1}H${x1 + g}V${y2 + (y2 > y1 ? -18 : 18)}H${x2 - g}V${y2}H${x2 - 1}`;
      flechas.push({ key: `${k}>${t.key}`, d, conflicto: enConflicto(previa, t), titulo: `«${previa.titulo}» → «${t.titulo}»` });
    }
  }
  // Variables para la grilla de fondo: la línea de cada semana cae en el lunes
  const fondo = {
    '--dw': `${dw}px`,
    '--semana': `${7 * dw}px`,
    '--lunes': `${((8 - deISO(periodo.desde).getDay()) % 7) * dw}px`,
  };

  return (
    <div className="gantt">
      <div className="gantt-barra">
        <div className="gantt-resumen">
          <b>{datos.tareas.length}</b> tareas · <b>{conFechas}</b> con fechas · <b>{datos.tareas.length - conFechas}</b> sin fechas
        </div>
        <div className="gantt-filtros">
          <select value={filtroProceso} onChange={(e) => setFiltroProceso(e.target.value)} aria-label="Proceso">
            <option value="">Todos los procesos</option>
            {datos.procesos
              .slice()
              .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
          </select>
          {columnas.map(([c, color]) => (
            <button
              key={c}
              type="button"
              className={`gantt-chip ${ocultas.has(c) ? 'off' : ''}`}
              aria-pressed={!ocultas.has(c)}
              onClick={() => alternarColumna(c)}
            >
              <i style={{ background: color }} />
              {c}
            </button>
          ))}
          <label className="gantt-check">
            <input type="checkbox" checked={soloConFechas} onChange={(e) => setSoloConFechas(e.target.checked)} />
            Solo con fechas
          </label>
          <div className="gantt-seg" role="group" aria-label="Escala">
            {Object.entries(ESCALAS).map(([k, v]) => (
              <button key={k} type="button" className={escala === k ? 'on' : ''} onClick={() => setEscala(k)}>
                {v.nombre}
              </button>
            ))}
          </div>
          <label className="gantt-limite-campo" title="Fecha límite del plan: también se puede arrastrar su marca en el encabezado">
            Fecha límite
            <input
              type="date"
              value={limite}
              onChange={(e) => e.target.value.slice(0, 4) >= '2000' && guardarLimite(e.target.value)}
            />
          </label>
          <button type="button" className="btn" onClick={irAHoy}>
            Hoy
          </button>
        </div>
      </div>

      <SaludProyecto salud={salud} nombre={procesoFiltrado ? procesoFiltrado.nombre : 'Proyecto Bymovi'} onAbrir={abrirDesdeAlerta} />

      {conFechas === 0 && (
        <p className="gantt-ayuda">
          Ninguna tarea tiene fechas todavía. Tocá una tarea (o su fila, en el día en que empieza) para asignarle inicio y fin, o
          cargalas en el Canvan con «Fecha de inicio» y «Fecha límite».
        </p>
      )}

      <div className="gantt-scroll" ref={scrollRef} style={fondo}>
        <div className="gantt-tabla" style={{ width: ANCHO_IZQ + anchoLinea }}>
          <div className="gantt-cab">
            <div className="gantt-izq gantt-cab-izq">Tarea</div>
            <div className="gantt-linea" style={{ width: anchoLinea }}>
              <div className="gantt-meses">
                {encabezado.meses.map((m) => (
                  <span key={m.iso} style={{ left: m.i * dw, width: m.ancho }}>
                    {fmtMes(m.iso)}
                  </span>
                ))}
              </div>
              <div className="gantt-dias">
                {encabezado.marcas.map((m) => (
                  <span key={m.i} className={`${m.finde ? 'finde' : ''} ${m.lunes ? 'lunes' : ''}`} style={{ left: m.i * dw, width: escala === 'semanas' ? dw : 7 * dw }}>
                    {m.texto}
                  </span>
                ))}
              </div>
              <button
                type="button"
                className={`gantt-limite-marca ${limiteArrastre ? 'arrastrando' : ''}`}
                style={{ left: x(limite) + dw }}
                onPointerDown={arrastrarLimite}
                onKeyDown={(e) => {
                  const paso = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
                  if (paso) {
                    e.preventDefault();
                    guardarLimite(sumar(datos.limite, paso));
                  }
                }}
                title={`Fecha límite: ${fmtLarga(limite)}\nArrastrala para moverla (o usá las flechas ← →)`}
                aria-label={`Fecha límite ${fmtLarga(limite)}. Flechas izquierda y derecha para moverla un día.`}
              >
                Límite · {fmtCorta(limite)}
              </button>
            </div>
          </div>

          {grupos.map((g) => (
            <div key={g.id} className="gantt-grupo">
              <div className="gantt-fila gantt-fila-grupo">
                <div className="gantt-izq">
                  <button type="button" className="enlace" onClick={() => ir('canvan', g.id)} title="Abrir el Canvan">
                    {g.nombre}
                  </button>
                  <span className="gantt-n">{g.tareas.length}</span>
                </div>
                <div className="gantt-linea gantt-fondo" style={{ width: anchoLinea }} />
              </div>
              {g.tareas.map((t, i) => {
                const base = rango(t);
                const r = rangoVista(t);
                const previas = t.deps.map((k) => porKey.get(k)).filter(Boolean);
                const bloqueada = previas.filter((p) => enConflicto(p, t));
                const vencida = !t.hecha && t.due && t.due < hoy;
                const hito = r && r.ini === r.fin && !(t.start && t.due);
                const pasada = r && !t.hecha && !vencida && r.fin > limite;
                const destino = reorden?.canvan === g.id && reorden.valido ? reorden.destino : -1;
                const clases = [
                  'gantt-fila',
                  reorden?.key === t.key ? 'arrastrada' : '',
                  destino === i ? 'soltar-antes' : '',
                  destino === g.tareas.length && i === g.tareas.length - 1 ? 'soltar-despues' : '',
                ].join(' ');
                return (
                  <div key={t.key} className={clases} data-key={t.key}>
                    <div className="gantt-izq gantt-tarea" onPointerDown={(e) => empezarReorden(e, t, g)}>
                      <span className="gantt-asa" title="Arrastrá para cambiar el orden">
                        <Icon name="grip" />
                      </span>
                      <button
                        type="button"
                        className="gantt-tarea-btn"
                        onClick={() => !evitarClic.current && abrirEditor(t)}
                        onKeyDown={(e) => {
                          if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                          e.preventDefault();
                          reubicar(t, g, e.key === 'ArrowUp' ? i - 1 : i + 2);
                        }}
                        title={`${t.titulo}\nAlt + ↑ / ↓ para cambiar el orden`}
                      >
                        <i className="gantt-punto" style={{ background: t.color }} />
                        <span className="gantt-titulo">{t.titulo}</span>
                        {alertasDe.has(t.key) && (
                          <span className={`gantt-alerta ${alertasDe.get(t.key).nivel}`} title={alertasDe.get(t.key).textos.join('\n')}>
                            !
                          </span>
                        )}
                        {!base && <span className="gantt-sin">sin fechas</span>}
                      </button>
                    </div>
                    <div
                      className="gantt-linea gantt-fondo"
                      style={{ width: anchoLinea }}
                      onClick={(e) => {
                        if (base || e.target !== e.currentTarget) return;
                        const caja = e.currentTarget.getBoundingClientRect();
                        abrirEditor(t, sumar(periodo.desde, Math.floor((e.clientX - caja.left) / dw)));
                      }}
                    >
                      {r && (
                        <button
                          type="button"
                          className={`gantt-bar ${r.estimado ? 'estimado' : ''} ${vencida ? 'vencida' : ''} ${pasada ? 'pasada' : ''} ${hito ? 'hito' : ''}`}
                          style={{ left: x(r.ini), width: (dias(r.ini, r.fin) + 1) * dw, '--c': t.color }}
                          onPointerDown={(e) => empezarArrastre(e, t, base)}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), abrirEditor(t))}
                          title={`${t.titulo}\n${fmtCorta(r.ini)} → ${fmtCorta(r.fin)} (${dias(r.ini, r.fin) + 1} días) · ${t.columna}${
                            r.estimado ? '\nInicio estimado: fecha de creación de la tarea' : ''
                          }${vencida ? '\nVencida' : ''}${pasada ? '\nTermina después de la fecha límite' : ''}${t.avance !== null ? `\nAvance ${Math.round(t.avance * 100)}%` : ''}${
                            previas.length ? `\nDepende de: ${previas.map((p) => `«${p.titulo}»`).join(', ')}` : ''
                          }${bloqueada.length ? `\n⚠ Empieza antes de que termine ${bloqueada.map((p) => `«${p.titulo}»`).join(', ')}` : ''}`}
                        >
                          {t.avance !== null && <i className="gantt-avance" style={{ width: `${t.avance * 100}%` }} />}
                          <span>{dias(r.ini, r.fin) * dw > 90 ? t.titulo : ''}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {grupos.length === 0 && <p className="vacio gantt-vacio">No hay tareas con estos filtros.</p>}

          {flechas.length > 0 && (
            <svg className="gantt-deps" width={anchoLinea} height={altoTabla} style={{ left: ANCHO_IZQ }} aria-hidden="true">
              <defs>
                <marker id="gantt-punta" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0L8 4L0 8z" className="gantt-punta" />
                </marker>
                <marker id="gantt-punta-mal" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0L8 4L0 8z" className="gantt-punta mal" />
                </marker>
              </defs>
              {flechas.map((f) => (
                <path
                  key={f.key}
                  d={f.d}
                  className={`gantt-flecha ${f.conflicto ? 'mal' : ''}`}
                  markerEnd={`url(#${f.conflicto ? 'gantt-punta-mal' : 'gantt-punta'})`}
                >
                  <title>{f.titulo + (f.conflicto ? ' · empieza antes de que termine la anterior' : '')}</title>
                </path>
              ))}
            </svg>
          )}

          <div className="gantt-hoy" style={{ left: ANCHO_IZQ + x(hoy) + dw / 2 }} title={`Hoy · ${fmtCorta(hoy)}`} />
          <div className="gantt-limite" style={{ left: ANCHO_IZQ + x(limite) + dw }} />
        </div>
      </div>

      {editando && (
        <EditorTarea
          editando={editando}
          tareas={datos.tareas}
          onCancel={() => setEditando(null)}
          onCanvan={() => ir('canvan', editando.tarea.canvan)}
          onGuardar={(cambios, aviso) => {
            setEditando(null);
            aplicar(editando.tarea, cambios, aviso);
          }}
        />
      )}
    </div>
  );
}

function EditorTarea({ editando, tareas, onCancel, onCanvan, onGuardar }) {
  const { tarea: t } = editando;
  const [start, setStart] = useState(editando.start);
  const [due, setDue] = useState(editando.due);
  const [fechasTocadas, setFechasTocadas] = useState(false);
  const porKey = useMemo(() => new Map(tareas.map((x) => [x.key, x])), [tareas]);
  const [deps, setDeps] = useState(() => t.deps.filter((k) => porKey.has(k)));
  const invalido = start && due && start > due;

  // Tareas que dependen de esta (directa o indirectamente): no pueden ser previas, porque se formaría un ciclo
  const { siguientes, prohibidas } = useMemo(() => {
    const hijos = new Map();
    for (const x of tareas) for (const k of x.deps) hijos.set(k, [...(hijos.get(k) || []), x.key]);
    const prohibidas = new Set([t.key]);
    const cola = [t.key];
    while (cola.length) for (const h of hijos.get(cola.shift()) || []) if (!prohibidas.has(h)) prohibidas.add(h), cola.push(h);
    return { siguientes: (hijos.get(t.key) || []).map((k) => porKey.get(k)).filter(Boolean), prohibidas };
  }, [tareas, t.key, porKey]);

  const candidatas = useMemo(() => {
    const m = new Map();
    for (const x of tareas) {
      if (prohibidas.has(x.key) || deps.includes(x.key)) continue;
      if (!m.has(x.proceso)) m.set(x.proceso, []);
      m.get(x.proceso).push(x);
    }
    return [...m].sort(([a], [b]) => (a === t.proceso ? -1 : b === t.proceso ? 1 : a.localeCompare(b, 'es')));
  }, [tareas, prohibidas, deps, t.proceso]);

  // La previa que termina más tarde: la tarea debería empezar al día siguiente
  const ultima = deps
    .map((k) => porKey.get(k))
    .map((p) => ({ p, r: rango(p) }))
    .filter((x) => x.r)
    .sort((a, b) => b.r.fin.localeCompare(a.r.fin))[0];
  // En una tarea sin fechas, las sugeridas no cuentan hasta que se tocan (si no, se guardaría solo la dependencia)
  const inicio = !t.start && !t.due && !fechasTocadas ? '' : start;
  const choca = ultima && inicio && inicio <= ultima.r.fin;

  function correrDespues() {
    const nuevo = sumar(ultima.r.fin, 1);
    setDue(due ? sumar(nuevo, Math.max(0, dias(start, due))) : due);
    setStart(nuevo);
    setFechasTocadas(true);
  }

  // Una tarea sin fechas a la que solo se le cargan dependencias sigue sin fechas
  function guardar(fechas) {
    const cambiaronDeps = [...deps].sort().join() !== [...t.deps.filter((k) => porKey.has(k))].sort().join();
    const sinFechasAntes = !t.start && !t.due;
    const cambios = sinFechasAntes && !fechasTocadas && cambiaronDeps && !fechas ? {} : fechas || { start, due };
    if (cambiaronDeps) cambios.deps = deps;
    onGuardar(cambios, cambiaronDeps && !cambios.start && !cambios.due && !fechas ? 'Dependencias guardadas' : cambiaronDeps ? 'Cambios guardados en el Canvan' : undefined);
  }

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        className="modal gantt-editor"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalido) guardar();
        }}
      >
        <div>
          <span className="etiqueta canvan-tag">
            {t.proceso} · {t.columna}
          </span>
          <h2>{t.titulo}</h2>
          {t.desc && <p className="gantt-desc">{t.desc}</p>}
          <p className="gantt-desc">Prioridad {PRIORIDAD[t.prioridad]?.toLowerCase() || 'media'}</p>
        </div>
        <div className="gantt-fechas">
          <label className="campo">
            <span>Fecha de inicio</span>
            <input type="date" value={start} onChange={(e) => (setStart(e.target.value), setFechasTocadas(true))} autoFocus />
          </label>
          <label className="campo">
            <span>Fecha límite</span>
            <input type="date" value={due} onChange={(e) => (setDue(e.target.value), setFechasTocadas(true))} />
          </label>
        </div>
        {invalido && <p className="error-form">La fecha de inicio es posterior a la fecha límite.</p>}
        {start && due && !invalido && <p className="gantt-desc">{dias(start, due) + 1} días</p>}

        <div className="gantt-deps-editor">
          <span className="gantt-deps-titulo">Depende de</span>
          {deps.length === 0 && <p className="gantt-desc">No depende de ninguna tarea.</p>}
          {deps.length > 0 && (
            <ul className="gantt-deps-lista">
              {deps.map((k) => {
                const p = porKey.get(k);
                const r = rango(p);
                const mal = r && inicio && inicio <= r.fin;
                return (
                  <li key={k} className={mal ? 'mal' : ''}>
                    <i className="gantt-punto" style={{ background: p.color }} />
                    <span className="gantt-deps-nombre" title={p.titulo}>
                      {p.titulo}
                      <small>
                        {p.proceso !== t.proceso ? `${p.proceso} · ` : ''}
                        {r ? `termina el ${fmtCorta(r.fin)}` : 'sin fechas'}
                      </small>
                    </span>
                    <button type="button" className="btn icono" title="Quitar dependencia" aria-label={`Quitar dependencia de ${p.titulo}`} onClick={() => setDeps((d) => d.filter((x) => x !== k))}>
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <select
            className="gantt-deps-agregar"
            value=""
            onChange={(e) => e.target.value && setDeps((d) => [...d, e.target.value])}
            aria-label="Agregar una tarea de la que depende"
          >
            <option value="">+ Agregar una tarea de la que depende…</option>
            {candidatas.map(([proceso, lista]) => (
              <optgroup key={proceso} label={proceso}>
                {lista.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.titulo.length > 70 ? `${x.titulo.slice(0, 70)}…` : x.titulo}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {choca && (
            <p className="gantt-deps-aviso">
              Empieza antes de que termine «{ultima.p.titulo}» ({fmtCorta(ultima.r.fin)}).{' '}
              <button type="button" className="enlace" onClick={correrDespues}>
                Empezar el {fmtCorta(sumar(ultima.r.fin, 1))}
              </button>
            </p>
          )}
          {siguientes.length > 0 && (
            <p className="gantt-desc">
              Dependen de esta: {siguientes.map((s) => `«${s.titulo}»`).join(', ')}
            </p>
          )}
        </div>
        <div className="pie">
          <button type="button" className="btn" onClick={onCanvan}>
            <Icon name="kanban" /> Ver en Canvan
          </button>
          <span style={{ flex: 1 }} />
          {(t.start || t.due) && (
            <button type="button" className="btn peligro" onClick={() => guardar({ start: '', due: '' })}>
              Quitar fechas
            </button>
          )}
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="btn primario" disabled={invalido}>
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
