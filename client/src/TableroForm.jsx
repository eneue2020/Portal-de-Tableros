import { useEffect, useState } from 'react';
import { Icon } from './Icon.jsx';

export function TableroForm({ modo, inicial, categorias, onCancel, onSubmit }) {
  const [archivo, setArchivo] = useState(null);
  const [nombre, setNombre] = useState(inicial?.nombre || '');
  const [categoria, setCategoria] = useState(inicial?.categoria || '');
  const [descripcion, setDescripcion] = useState(inicial?.descripcion || '');
  const [arrastrando, setArrastrando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const nuevo = modo === 'nuevo';

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  function elegir(file) {
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) return setError('Solo se aceptan archivos .html');
    setError(null);
    setArchivo(file);
    if (!nombre) setNombre(file.name.replace(/\.html?$/i, '').replace(/[_-]+/g, ' '));
  }

  async function enviar(e) {
    e.preventDefault();
    if (nuevo && !archivo) return setError('Elegí un archivo HTML');
    setEnviando(true);
    try {
      await onSubmit({ archivo, nombre, categoria, descripcion });
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  }

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal" onSubmit={enviar}>
        <h2>{nuevo ? 'Agregar tablero' : 'Editar tablero'}</h2>

        {nuevo && (
          <label
            className={`zona ${arrastrando ? 'sobre' : ''} ${archivo ? 'lista-ok' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastrando(false);
              elegir(e.dataTransfer.files[0]);
            }}
          >
            <Icon name="upload" />
            <span>{archivo ? archivo.name : 'Arrastrá el archivo HTML o hacé clic para elegirlo'}</span>
            <input type="file" accept=".html,.htm" hidden onChange={(e) => elegir(e.target.files[0])} />
          </label>
        )}

        <label className="campo">
          <span>Nombre</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Se toma del título del HTML si queda vacío" />
        </label>

        <label className="campo">
          <span>Categoría</span>
          <input list="categorias" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="General" />
          <datalist id="categorias">
            {categorias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <label className="campo">
          <span>Descripción</span>
          <textarea rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </label>

        {error && <p className="error-form">{error}</p>}

        <div className="pie">
          <button type="button" className="btn" onClick={onCancel}>Cancelar</button>
          <button type="submit" className="btn primario" disabled={enviando}>
            {enviando ? 'Guardando…' : nuevo ? 'Agregar' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
