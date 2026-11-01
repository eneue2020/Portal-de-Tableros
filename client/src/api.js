async function request(url, options) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body;
}

export const api = {
  listar: () => request('/api/tableros'),
  listarProcesos: () => request('/api/procesos'),
  proceso: (id) => request(`/api/procesos/${encodeURIComponent(id)}`),
  listarCanvan: () => request('/api/canvan'),

  subir: ({ archivo, nombre, categoria, descripcion }) => {
    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('nombre', nombre);
    fd.append('categoria', categoria);
    fd.append('descripcion', descripcion);
    return request('/api/tableros', { method: 'POST', body: fd });
  },

  editar: (id, datos) =>
    request(`/api/tableros/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    }),

  reemplazar: (id, archivo) => {
    const fd = new FormData();
    fd.append('archivo', archivo);
    return request(`/api/tableros/${id}/archivo`, { method: 'PUT', body: fd });
  },

  eliminar: (id) => request(`/api/tableros/${id}`, { method: 'DELETE' }),
};
