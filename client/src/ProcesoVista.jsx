import { useEffect, useState } from 'react';
import { api } from './api.js';
import { ProcesoDiagrama } from './ProcesoDiagrama.jsx';
import { ModeloVista } from './ModeloVista.jsx';
import { Lienzo } from './Lienzo.jsx';
import { Icon } from './Icon.jsx';

const TIPOS = { actividad: 'Actividad', decision: 'Decisión', inicio: 'Inicio', fin: 'Fin' };

// Carga una vista de data/procesos y la muestra según su tipo (flujo de proceso o modelo de datos)
export function ProcesoVista({ id }) {
  const [vista, setVista] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vigente = true;
    setVista(null);
    setError(null);
    api
      .proceso(id)
      .then((p) => vigente && setVista(p))
      .catch((e) => vigente && setError(e.message));
    return () => {
      vigente = false;
    };
  }, [id]);

  if (error) return <div className="estado">{error}</div>;
  if (!vista) return <div className="estado">Cargando…</div>;
  return vista.tipo === 'modelo' ? <ModeloVista key={vista.id} modelo={vista} /> : <FlujoVista key={vista.id} proceso={vista} />;
}

function FlujoVista({ proceso }) {
  const [seleccion, setSeleccion] = useState(null);
  const nodo = proceso.nodos.find((n) => n.id === seleccion);
  const carril = nodo && proceso.carriles.find((c) => c.id === nodo.carril);

  return (
    <div className="proceso">
      <Lienzo nombreArchivo={proceso.id}>
        {(ref) => <ProcesoDiagrama ref={ref} proceso={proceso} seleccion={seleccion} onSelect={setSeleccion} />}
      </Lienzo>

      <aside className="detalle">
        {nodo ? (
          <>
            <button className="btn icono cerrar" title="Cerrar" onClick={() => setSeleccion(null)}>×</button>
            <span className="etiqueta">{TIPOS[nodo.tipo]} · {carril.nombre}</span>
            <h2>{nodo.titulo}</h2>
            {nodo.detalle && <p>{nodo.detalle}</p>}
            {(nodo.responsables || carril.responsables) && (
              <>
                <h3>Responsables</h3>
                <ul className="chips">
                  {(nodo.responsables || carril.responsables).map((r) => <li key={r}>{r}</li>)}
                </ul>
              </>
            )}
            {nodo.tareas && (
              <>
                <h3>Tareas</h3>
                <ul>{nodo.tareas.map((t) => <li key={t}>{t}</li>)}</ul>
              </>
            )}
            {nodo.artefactos && (
              <>
                <h3>Archivos</h3>
                <ul className="docs">
                  {nodo.artefactos.map((a) => (
                    <li key={a.nombre}>
                      <Icon name="file" />
                      <div>
                        <strong>{a.nombre}</strong>
                        {a.detalle && <span>{a.detalle}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {nodo.alerta && <div className="nota alerta"><strong>Problema</strong>{nodo.alerta}</div>}
            {nodo.pendiente && <div className="nota pendiente"><strong>Pendiente</strong>{nodo.pendiente}</div>}
          </>
        ) : (
          <>
            <span className="etiqueta">{proceso.area}</span>
            <h2>{proceso.nombre}</h2>
            <p>{proceso.descripcion}</p>
            <p className="ayuda">Hacé clic en un paso del diagrama para ver su detalle.</p>

            <h3>Participantes</h3>
            <ul className="participantes">
              {proceso.carriles.map((c) => (
                <li key={c.id}>
                  <strong>{c.nombre}</strong>
                  <span>{c.responsables ? c.responsables.join(', ') : c.detalle}</span>
                </li>
              ))}
            </ul>

            {proceso.observaciones?.length > 0 && (
              <>
                <h3>Problemas y pendientes</h3>
                {proceso.observaciones.map((o) => (
                  <div key={o.texto} className={`nota ${o.tipo}`}>
                    <strong>{{ alerta: 'Problema', info: 'Nota' }[o.tipo] ?? 'Pendiente'}</strong>
                    {o.texto}
                  </div>
                ))}
              </>
            )}

            <h3>Referencias</h3>
            <ul className="leyenda">
              <li><svg width="26" height="18"><circle cx="13" cy="9" r="7" className="ley-punto" /></svg>Inicio</li>
              <li><svg width="26" height="18"><rect x="1" y="2" width="24" height="14" rx="5" className="ley-forma" /></svg>Actividad</li>
              <li><svg width="26" height="18"><polygon points="13,1 25,9 13,17 1,9" className="ley-forma" /></svg>Decisión</li>
              <li><svg width="26" height="18"><circle cx="13" cy="9" r="8" className="ley-anillo" /><circle cx="13" cy="9" r="4.5" className="ley-punto" /></svg>Fin</li>
              <li><svg width="26" height="18"><circle cx="13" cy="9" r="8" className="ley-alerta" /></svg>Tiene un problema detectado</li>
              <li><svg width="26" height="18"><rect x="1" y="2" width="24" height="14" rx="5" className="ley-forma ley-pend" /></svg>Tiene tareas por definir</li>
              <li><svg width="26" height="18"><rect x="3" y="4" width="20" height="11" rx="5.5" className="ley-doc" /></svg>Archivos generados o usados</li>
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
