import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

const ZOOMS = [0.4, 0.5, 0.65, 0.8, 1, 1.25, 1.5];

// Copia los estilos calculados al SVG para que el archivo descargado se vea igual
function exportarSvg(svg, nombre) {
  const clon = svg.cloneNode(true);
  const origen = svg.querySelectorAll('*');
  clon.querySelectorAll('*').forEach((el, i) => {
    const cs = getComputedStyle(origen[i]);
    for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'font-family', 'font-size', 'font-weight', 'opacity']) {
      el.style.setProperty(p, cs.getPropertyValue(p));
    }
  });
  clon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clon.style.background = getComputedStyle(document.body).backgroundColor;
  const blob = new Blob([new XMLSerializer().serializeToString(clon)], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${nombre}.svg`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Área desplazable con zoom (ajusta al ancho por defecto) y descarga en SVG.
// `children` es una función que recibe la ref que debe ir en el <svg>.
export function Lienzo({ nombreArchivo, children }) {
  const [zoomManual, setZoomManual] = useState(null); // null = ajustar al ancho
  const [ajuste, setAjuste] = useState(1);
  const svgRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    const caja = scrollRef.current;
    const ancho = svgRef.current?.width.baseVal.value;
    if (!caja || !ancho) return;
    const ro = new ResizeObserver(() => setAjuste(Math.min(1.25, (caja.clientWidth - 40) / ancho)));
    ro.observe(caja);
    return () => ro.disconnect();
  }, [nombreArchivo]);

  const zoom = zoomManual ?? ajuste;
  const cambiarZoom = (dir) => {
    const siguiente = dir > 0 ? ZOOMS.find((z) => z > zoom + 0.01) : ZOOMS.findLast((z) => z < zoom - 0.01);
    if (siguiente) setZoomManual(siguiente);
  };

  return (
    <div className="lienzo">
      <div className="lienzo-herramientas">
        <button className="btn icono" title="Alejar" disabled={zoom <= ZOOMS[0]} onClick={() => cambiarZoom(-1)}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="btn icono" title="Acercar" disabled={zoom >= ZOOMS.at(-1)} onClick={() => cambiarZoom(1)}>+</button>
        <button className="btn icono" title="Ajustar al ancho" disabled={zoomManual === null} onClick={() => setZoomManual(null)}>
          <Icon name="expand" />
        </button>
        <button className="btn icono" title="Descargar SVG" onClick={() => exportarSvg(svgRef.current, nombreArchivo)}>
          <Icon name="download" />
        </button>
      </div>
      <div className="lienzo-scroll" ref={scrollRef}>
        <div style={{ zoom }}>{children(svgRef)}</div>
      </div>
    </div>
  );
}
