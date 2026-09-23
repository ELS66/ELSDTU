import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function tokenMatches(actual, expected) {
  const left = Buffer.from(actual ?? '');
  const right = Buffer.from(expected ?? '');
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearerToken(request) {
  const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '');
  return match?.[1] ?? '';
}

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 16_384) {
      const error = new Error('请求体过大');
      error.status = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('请求体必须是 JSON');
    error.status = 400;
    throw error;
  }
}

async function createStore(dataFile) {
  await mkdir(path.dirname(dataFile), { recursive: true });
  let gateways;
  try {
    gateways = JSON.parse(await readFile(dataFile, 'utf8')).gateways;
    if (!Array.isArray(gateways)) throw new Error('网关数据格式错误');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    gateways = [];
  }

  let writeQueue = Promise.resolve();
  function save() {
    const snapshot = JSON.stringify({ schemaVersion: 1, gateways }, null, 2);
    writeQueue = writeQueue.then(async () => {
      const temporary = `${dataFile}.${randomUUID()}.tmp`;
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, dataFile);
    });
    return writeQueue;
  }
  return { gateways, save };
}

export async function createApp({ adminToken, dataFile, heartbeatTimeoutMs = 30_000, now = Date.now }) {
  if (typeof adminToken !== 'string' || adminToken.length < 16) {
    throw new Error('ADMIN_TOKEN 至少需要 16 个字符');
  }
  const store = await createStore(dataFile);

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const route = url.pathname;

      if (request.method === 'GET' && route === '/health') {
        return send(response, 200, { status: 'ok' });
      }

      if (request.method === 'GET' && route === '/api/gateways') {
        if (!tokenMatches(bearerToken(request), adminToken)) return send(response, 401, { error: '未授权' });
        return send(response, 200, {
          items: store.gateways.map(({ tokenHash: _tokenHash, ...gateway }) => ({
            ...gateway,
            online: gateway.lastSeenAt !== null && now() - Date.parse(gateway.lastSeenAt) < heartbeatTimeoutMs,
          })),
        });
      }

      if (request.method === 'POST' && route === '/api/gateways') {
        if (!tokenMatches(bearerToken(request), adminToken)) return send(response, 401, { error: '未授权' });
        const body = await readJson(request);
        const serialNo = typeof body?.serialNo === 'string' ? body.serialNo.trim() : '';
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(serialNo) || name.length < 1 || name.length > 100) {
          return send(response, 400, { error: 'serialNo 或 name 无效' });
        }
        if (store.gateways.some((item) => item.serialNo === serialNo)) {
          return send(response, 409, { error: '网关序列号已存在' });
        }
        const token = randomBytes(32).toString('base64url');
        const gateway = {
          id: randomUUID(),
          serialNo,
          name,
          tokenHash: tokenHash(token),
          createdAt: new Date(now()).toISOString(),
          lastSeenAt: null,
        };
        store.gateways.push(gateway);
        await store.save();
        return send(response, 201, { id: gateway.id, serialNo, name, token });
      }

      const heartbeat = /^\/api\/gateways\/([0-9a-f-]{36})\/heartbeat$/.exec(route);
      if (request.method === 'POST' && heartbeat) {
        const gateway = store.gateways.find((item) => item.id === heartbeat[1]);
        if (!gateway || !tokenMatches(tokenHash(bearerToken(request)), gateway.tokenHash)) {
          return send(response, 401, { error: '网关认证失败' });
        }
        gateway.lastSeenAt = new Date(now()).toISOString();
        await store.save();
        return send(response, 200, { accepted: true, serverTime: gateway.lastSeenAt });
      }

      return send(response, 404, { error: '接口不存在' });
    } catch (error) {
      if (error.status) return send(response, error.status, { error: error.message });
      console.error(error);
      return send(response, 500, { error: '服务器错误' });
    }
  });
}
