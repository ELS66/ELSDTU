import assert from 'node:assert/strict';
import { mkdtemp, rmdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.mjs';

test('网关注册、认证、心跳、离线判断与重启持久化', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'elsdtu-'));
  const dataFile = path.join(directory, 'gateways.json');
  const adminToken = 'local-test-admin-token-12345';
  let currentTime = Date.parse('2026-01-01T00:00:00Z');
  let server;
  let baseUrl;

  async function start() {
    server = await createApp({ adminToken, dataFile, now: () => currentTime });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    await new Promise((resolve) => server.close(resolve));
  }
  async function list() {
    const response = await fetch(`${baseUrl}/api/gateways`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(response.status, 200);
    return (await response.json()).items;
  }

  try {
    await start();
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/gateways`)).status, 401);

    const registration = await fetch(`${baseUrl}/api/gateways`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNo: 'GW-001', name: '测试网关' }),
    });
    assert.equal(registration.status, 201);
    const gateway = await registration.json();
    assert.ok(gateway.token);
    assert.equal((await list())[0].online, false);
    assert.equal('token' in (await list())[0], false);

    const heartbeatUrl = `${baseUrl}/api/gateways/${gateway.id}/heartbeat`;
    assert.equal((await fetch(heartbeatUrl, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(heartbeatUrl, { method: 'POST', headers: { Authorization: `Bearer ${gateway.token}` } })).status, 200);
    assert.equal((await list())[0].online, true);

    currentTime += 31_000;
    assert.equal((await list())[0].online, false);
    await stop();
    await start();
    assert.equal((await list()).length, 1);
    assert.equal((await list())[0].serialNo, 'GW-001');
  } finally {
    if (server?.listening) await stop();
    await unlink(dataFile).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(directory);
  }
});
