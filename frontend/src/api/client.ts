import axios from 'axios';
import { useAuth } from '../store/auth';

// `||` y no `??`: una VITE_API_URL vacía en .env debe caer al valor por defecto.
const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api = axios.create({ baseURL });

// Inyecta el token y la empresa seleccionada en cada request.
api.interceptors.request.use((config) => {
  const { token, selectedCompanyId } = useAuth.getState();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (selectedCompanyId) {
    config.headers['X-Company-Id'] = selectedCompanyId;
  }
  return config;
});

// Ante 401, cierra sesión (el guard del router redirige a /login).
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) {
      useAuth.getState().logout();
    }
    return Promise.reject(error);
  },
);
