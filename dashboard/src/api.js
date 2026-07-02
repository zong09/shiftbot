import axios from 'axios';

const BASE = '/api';

// Add JWT token to every request if available
axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, error => {
  return Promise.reject(error);
});

// Handle 401 Unauthorized globally
axios.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      // Dispatch custom event to notify App component
      window.dispatchEvent(new Event('unauthorized'));
    }
    return Promise.reject(error);
  }
);

export const login          = (username, password) => axios.post(`${BASE}/auth/login`, { username, password }).then(r => r.data);
export const fetchStatus    = (mode = 'live') => axios.get(`${BASE}/status?mode=${mode}`).then(r => r.data);
export const fetchTrades    = (mode = 'live', symbol) => axios.get(`${BASE}/trades?mode=${mode}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`).then(r => r.data);
export const fetchIndicator = (symbol = 'BTC/USDT:USDT') => axios.get(`${BASE}/indicator?symbol=${encodeURIComponent(symbol)}`).then(r => r.data);
export const fetchHealth    = ()              => axios.get(`${BASE}/health`).then(r => r.data);
export const fetchCandles   = (timeframe, symbol = 'BTC/USDT:USDT') => {
  const params = new URLSearchParams({ symbol });
  if (timeframe) params.set('timeframe', timeframe);
  return axios.get(`${BASE}/candles?${params}`).then(r => r.data);
};
export const fetchSettings  = ()              => axios.get(`${BASE}/settings`).then(r => r.data);
export const updateSettings = (mode, data)    => axios.put(`${BASE}/settings/${mode}`, data).then(r => r.data);
export const addPair        = (mode, symbol)  => axios.post(`${BASE}/settings/${mode}/pairs`, { symbol }).then(r => r.data);
export const removePair     = (mode, symbol)  => axios.delete(`${BASE}/settings/${mode}/pairs?symbol=${encodeURIComponent(symbol)}`).then(r => r.data);
export const closePosition  = (id)            => axios.post(`${BASE}/positions/${id}/close`).then(r => r.data);
