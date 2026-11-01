import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { TableroForm } from './TableroForm.jsx';
import { ProcesoVista } from './ProcesoVista.jsx';
import { Icon } from './Icon.jsx';

const fmtFecha = (iso) =>
  new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });

// Rutas: #/  ·  #/t/<tablero>  ·  #/procesos/<proceso>  ·  #/canvan/<proceso>
const PREFIJOS = { tablero: 't', proceso: 'procesos', canvan: 'canvan' };

function leerRuta() {
  const [, prefijo, id] = location.hash.match(/^#\/(t|procesos|canvan)\/(.+)$/) || [];
  const vista = Object.keys(PREFIJOS).find((v) => PREFIJOS[v] === prefijo);
  return vista ? { vista, id: decodeURIComponent(id) } : { vista: 'inicio', id: null };
}

function useRuta() {
  const [ruta, setRuta] = useState(leerRuta);
  useEffect(() => {
    const onHash = () => setRuta(leerRuta());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const ir = useCallback((vista, id) => {
    location.hash = !id ? '#/' : `#/${PREFIJOS[vista]}/${encodeURIComponent(id)}`;
  }, []);
  return [ruta, ir];
}

// Tema claro/oscuro: se guarda en este navegador y se comparte con el Canvan (mismo localStorage)
const TEMA_KEY = 'portal.tema';
const temaInicial = () =>
  document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function useTema() {
  const [tema, setTema] = useState(temaInicial);
  useEffect(() => {
    document.documentElement.dataset.theme = tema;
  }, [tema]);
  useEffect(() => {
    const onStorage = (e) => e.key === TEMA_KEY && (e.newValue === 'dark' || e.newValue === 'light') && setTema(e.newValue);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const alternar = useCallback(() => {
    setTema((t) => {
      const nuevo = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(TEMA_KEY, nuevo);
      } catch {}
      return nuevo;
    });
  }, []);
  return [tema, alternar];
}

export default function App() {
  const [tableros, setTableros] = useState([]);
  const [procesos, setProcesos] = useState([]);
  const [canvans, setCanvans] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [modal, setModal] = useState(null); // { tipo: 'nuevo' } | { tipo: 'editar', tablero }
  const [aviso, setAviso] = useState(null);
  const [version, setVersion] = useState(0); // fuerza recarga del iframe
  const [ruta, ir] = useRuta();
  const [tema, alternarTema] = useTema();
  const frameRef = useRef(null);
  const reemplazoRef = useRef(null);

  const cargar = useCallback(async () => {
    try {
      const [t, p, k] = await Promise.all([api.listar(), api.listarProcesos(), api.listarCanvan()]);
      setTableros(t);
      setProcesos(p);
      setCanvans(k);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3500);
    return () => clearTimeout(t);
  }, [aviso]);

  useEffect(() => setMenuAbierto(false), [ruta]);

  // Avisa el tema al tablero abierto. El iframe está aislado (sin acceso al localStorage del portal),
  // así que se le envía por postMessage; el destino '*' es necesario porque su origen es opaco.
  const enviarTema = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({ tipo: 'portal-tema', tema }, '*');
  }, [tema]);
  useEffect(enviarTema, [enviarTema]);

  // Al volver de un canvan se actualizan los contadores de pendientes
  useEffect(() => {
    if (ruta.vista !== 'canvan') api.listarCanvan().then(setCanvans).catch(() => {});
  }, [ruta.vista]);

  const actual = ruta.vista === 'tablero' ? tableros.find((t) => t.id === ruta.id) || null : null;
  const procesoActual = ruta.vista === 'proceso' ? procesos.find((p) => p.id === ruta.id) || null : null;
  const canvanActual = ruta.vista === 'canvan' ? canvans.find((k) => k.id === ruta.id) || null : null;

  const coincide = useCallback(
    (...campos) => {
      const q = busqueda.trim().toLowerCase();
      return campos.some((v) => v?.toLowerCase().includes(q));
    },
    [busqueda],
  );

  const grupos = useMemo(() => {
    const map = new Map();
    const filtrados = tableros.filter((t) => coincide(t.nombre, t.descripcion, t.categoria));
    for (const t of filtrados.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))) {
      if (!map.has(t.categoria)) map.set(t.categoria, []);
      map.get(t.categoria).push(t);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));
  }, [tableros, coincide]);

  const procesosFiltrados = useMemo(
    () => procesos.filter((p) => coincide(p.nombre, p.descripcion, p.area)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [procesos, coincide],
  );

  const canvansFiltrados = useMemo(
    () => canvans.filter((k) => coincide(k.nombre, k.area)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [canvans, coincide],
  );

  const categorias = useMemo(() => [...new Set(tableros.map((t) => t.categoria))].sort(), [tableros]);

  async function guardar(datos) {
    if (modal.tipo === 'nuevo') {
      const t = await api.subir(datos);
      setAviso(`“${t.nombre}” agregado`);
      await cargar();
      ir('tablero', t.id);
    } else {
      await api.editar(modal.tablero.id, datos);
      setAviso('Cambios guardados');
      await cargar();
    }
    setModal(null);
  }

  async function reemplazar(e) {
    const archivo = e.target.files[0];
    e.target.value = '';
    if (!archivo || !actual) return;
    try {
      await api.reemplazar(actual.id, archivo);
      await cargar();
      setVersion((v) => v + 1);
      setAviso('Archivo actualizado');
    } catch (err) {
      setAviso(err.message);
    }
  }

  async function eliminar() {
    if (!actual || !confirm(`¿Eliminar el tablero “${actual.nombre}”? Esta acción no se puede deshacer.`)) return;
    try {
      await api.eliminar(actual.id);
      ir(null);
      await cargar();
      setAviso('Tablero eliminado');
    } catch (err) {
      setAviso(err.message);
    }
  }

  let encabezado;
  if (actual) {
    encabezado = (
      <>
        <div className="titulo">
          <h1>{actual.nombre}</h1>
          <p>{actual.categoria} · Actualizado {fmtFecha(actual.actualizado)}</p>
        </div>
        <div className="acciones">
          <button className="btn icono" title="Recargar" onClick={() => setVersion((v) => v + 1)}>
            <Icon name="refresh" />
          </button>
          <button className="btn icono" title="Pantalla completa" onClick={() => frameRef.current?.requestFullscreen?.()}>
            <Icon name="expand" />
          </button>
          <a className="btn icono" title="Abrir en pestaña nueva" href={`/ver/${actual.id}`} target="_blank" rel="noreferrer">
            <Icon name="external" />
          </a>
          <button className="btn icono" title="Reemplazar archivo HTML" onClick={() => reemplazoRef.current.click()}>
            <Icon name="upload" />
          </button>
          <button className="btn icono" title="Editar datos" onClick={() => setModal({ tipo: 'editar', tablero: actual })}>
            <Icon name="edit" />
          </button>
          <button className="btn icono peligro" title="Eliminar" onClick={eliminar}>
            <Icon name="trash" />
          </button>
          <input ref={reemplazoRef} type="file" accept=".html,.htm" hidden onChange={reemplazar} />
        </div>
      </>
    );
  } else if (ruta.vista === 'proceso') {
    encabezado = (
      <>
        <div className="titulo">
          <h1>{procesoActual?.nombre || 'Vista de Procesos'}</h1>
          {procesoActual && (
            <p>Vista de Procesos · {procesoActual.area} · Actualizado {fmtFecha(procesoActual.actualizado)}</p>
          )}
        </div>
        {procesoActual && (
          <div className="acciones">
            <button className="btn" title="Gestionar los pendientes de este proceso" onClick={() => ir('canvan', procesoActual.id)}>
              <Icon name="kanban" /> Canvan
            </button>
          </div>
        )}
      </>
    );
  } else if (ruta.vista === 'canvan') {
    encabezado = (
      <>
        <div className="titulo">
          <h1>{canvanActual?.nombre || 'Canvan'}</h1>
          {canvanActual && <p>Canvan · {canvanActual.area}</p>}
        </div>
        {canvanActual && (
          <div className="acciones">
            <button className="btn" title="Ver el diagrama del proceso" onClick={() => ir('proceso', canvanActual.id)}>
              <Icon name="flow" /> Ver proceso
            </button>
            <a className="btn icono" title="Abrir en pestaña nueva" href={`/canvan?id=${encodeURIComponent(canvanActual.id)}`} target="_blank" rel="noreferrer">
              <Icon name="external" />
            </a>
          </div>
        )}
      </>
    );
  } else {
    encabezado = (
      <div className="titulo">
        <h1>Inicio</h1>
        <p>{tableros.length} tableros · {procesos.length} procesos · {canvans.length} canvan</p>
      </div>
    );
  }

  let cuerpo;
  if (actual) {
    cuerpo = (
      <iframe
        ref={frameRef}
        key={`${actual.id}-${version}`}
        className="visor"
        title={actual.nombre}
        src={`/ver/${actual.id}?v=${version}`}
        onLoad={enviarTema}
        sandbox="allow-scripts allow-popups allow-downloads allow-modals allow-forms"
      />
    );
  } else if (ruta.vista === 'proceso' && (procesoActual || cargando)) {
    cuerpo = <ProcesoVista id={ruta.id} />;
  } else if (canvanActual) {
    // Sin sandbox: la app necesita el mismo origen para leer y guardar en /api/canvan
    cuerpo = <iframe key={canvanActual.id} className="visor" title={`Canvan · ${canvanActual.nombre}`} src={`/canvan?id=${encodeURIComponent(canvanActual.id)}`} />;
  } else if (ruta.vista !== 'inicio' && !cargando) {
    cuerpo = (
      <div className="estado">
        <p>La página solicitada no existe.</p>
        <button className="btn" onClick={() => ir(null)}>Volver al inicio</button>
      </div>
    );
  } else {
    cuerpo = (
      <div className="inicio">
        <h2 className="seccion">Tableros</h2>
        <div className="tarjetas">
          {tableros.map((t) => (
            <button key={t.id} className="tarjeta" onClick={() => ir('tablero', t.id)}>
              <span className="etiqueta">{t.categoria}</span>
              <h2>{t.nombre}</h2>
              <p>{t.descripcion || 'Sin descripción'}</p>
              <small>Actualizado {fmtFecha(t.actualizado)}</small>
            </button>
          ))}
          <button className="tarjeta nueva" onClick={() => setModal({ tipo: 'nuevo' })}>
            <Icon name="plus" />
            <span>Agregar tablero</span>
          </button>
        </div>

        <h2 className="seccion">Vista de Procesos</h2>
        <div className="tarjetas">
          {procesos.map((p) => (
            <button key={p.id} className="tarjeta" onClick={() => ir('proceso', p.id)}>
              <span className="etiqueta proceso-tag">
                {p.tipo === 'modelo' ? 'Modelo de datos' : 'Proceso'} · {p.area}
              </span>
              <h2>{p.nombre}</h2>
              <p>{p.descripcion}</p>
              <small>Actualizado {fmtFecha(p.actualizado)}</small>
            </button>
          ))}
          {procesos.length === 0 && <p className="vacio">Todavía no hay procesos cargados.</p>}
        </div>

        <h2 className="seccion">Canvan</h2>
        <div className="tarjetas">
          {canvans.map((k) => (
            <button key={k.id} className="tarjeta" onClick={() => ir('canvan', k.id)}>
              <span className="etiqueta canvan-tag">Canvan · {k.area}</span>
              <h2>{k.nombre}</h2>
              <p>
                {k.porHacer} por hacer · {k.total - k.porHacer - k.hechas} en curso · {k.hechas} completadas
              </p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`layout ${menuAbierto ? 'menu-abierto' : ''}`}>
      <aside className="sidebar">
        <button className="marca" onClick={() => ir(null)}>
          <Icon name="grid" />
          <span>Portal de Tableros</span>
        </button>

        <label className="buscador">
          <Icon name="search" />
          <input type="search" placeholder="Buscar…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </label>

        <nav className="lista">
          {grupos.map(([cat, items]) => (
            <section key={cat}>
              <h3>{cat}</h3>
              {items.map((t) => (
                <button
                  key={t.id}
                  className={`item ${ruta.vista === 'tablero' && t.id === ruta.id ? 'activo' : ''}`}
                  onClick={() => ir('tablero', t.id)}
                  title={t.descripcion || t.nombre}
                >
                  <Icon name="chart" />
                  <span>{t.nombre}</span>
                </button>
              ))}
            </section>
          ))}

          {procesosFiltrados.length > 0 && (
            <section>
              <h3>Vista de Procesos</h3>
              {procesosFiltrados.map((p) => (
                <button
                  key={p.id}
                  className={`item ${ruta.vista === 'proceso' && p.id === ruta.id ? 'activo' : ''}`}
                  onClick={() => ir('proceso', p.id)}
                  title={p.descripcion || p.nombre}
                >
                  <Icon name={p.tipo === 'modelo' ? 'table' : 'flow'} />
                  <span>{p.nombre}</span>
                </button>
              ))}
            </section>
          )}

          {canvansFiltrados.length > 0 && (
            <section>
              <h3>Canvan</h3>
              {canvansFiltrados.map((k) => (
                <button
                  key={k.id}
                  className={`item ${ruta.vista === 'canvan' && k.id === ruta.id ? 'activo' : ''}`}
                  onClick={() => ir('canvan', k.id)}
                  title={`${k.porHacer} por hacer`}
                >
                  <Icon name="kanban" />
                  <span>{k.nombre}</span>
                  {k.porHacer > 0 && <span className="contador">{k.porHacer}</span>}
                </button>
              ))}
            </section>
          )}

          {!cargando && grupos.length === 0 && procesosFiltrados.length === 0 && canvansFiltrados.length === 0 && (
            <p className="vacio">Sin resultados</p>
          )}
        </nav>

        <button className="btn primario ancho" onClick={() => setModal({ tipo: 'nuevo' })}>
          <Icon name="plus" /> Agregar tablero
        </button>
      </aside>

      <div className="velo" onClick={() => setMenuAbierto(false)} />

      <main className="contenido">
        <header className="barra">
          <button className="btn icono solo-movil" onClick={() => setMenuAbierto(true)} aria-label="Menú">
            <Icon name="menu" />
          </button>
          {encabezado}
          <button
            className="btn icono"
            title={tema === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            aria-label={tema === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            onClick={alternarTema}
          >
            <Icon name={tema === 'dark' ? 'sun' : 'moon'} />
          </button>
        </header>

        {error && <div className="error">No se pudo conectar con el servidor: {error}</div>}

        {cuerpo}
      </main>

      {modal && (
        <TableroForm
          modo={modal.tipo}
          inicial={modal.tablero}
          categorias={categorias}
          onCancel={() => setModal(null)}
          onSubmit={guardar}
        />
      )}

      {aviso && <div className="aviso" role="status">{aviso}</div>}
    </div>
  );
}
