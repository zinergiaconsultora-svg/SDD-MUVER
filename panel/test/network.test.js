// Tests de lib/network.js — R23
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildAccessUrls } from '../lib/network.js';

const INTERFACES = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  eth0: [
    { address: '192.168.1.20', family: 'IPv4', internal: false },
    { address: 'fe80::1', family: 'IPv6', internal: false },
  ],
};

test('[R23] buildAccessUrls devuelve localhost y solo las IPv4 externas', () => {
  assert.deepEqual(buildAccessUrls(4310, INTERFACES), ['http://localhost:4310', 'http://192.168.1.20:4310']);
});

test('[R23] buildAccessUrls acepta family numérica (Node 18.0–18.3) y sin interfaces externas', () => {
  const ifaces = { wifi: [{ address: '10.0.0.5', family: 4, internal: false }] };
  assert.deepEqual(buildAccessUrls(8080, ifaces), ['http://localhost:8080', 'http://10.0.0.5:8080']);
  assert.deepEqual(buildAccessUrls(8080, {}), ['http://localhost:8080']);
});
