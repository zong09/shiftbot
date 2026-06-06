import axios from 'axios';

const BASE = '/api';

export const fetchStatus    = (mode = 'live') => axios.get(`${BASE}/status?mode=${mode}`).then(r => r.data);
export const fetchTrades    = (mode = 'live') => axios.get(`${BASE}/trades?mode=${mode}`).then(r => r.data);
export const fetchIndicator = ()              => axios.get(`${BASE}/indicator`).then(r => r.data);
export const fetchHealth    = ()              => axios.get(`${BASE}/health`).then(r => r.data);
export const fetchCandles   = (timeframe)     => axios.get(`${BASE}/candles${timeframe ? `?timeframe=${timeframe}` : ''}`).then(r => r.data);
export const fetchSettings  = ()              => axios.get(`${BASE}/settings`).then(r => r.data);
export const updateSettings = (mode, data)    => axios.put(`${BASE}/settings/${mode}`, data).then(r => r.data);
