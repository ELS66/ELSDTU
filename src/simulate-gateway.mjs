const gatewayId = process.env.GATEWAY_ID;
const gatewayToken = process.env.GATEWAY_TOKEN;
const platformUrl = process.env.PLATFORM_URL ?? 'http://127.0.0.1:8090';

if (!gatewayId || !gatewayToken) throw new Error('需要 GATEWAY_ID 和 GATEWAY_TOKEN');

async function heartbeat() {
  try {
    const response = await fetch(`${platformUrl}/api/gateways/${gatewayId}/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gatewayToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    console.log(`心跳成功 ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`心跳失败：${error.message}`);
  }
}

await heartbeat();
setInterval(heartbeat, 10_000);
