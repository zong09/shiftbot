import axios from 'axios';

const BASE = '/api';

// Dedicated instance — interceptors attach the JWT to THIS client only, never to the
// global axios default, so a future `import axios` call to an external URL can't leak
// the token to a third party.
const client = axios.create({ baseURL: BASE });

// Add JWT token to every request if available
client.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, error => {
  return Promise.reject(error);
});

// Handle 401 Unauthorized globally
client.interceptors.response.use(
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

export const login          = (username, password) => client.post('/auth/login', { username, password }).then(r => r.data);
export const fetchStatus    = (mode = 'live') => client.get(`/status?mode=${mode}`).then(r => r.data);
export const fetchTrades    = (mode = 'live', symbol) => client.get(`/trades?mode=${mode}${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ''}`).then(r => r.data);
export const fetchIndicator = (symbol = 'BTC/USDT:USDT') => client.get(`/indicator?symbol=${encodeURIComponent(symbol)}`).then(r => r.data);
export const fetchHealth    = ()              => client.get('/health').then(r => r.data);
export const fetchCandles   = (timeframe, symbol = 'BTC/USDT:USDT') => {
  const params = new URLSearchParams({ symbol });
  if (timeframe) params.set('timeframe', timeframe);
  return client.get(`/candles?${params}`).then(r => r.data);
};
export const fetchSettings  = ()              => client.get('/settings').then(r => r.data);
export const updateSettings = (mode, data)    => client.put(`/settings/${mode}`, data).then(r => r.data);
export const addPair        = (mode, symbol)  => client.post(`/settings/${mode}/pairs`, { symbol }).then(r => r.data);
export const removePair     = (mode, symbol)  => client.delete(`/settings/${mode}/pairs?symbol=${encodeURIComponent(symbol)}`).then(r => r.data);
export const closePosition  = (id)            => client.post(`/positions/${id}/close`).then(r => r.data);
// Manual entry — market order only; the server sources the entry price from the exchange.
export const openManualPosition = (payload)   => client.post('/positions/manual', payload).then(r => r.data);

export const fetchNotificationSettings  = (mode) => client.get(`/settings/notifications/${mode}`).then(r => r.data);
export const updateNotificationSettings = (mode, data) => client.put(`/settings/notifications/${mode}`, data).then(r => r.data);
export const sendTestNotification       = (mode, channel) => client.post(`/settings/notifications/${mode}/test?channel=${channel}`).then(r => r.data);
