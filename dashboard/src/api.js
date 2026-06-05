import axios from 'axios';

const BASE = '/api';

export const fetchStatus    = () => axios.get(`${BASE}/status`).then(r => r.data);
export const fetchTrades    = () => axios.get(`${BASE}/trades`).then(r => r.data);
export const fetchIndicator = () => axios.get(`${BASE}/indicator`).then(r => r.data);
export const fetchHealth    = () => axios.get(`${BASE}/health`).then(r => r.data);
