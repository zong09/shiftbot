import axios from 'axios';

const BASE = '/api';

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
