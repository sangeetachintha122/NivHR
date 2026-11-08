import axios from 'axios';

const TOKEN_KEY = 'nivhr_session_token';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && sessionStorage.getItem(TOKEN_KEY)) {
      window.dispatchEvent(new Event('nivhr:unauthorized'));
    }
    return Promise.reject(error);
  },
);

export const tokenStorage = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token) => sessionStorage.setItem(TOKEN_KEY, token),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

export const getErrorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
  if (!error?.response) return 'Could not reach NivHR. Check the backend connection and try again.';
  const message = error.response.data?.message;
  const friendly = {
    400: message || 'Please check the information and try again.',
    401: 'Your session has expired. Please sign in again.',
    403: 'You do not have permission to do that.',
    404: 'The requested item could not be found.',
    409: message || 'This change conflicts with existing information.',
    429: message || 'Too many requests. Please wait a moment and try again.',
    500: 'The server could not complete your request. Please try again.',
    503: 'The service is temporarily unavailable. Please try again shortly.',
  };
  return friendly[error.response.status] || message || fallback;
};
