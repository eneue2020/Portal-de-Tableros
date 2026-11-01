import { forwardRef, useMemo, useState } from 'react';
import { Lienzo } from './Lienzo.jsx';
import { Icon } from './Icon.jsx';

// Diagrama entidad-relación: tablas con sus campos y relaciones FK → PK.
// Las posiciones vienen del .drawio original (scripts/importar-drawio.js).

const PAD = 40;
const HEAD = 32;
const ROW = 28;
const KEY_W = 46;

function partir(texto, max) {
  const lineas = [];
  let actual = '';
  for (const palabra of texto.split(/\s+/)) {
    if (actual && (actual + ' ' + palabra).length > max) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = actual ? `${actual} ${palabra}` : palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

function geometria(modelo) {
  const tablas = modelo.tablas.map((t) => {
    const largoNombre = Math.max(...t.campos.map((c) => c.nombre.length + (c.requerido ? 2 : 0)), 0);
    const largoTipo = Math.max(...t.campos.map((c) => c.tipo.length), 0);
    const w = Math.max(t.ancho, t.nombre.length * 8.5 + 32, KEY_W + largoNombre * 7.2 + largoTipo * 6.6 + 26);
    return { ...t, x: t.x + PAD, y: t.y + PAD, w, h: HEAD + t.campos.length * ROW };
  });
  const porId = Object.fromEntries(tablas.map((t) => [t.id, t]));
  const filaY = (t, campoId) => {
    const i = t.campos.findIndex((c) => c.id === campoId);
    return i < 0 ? t.y + HEAD / 2 : t.y + HEAD + i * ROW + ROW / 2;
  };

  const lados = { izquierda: 0, derecha: 0 };
  const relaciones = modelo.relaciones.map((r, i) => {
    const a = porId[r.desde.tabla];
    const b = porId[r.hasta.tabla];
    const ay = filaY(a, r.desde.campo);
    const by = filaY(b, r.hasta.campo);
    let puntos;
    if (b.x - (a.x + a.w) >= 30) {
      const mx = a.x + a.w + (b.x - a.x - a.w) / 2;
      puntos = [[a.x + a.w, ay], [mx, ay], [mx, by], [b.x, by]];
    } else if (a.x - (b.x + b.w) >= 30) {
      const mx = b.x + b.w + (a.x - b.x - b.w) / 2;
      puntos = [[a.x, ay], [mx, ay], [mx, by], [b.x + b.w, by]];
    } else {
      // Tablas superpuestas en horizontal: se conectan por el mismo lado
      const der = Math.max(a.x + a.w, b.x + b.w);
      const izq = Math.min(a.x, b.x);
      const costoDer = 2 * der - (a.x + a.w) - (b.x + b.w);
      const costoIzq = a.x + b.x - 2 * izq;
      if (costoDer <= costoIzq) {
        const x = der + 20 + 10 * lados.derecha++;
        puntos = [[a.x + a.w, ay], [x, ay], [x, by], [b.x + b.w, by]];
      } else {
        const x = izq - 20 - 10 * lados.izquierda++;
        puntos = [[a.x, ay], [x, ay], [x, by], [b.x, by]];
      }
    }
    return { ...r, i, puntos };
  });

  const elementos = modelo.elementos.map((e) => {
    const lineas = partir(e.texto, Math.max(10, Math.floor((e.ancho - 16) / 6.8)));
    return { ...e, x: e.x + PAD, y: e.y + PAD, lineas, alto: Math.max(e.alto, lineas.length * 15 + 16) };
  });
  const elPorId = Object.fromEntries(elementos.map((e) => [e.id, e]));
  // Una conexión puede unir elementos o una tabla con un elemento
  const caja = (id) => elPorId[id] ?? (porId[id] && { x: porId[id].x, y: porId[id].y, ancho: porId[id].w, alto: porId[id].h });
  const conexiones = modelo.conexiones.map((c) => {
    const a = caja(c.desde);
    const b = caja(c.hasta);
    const [ax, ay, bx, by] = [a.x + a.ancho / 2, a.y + a.alto / 2, b.x + b.ancho / 2, b.y + b.alto / 2];
    if (Math.abs(bx - ax) > Math.abs(by - ay)) {
      const [x1, x2] = bx > ax ? [a.x + a.ancho, b.x] : [a.x, b.x + b.ancho];
      return [[x1, ay], [(x1 + x2) / 2, ay], [(x1 + x2) / 2, by], [x2, by]];
    }
    const [y1, y2] = by > ay ? [a.y + a.alto, b.y] : [a.y, b.y + b.alto];
    return [[ax, y1], [ax, (y1 + y2) / 2], [bx, (y1 + y2) / 2], [bx, y2]];
  });

  const todos = [...tablas.map((t) => [t.x + t.w, t.y + t.h]), ...elementos.map((e) => [e.x + e.ancho, e.y + e.alto])];
  const extraDer = 20 + 10 * lados.derecha;
  const ancho = Math.max(...todos.map((p) => p[0])) + PAD + extraDer;
  const alto = Math.max(...todos.map((p) => p[1])) + PAD;
  return { tablas, porId, relaciones, elementos, conexiones, ancho, alto };
}

const ModeloDiagrama = forwardRef(function ModeloDiagrama({ geo, seleccion, onSelect }, ref) {
  const [hover, setHover] = useState(null);
  const foco = hover || seleccion;

  const vecinos = useMemo(() => {
    if (!foco) return null;
    const s = new Set([foco]);
    for (const r of geo.relaciones) {
      if (r.desde.tabla === foco) s.add(r.hasta.tabla);
      if (r.hasta.tabla === foco) s.add(r.desde.tabla);
    }
    return s;
  }, [foco, geo]);

  const camposRelacionados = useMemo(() => {
    const s = new Set();
    if (foco) for (const r of geo.relaciones) {
      if (r.desde.tabla === foco || r.hasta.tabla === foco) s.add(r.desde.campo).add(r.hasta.campo);
    }
    return s;
  }, [foco, geo]);

  return (
    <svg
      ref={ref}
      className="diagrama er"
      viewBox={`0 0 ${geo.ancho} ${geo.alto}`}
      width={geo.ancho}
      height={geo.alto}
      role="img"
      aria-label="Modelo de datos"
      onClick={() => onSelect(null)}
    >
      <defs>
        {['', '-on'].map((s) => (
          <g key={s}>
            <marker id={`er-muchos${s}`} viewBox="0 0 14 14" refX="14" refY="7" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M0 7H14M4 7L14 1M4 7L14 13M3 2V12" className={`er-marca ${s ? 'on' : ''}`} />
            </marker>
            <marker id={`er-uno${s}`} viewBox="0 0 14 14" refX="14" refY="7" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto">
              <path d="M0 7H14M6 1V13M10 1V13" className={`er-marca ${s ? 'on' : ''}`} />
            </marker>
          </g>
        ))}
      </defs>

      {geo.conexiones.map((p, i) => (
        <polyline key={i} className="er-conexion" points={p.map((q) => q.join(',')).join(' ')} />
      ))}

      {geo.elementos.map((e) => {
        const { lineas } = e;
        const cy = e.y + e.alto / 2 - ((lineas.length - 1) * 15) / 2 + 4.5;
        return (
          <g key={e.id} className={`er-elemento ${e.tipo}`}>
            {e.tipo === 'rombo' ? (
              <polygon points={`${e.x + e.ancho / 2},${e.y} ${e.x + e.ancho},${e.y + e.alto / 2} ${e.x + e.ancho / 2},${e.y + e.alto} ${e.x},${e.y + e.alto / 2}`} />
            ) : e.tipo !== 'texto' ? (
              <rect x={e.x} y={e.y} width={e.ancho} height={e.alto} rx={e.tipo === 'nota' ? 2 : 10} />
            ) : null}
            {lineas.map((l, i) => (
              <text key={i} x={e.x + e.ancho / 2} y={cy + i * 15} textAnchor="middle">{l}</text>
            ))}
          </g>
        );
      })}

      {geo.relaciones.map((r) => {
        const on = foco && (r.desde.tabla === foco || r.hasta.tabla === foco);
        return (
          <polyline
            key={r.i}
            className={`er-relacion ${on ? 'on' : ''} ${foco && !on ? 'apagada' : ''}`}
            points={r.puntos.map((q) => q.join(',')).join(' ')}
            markerStart={`url(#er-muchos${on ? '-on' : ''})`}
            markerEnd={`url(#er-uno${on ? '-on' : ''})`}
          />
        );
      })}

      {geo.tablas.map((t) => (
        <g
          key={t.id}
          className={`er-tabla ${t.id === seleccion ? 'activo' : ''} ${vecinos && !vecinos.has(t.id) ? 'apagada' : ''}`}
          onMouseEnter={() => setHover(t.id)}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(t.id === seleccion ? null : t.id);
          }}
          tabIndex={0}
          role="button"
          aria-label={`Tabla ${t.nombre}`}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(t.id)}
        >
          <rect className="er-caja" x={t.x} y={t.y} width={t.w} height={t.h} rx={8} />
          <path className="er-cab" d={`M${t.x} ${t.y + HEAD}V${t.y + 8}a8 8 0 0 1 8-8H${t.x + t.w - 8}a8 8 0 0 1 8 8V${t.y + HEAD}z`} />
          <text className="er-nombre" x={t.x + t.w / 2} y={t.y + 21} textAnchor="middle">{t.nombre}</text>
          {t.campos.map((c, i) => {
            const y = t.y + HEAD + i * ROW;
            return (
              <g key={c.id} className={camposRelacionados.has(c.id) ? 'er-campo on' : 'er-campo'}>
                {camposRelacionados.has(c.id) && <rect className="er-campo-fondo" x={t.x + 1} y={y} width={t.w - 2} height={ROW} />}
                {i > 0 && <line className="er-sep" x1={t.x} x2={t.x + t.w} y1={y} y2={y} />}
                {c.clave && (
                  <text className={`er-clave ${c.clave === 'PK' ? 'pk' : 'fk'}`} x={t.x + 10} y={y + 18}>{c.clave}</text>
                )}
                <text className={`er-campo-nombre ${c.clave === 'PK' ? 'pk' : ''}`} x={t.x + KEY_W} y={y + 18}>
                  {c.nombre}
                  {c.requerido && <tspan className="er-req"> *</tspan>}
                </text>
                <text className="er-tipo" x={t.x + t.w - 10} y={y + 18} textAnchor="end">{c.tipo}</text>
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
});

export function ModeloVista({ modelo }) {
  const [seleccion, setSeleccion] = useState(null);
  const geo = useMemo(() => geometria(modelo), [modelo]);
  const tabla = seleccion && geo.porId[seleccion];

  const nombreCampo = (ref) => {
    const t = geo.porId[ref.tabla];
    return t.campos.find((c) => c.id === ref.campo)?.nombre ?? '—';
  };
  const salientes = tabla ? geo.relaciones.filter((r) => r.desde.tabla === tabla.id) : [];
  const entrantes = tabla ? geo.relaciones.filter((r) => r.hasta.tabla === tabla.id) : [];

  const IrA = ({ id }) => (
    <button className="enlace" onClick={() => setSeleccion(id)}>{geo.porId[id].nombre}</button>
  );

  return (
    <div className="proceso">
      <Lienzo nombreArchivo={modelo.id}>
        {(ref) => <ModeloDiagrama ref={ref} geo={geo} seleccion={seleccion} onSelect={setSeleccion} />}
      </Lienzo>

      <aside className="detalle">
        {tabla ? (
          <>
            <button className="btn icono cerrar" title="Cerrar" onClick={() => setSeleccion(null)}>×</button>
            <span className="etiqueta proceso-tag">Tabla</span>
            <h2>{tabla.nombre}</h2>
            <p className="ayuda">{tabla.campos.length} campos · {tabla.campos.filter((c) => c.requerido).length} obligatorios</p>

            <h3>Campos</h3>
            <table className="campos">
              <tbody>
                {tabla.campos.map((c) => (
                  <tr key={c.id}>
                    <td>{c.clave && <span className={`clave ${c.clave === 'PK' ? 'pk' : 'fk'}`}>{c.clave}</span>}</td>
                    <td>
                      {c.nombre}
                      {c.requerido && <span className="req" title="Obligatorio"> *</span>}
                      {c.nota && <small className="campo-nota">{c.nota}</small>}
                    </td>
                    <td className="tipo">{c.tipo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {salientes.length > 0 && (
              <>
                <h3>Hace referencia a</h3>
                <ul className="relaciones">
                  {salientes.map((r) => (
                    <li key={r.i}>
                      <code>{nombreCampo(r.desde)}</code> → <IrA id={r.hasta.tabla} />.<code>{nombreCampo(r.hasta)}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {entrantes.length > 0 && (
              <>
                <h3>Referenciada por</h3>
                <ul className="relaciones">
                  {entrantes.map((r) => (
                    <li key={r.i}>
                      <IrA id={r.desde.tabla} />.<code>{nombreCampo(r.desde)}</code> → <code>{nombreCampo(r.hasta)}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : (
          <>
            <span className="etiqueta proceso-tag">Modelo de datos · {modelo.area}</span>
            <h2>{modelo.nombre}</h2>
            <p>{modelo.descripcion}</p>
            <p className="ayuda">
              {modelo.tablas.length} tablas · {modelo.relaciones.length} relaciones. Hacé clic en una tabla para ver sus campos y relaciones.
            </p>
            {modelo.fuente && (
              <a className="btn ancho" href={modelo.fuente} target="_blank" rel="noreferrer">
                <Icon name="external" /> Ver original en Drive (draw.io)
              </a>
            )}

            <h3>Tablas</h3>
            <ul className="lista-tablas">
              {[...geo.tablas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((t) => (
                <li key={t.id}>
                  <button className="enlace" onClick={() => setSeleccion(t.id)}>{t.nombre}</button>
                  <span>{t.campos.length}</span>
                </li>
              ))}
            </ul>

            {modelo.correcciones && (
              <>
                <h3>Corregido según la guía de Bymovi</h3>
                <p className="ayuda">{modelo.correcciones.fuente}</p>
                <ul className="cambios">
                  {modelo.correcciones.cambios.map((c) => <li key={c}>{c}</li>)}
                </ul>
                {modelo.correcciones.reglas?.length > 0 && (
                  <>
                    <h3>Reglas de carga</h3>
                    {modelo.correcciones.reglas.map((r) => (
                      <div key={r} className="nota pendiente">{r}</div>
                    ))}
                  </>
                )}
              </>
            )}

            {geo.elementos.some((e) => e.texto.length > 30) && (
              <>
                <h3>Notas del diagrama</h3>
                {geo.elementos.filter((e) => e.texto.length > 30).map((e) => (
                  <div key={e.id} className="nota info">{e.texto}</div>
                ))}
              </>
            )}

            <h3>Referencias</h3>
            <ul className="leyenda">
              <li><span className="clave pk">PK</span>Clave primaria</li>
              <li><span className="clave fk">FK</span>Clave foránea (referencia a otra tabla)</li>
              <li><span className="req ley-req">*</span>Campo obligatorio</li>
              <li>
                <svg width="40" height="16"><path d="M2 8H38M6 2L2 8L6 14M2 8" className="ley-linea" /><path d="M14 8L4 2M14 8L4 14" className="ley-linea" /><path d="M32 2V14M35 2V14" className="ley-linea" /></svg>
                Muchos → uno
              </li>
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
