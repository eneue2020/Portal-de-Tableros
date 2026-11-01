import { useState } from 'react';
import { dias, fmtCorta, fmtLarga, rango } from './fechas.js';

const NIVELES = ['critica', 'riesgo', 'aviso'];
const NOMBRE_NIVEL = { critica: 'Crítica', riesgo: 'Riesgo', aviso: 'Aviso' };
const ESTADOS = {
  atrasado: { nombre: 'Atrasado', ayuda: 'Hay tareas vencidas o que no llegan a la fecha límite.' },
  riesgo: { nombre: 'En riesgo', ayuda: 'Todavía llega, pero hay señales de atraso.' },
  ok: { nombre: 'En término', ayuda: 'Sin atrasos ni riesgos detectados.' },
};
// Puntos de diferencia entre el tiempo transcurrido y el avance a partir de los cuales el ritmo es un riesgo
const BRECHA_RIESGO = 0.15;

const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const enDias = (n) => (n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`);
const haceDias = (n) => (n === 1 ? 'hace 1 día' : `hace ${n} días`);

// Frase de resumen de cada tipo de alerta, para explicar el estado
const RESUMEN = {
  vencida: (n) => pl(n, 'tarea vencida', 'tareas vencidas'),
  limite: (n) => `${n} ${n === 1 ? 'termina' : 'terminan'} después de la fecha límite`,
  'limite-pasado': () => 'pasó la fecha límite',
  'sin-empezar': (n) => pl(n, 'tarea sin empezar a tiempo', 'tareas sin empezar a tiempo'),
  'previa-vencida': (n) => pl(n, 'tarea esperando a una vencida', 'tareas esperando a una vencida'),
  conflicto: (n) => pl(n, 'dependencia en conflicto', 'dependencias en conflicto'),
  ritmo: () => 'el avance va detrás del tiempo',
  pronto: (n) => pl(n, 'tarea vence esta semana', 'tareas vencen esta semana'),
  'sin-fechas': (n) => pl(n, 'tarea sin fechas', 'tareas sin fechas'),
};

// Estado de salud de un conjunto de tareas (el proyecto o un proceso) a la fecha «hoy», contra la fecha límite.
// Avance: completada = 100 %, con checklist = % de pasos hechos, en curso sin checklist = 50 %, por hacer = 0 %.
export function calcularSalud(tareas, hoy, limite) {
  const porKey = new Map(tareas.map((t) => [t.key, t]));
  const alertas = [];
  const agregar = (nivel, tipo, tarea, texto, peso = 0) => alertas.push({ nivel, tipo, tarea, texto, peso, id: `${tipo}:${tarea?.key || ''}` });

  for (const t of tareas) {
    if (t.hecha) continue;
    const r = rango(t);
    const vencida = t.due && t.due < hoy;
    if (vencida) agregar('critica', 'vencida', t, `Venció el ${fmtCorta(t.due)}, ${haceDias(dias(t.due, hoy))}`, dias(t.due, hoy));
    else if (r && r.fin > limite) {
      agregar('critica', 'limite', t, `Termina el ${fmtCorta(r.fin)}, ${pl(dias(limite, r.fin), 'día', 'días')} después de la fecha límite`, dias(limite, r.fin));
    }
    if (!vencida && t.sinEmpezar && t.start && t.start < hoy) {
      agregar('riesgo', 'sin-empezar', t, `Debía empezar el ${fmtCorta(t.start)} (${haceDias(dias(t.start, hoy))}) y sigue en «Por hacer»`, dias(t.start, hoy));
    }
    for (const k of t.deps) {
      const p = porKey.get(k);
      if (!p || p.hecha) continue;
      const rp = rango(p);
      if (p.due && p.due < hoy) agregar('riesgo', 'previa-vencida', t, `Espera a «${p.titulo}», que está vencida`, dias(p.due, hoy));
      else if (rp && r && r.ini <= rp.fin) agregar('riesgo', 'conflicto', t, `Empieza antes de que termine «${p.titulo}» (${fmtCorta(rp.fin)})`);
    }
    if (!vencida && t.due && dias(hoy, t.due) <= 7) agregar('aviso', 'pronto', t, `Vence ${enDias(dias(hoy, t.due))} (${fmtCorta(t.due)})`, -dias(hoy, t.due));
  }

  const total = tareas.length;
  const hechas = tareas.filter((t) => t.hecha).length;
  const sinFechas = tareas.filter((t) => !rango(t)).length;
  const avance = total
    ? tareas.reduce((s, t) => s + (t.hecha ? 1 : t.avance !== null ? t.avance : t.sinEmpezar ? 0 : 0.5), 0) / total
    : 0;
  const inicios = tareas.map(rango).filter(Boolean).map((r) => r.ini).sort();
  const inicio = inicios[0] || hoy;
  const plazo = dias(inicio, limite);
  const tiempo = plazo > 0 ? Math.min(1, Math.max(0, dias(inicio, hoy) / plazo)) : 1;
  const diasRestantes = dias(hoy, limite);

  if (diasRestantes < 0 && hechas < total) {
    agregar('critica', 'limite-pasado', null, `La fecha límite (${fmtCorta(limite)}) pasó ${haceDias(-diasRestantes)} y quedan ${pl(total - hechas, 'tarea', 'tareas')} sin completar`);
  }
  if (total && tiempo - avance > BRECHA_RIESGO) {
    agregar('riesgo', 'ritmo', null, `El avance (${Math.round(avance * 100)} %) va ${Math.round((tiempo - avance) * 100)} puntos detrás del tiempo transcurrido (${Math.round(tiempo * 100)} %)`);
  }
  if (sinFechas) agregar('aviso', 'sin-fechas', null, `${pl(sinFechas, 'tarea no tiene', 'tareas no tienen')} fechas: no se puede saber si llegan a la fecha límite`, sinFechas);

  alertas.sort((a, b) => NIVELES.indexOf(a.nivel) - NIVELES.indexOf(b.nivel) || b.peso - a.peso);
  const cuenta = Object.fromEntries(NIVELES.map((n) => [n, alertas.filter((a) => a.nivel === n).length]));
  const estado = cuenta.critica ? 'atrasado' : cuenta.riesgo ? 'riesgo' : 'ok';

  // Motivo: los tipos de alerta del nivel que define el estado
  const nivelMotivo = estado === 'atrasado' ? 'critica' : estado === 'riesgo' ? 'riesgo' : null;
  const porTipo = new Map();
  for (const a of alertas) if (a.nivel === nivelMotivo) porTipo.set(a.tipo, (porTipo.get(a.tipo) || 0) + 1);
  const motivo = nivelMotivo ? [...porTipo].map(([tipo, n]) => RESUMEN[tipo](n)).join(' · ') : ESTADOS.ok.ayuda;

  return { estado, motivo, alertas, cuenta, total, hechas, sinFechas, avance, tiempo, inicio, diasRestantes, limite };
}

const leerAbierto = () => {
  try {
    return localStorage.getItem('gantt.salud') !== 'cerrado';
  } catch {
    return true;
  }
};

export function SaludProyecto({ salud, nombre, onAbrir }) {
  const [abierto, setAbierto] = useState(leerAbierto);
  const [nivel, setNivel] = useState(''); // filtro de la lista de alertas
  const e = ESTADOS[salud.estado];
  const pct = (v) => `${Math.round(v * 100)} %`;
  const lista = nivel ? salud.alertas.filter((a) => a.nivel === nivel) : salud.alertas;

  function alternar() {
    setAbierto((a) => {
      try {
        localStorage.setItem('gantt.salud', a ? 'cerrado' : 'abierto');
      } catch {}
      return !a;
    });
  }

  return (
    <section className={`salud salud-${salud.estado}`} aria-label={`Estado de salud: ${e.nombre}`}>
      <div className="salud-cab">
        <span className="salud-punto" aria-hidden="true" />
        <div className="salud-titulo">
          <small>Estado de salud · {nombre}</small>
          <strong>{e.nombre}</strong>
        </div>
        <p className="salud-motivo">{salud.motivo}</p>
        <div className="salud-cuentas">
          {NIVELES.map(
            (n) =>
              salud.cuenta[n] > 0 && (
                <span key={n} className={`salud-cuenta nivel-${n}`}>
                  {salud.cuenta[n]} {NOMBRE_NIVEL[n].toLowerCase()}
                  {salud.cuenta[n] === 1 ? '' : 's'}
                </span>
              ),
          )}
        </div>
        <button type="button" className="btn" onClick={alternar} aria-expanded={abierto}>
          {abierto ? 'Ocultar' : 'Ver detalle'}
        </button>
      </div>

      {abierto && (
        <div className="salud-cuerpo">
          <div className="salud-metricas">
            <div className="salud-metrica ancha">
              <span>Avance real contra tiempo transcurrido</span>
              <div
                className="salud-barra"
                role="img"
                aria-label={`Avance ${pct(salud.avance)}, tiempo transcurrido ${pct(salud.tiempo)}`}
                title="Avance: completadas 100 %, con checklist según sus pasos, en curso sin checklist 50 %, por hacer 0 %"
              >
                <i style={{ width: `${salud.avance * 100}%` }} />
                <b style={{ left: `${salud.tiempo * 100}%` }} />
              </div>
              <small>
                <strong>{pct(salud.avance)}</strong> de avance · <strong>{pct(salud.tiempo)}</strong> del tiempo (desde el {fmtCorta(salud.inicio)})
              </small>
            </div>
            <div className="salud-metrica">
              <span>Fecha límite</span>
              <strong className={salud.diasRestantes < 0 ? 'mal' : ''}>
                {salud.diasRestantes >= 0 ? pl(salud.diasRestantes, 'día', 'días') : `${-salud.diasRestantes} días tarde`}
              </strong>
              <small>{fmtLarga(salud.limite)}</small>
            </div>
            <div className="salud-metrica">
              <span>Completadas</span>
              <strong>
                {salud.hechas} de {salud.total}
              </strong>
              <small>{salud.total ? pct(salud.hechas / salud.total) : '—'} de las tareas</small>
            </div>
            <div className="salud-metrica">
              <span>Sin fechas</span>
              <strong className={salud.sinFechas ? 'atencion' : ''}>{salud.sinFechas}</strong>
              <small>sin planificar</small>
            </div>
          </div>

          <div className="salud-alertas">
            <div className="salud-alertas-cab">
              <span>Alertas de atraso</span>
              <div className="gantt-seg" role="group" aria-label="Filtrar alertas">
                {['', ...NIVELES].map((n) => (
                  <button key={n || 'todas'} type="button" className={nivel === n ? 'on' : ''} onClick={() => setNivel(n)}>
                    {n ? NOMBRE_NIVEL[n] : 'Todas'} {n ? salud.cuenta[n] : salud.alertas.length}
                  </button>
                ))}
              </div>
            </div>
            {lista.length === 0 ? (
              <p className="salud-vacio">{salud.alertas.length ? 'No hay alertas de este nivel.' : 'No hay alertas: el plan viene en término.'}</p>
            ) : (
              <ul>
                {lista.map((a) => (
                  <li key={a.id} className={`nivel-${a.nivel}`}>
                    <span className="salud-nivel">{NOMBRE_NIVEL[a.nivel]}</span>
                    {a.tarea ? (
                      <button type="button" className="salud-alerta" onClick={() => onAbrir(a.tarea)} title="Abrir la tarea">
                        <strong>{a.tarea.titulo}</strong>
                        <span>
                          {a.tarea.proceso} · {a.texto}
                        </span>
                      </button>
                    ) : (
                      <div className="salud-alerta">
                        <strong>{nombre}</strong>
                        <span>{a.texto}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
