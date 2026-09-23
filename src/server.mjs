import path from 'node:path';
import { createApp } from './app.mjs';

const port = Number(process.env.PORT ?? 8090);
const host = process.env.HOST ?? '127.0.0.1';
const dataFile = path.resolve(process.env.DATA_FILE ?? '.data/gateways.json');

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效');

const server = await createApp({ adminToken: process.env.ADMIN_TOKEN, dataFile });
server.listen(port, host, () => {
  console.log(`ELSDTU 验证服务已启动：http://${host}:${port}`);
});
