const API = '/api';

function getHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` })
  };
}

async function request(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: getHeaders()
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

export const api = {
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  getSessions: () => request('/sessions'),
  getSession: (id) => request(`/sessions/${id}`),
  createSession: (body) => request('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  analyze: (shots, lang) => request('/analyze', { method: 'POST', body: JSON.stringify({ shots, lang }) })
};
