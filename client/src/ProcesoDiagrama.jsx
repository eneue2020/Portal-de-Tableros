import { forwardRef, useMemo, useState } from 'react';

// Diagrama de actividad UML con carriles verticales (swimlanes).
// Cada nodo se ubica por carril (columna) y fila; los flujos se trazan en ángulo recto.

const LANE_W = 280;
const ROW_H = 104;
const HEAD_H = 84;
const TOP = HEAD_H + 16;
const ACT = { w: 204, h: 64 };
const DEC = { w: 188, h: 80 };

const px = (carril) => carril * LANE_W + LANE_W / 2;
const py = (fila) => TOP + fila * ROW_H + ROW_H / 2;

function medidas(nodo) {
  if (nodo.tipo === 'actividad') return ACT;
  if (nodo.tipo === 'decision') return DEC;
  return { w: 36, h: 36 };
}

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

// Punto del borde del nodo en la dirección del punto vecino
function borde(nodo, hacia) {
  const { w, h } = medidas(nodo);
  const dx = hacia[0] - nodo.x;
  const dy = hacia[1] - nodo.y;
  if (Math.abs(dy) >= Math.abs(dx)) return [nodo.x, nodo.y + Math.sign(dy || 1) * (h / 2)];
  return [nodo.x + Math.sign(dx) * (w / 2), nodo.y];
}

function trazar(flujo, a, b) {
  let medio;
  if (flujo.ruta) {
    medio = flujo.ruta.map(([c, f]) => [px(c), py(f)]);
  } else if (a.x === b.x || a.y === b.y) {
    medio = [];
  } else {
    const y = a.y + ROW_H / 2;
    medio = [[a.x, y], [b.x, y]];
  }
  const inicio = borde(a, medio[0] || [b.x, b.y]);
  const fin = borde(b, medio.at(-1) || [a.x, a.y]);
  return [inicio, ...medio, fin];
}

export const ProcesoDiagrama = forwardRef(function ProcesoDiagrama({ proceso, seleccion, onSelect }, ref) {
  const [hover, setHover] = useState(null);

  const { nodos, flujos, ancho, alto } = useMemo(() => {
    const idx = Object.fromEntries(proceso.carriles.map((c, i) => [c.id, i]));
    const nodos = proceso.nodos.map((n) => ({ ...n, x: px(idx[n.carril]), y: py(n.fila) }));
    const porId = Object.fromEntries(nodos.map((n) => [n.id, n]));
    const flujos = proceso.flujos.map((f) => ({
      ...f,
      puntos: trazar(f, porId[f.desde], porId[f.hasta]),
    }));
    const filas = Math.max(...nodos.map((n) => n.fila)) + 1;
    return { nodos, flujos, ancho: proceso.carriles.length * LANE_W, alto: TOP + filas * ROW_H + 16 };
  }, [proceso]);

  const foco = hover || seleccion;
  const relacionado = (f) => foco && (f.desde === foco || f.hasta === foco);

  return (
    <svg
      ref={ref}
      className="diagrama"
      viewBox={`0 0 ${ancho} ${alto}`}
      width={ancho}
      height={alto}
      role="img"
      aria-label={`Diagrama del proceso ${proceso.nombre}`}
      onClick={() => onSelect(null)}
    >
      <defs>
        <marker id="flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="flecha" />
        </marker>
        <marker id="flecha-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" className="flecha on" />
        </marker>
      </defs>

      {proceso.carriles.map((c, i) => (
        <g key={c.id}>
          <rect className={`carril ${i % 2 ? 'par' : ''}`} x={i * LANE_W} y={0} width={LANE_W} height={alto} />
          <rect className="carril-cab" x={i * LANE_W} y={0} width={LANE_W} height={HEAD_H} />
          <text className="carril-nombre" x={px(i)} y={32} textAnchor="middle">{c.nombre}</text>
          {partir(c.responsables ? c.responsables.join(' · ') : c.detalle || '', 40).map((l, j) => (
            <text key={j} className="carril-sub" x={px(i)} y={54 + j * 15} textAnchor="middle">{l}</text>
          ))}
          {i > 0 && <line className="carril-linea" x1={i * LANE_W} x2={i * LANE_W} y1={0} y2={alto} />}
        </g>
      ))}

      {flujos.map((f, i) => {
        const on = relacionado(f);
        const [p0, p1] = f.puntos;
        const horizontal = p0[1] === p1[1];
        const lx = horizontal ? p0[0] + Math.sign(p1[0] - p0[0]) * 22 : p0[0] + 14;
        const ly = horizontal ? p0[1] - 8 : p0[1] + 18;
        return (
          <g key={i} className={`flujo ${on ? 'on' : ''}`}>
            <polyline
              points={f.puntos.map((p) => p.join(',')).join(' ')}
              markerEnd={`url(#${on ? 'flecha-on' : 'flecha'})`}
            />
            {f.etiqueta && (
              <text className="flujo-etiqueta" x={lx} y={ly} textAnchor={horizontal && p1[0] < p0[0] ? 'end' : 'start'}>
                {f.etiqueta}
              </text>
            )}
          </g>
        );
      })}

      {nodos.map((n) => (
        <Nodo
          key={n.id}
          nodo={n}
          activo={n.id === seleccion}
          onEnter={() => setHover(n.id)}
          onLeave={() => setHover(null)}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(n.id === seleccion ? null : n.id);
          }}
        />
      ))}
    </svg>
  );
});

function Nodo({ nodo: n, activo, onEnter, onLeave, onClick }) {
  const props = {
    className: `nodo ${n.tipo} ${activo ? 'activo' : ''} ${n.pendiente ? 'pendiente' : ''}`,
    onMouseEnter: onEnter,
    onMouseLeave: onLeave,
    onClick,
    tabIndex: 0,
    role: 'button',
    'aria-label': n.titulo,
    onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && onClick(e),
  };

  if (n.tipo === 'inicio') {
    return (
      <g {...props}>
        <circle cx={n.x} cy={n.y} r={14} className="punto" />
        <text className="nodo-nota" x={n.x + 24} y={n.y + 4}>Inicio</text>
      </g>
    );
  }
  if (n.tipo === 'fin') {
    return (
      <g {...props}>
        <circle cx={n.x} cy={n.y} r={17} className="anillo" />
        <circle cx={n.x} cy={n.y} r={10} className="punto" />
        <text className="nodo-nota" x={n.x} y={n.y + 36} textAnchor="middle">Fin</text>
      </g>
    );
  }

  const { w, h } = medidas(n);
  const lineas = partir(n.titulo, n.tipo === 'decision' ? 15 : 26);
  const y0 = n.y - ((lineas.length - 1) * 16) / 2 + 4.5;

  return (
    <g {...props}>
      {n.tipo === 'decision' ? (
        <polygon
          className="forma"
          points={`${n.x},${n.y - h / 2} ${n.x + w / 2},${n.y} ${n.x},${n.y + h / 2} ${n.x - w / 2},${n.y}`}
        />
      ) : (
        <rect className="forma" x={n.x - w / 2} y={n.y - h / 2} width={w} height={h} rx={14} />
      )}
      {lineas.map((l, i) => (
        <text key={i} className="nodo-texto" x={n.x} y={y0 + i * 16} textAnchor="middle">{l}</text>
      ))}
      {n.alerta && (
        <g className="marca-alerta" transform={`translate(${n.x + w / 2 - 6}, ${n.y - h / 2 - 6})`}>
          <circle r={10} />
          <text y={4.5} textAnchor="middle">!</text>
        </g>
      )}
      {n.artefactos && (
        <g className="marca-doc" transform={`translate(${n.x - w / 2 + 4}, ${n.y + h / 2 - 8})`}>
          <rect width={28} height={18} rx={9} />
          <text x={14} y={13} textAnchor="middle">{n.artefactos.length}</text>
        </g>
      )}
    </g>
  );
}
