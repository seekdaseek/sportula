// Same-origin read-only JSON-RPC proxy for Arc. Some browsers get 503 from the public Arc RPC hosts
// when the request comes from another origin, so the app reads through this function instead.
// It forwards read methods only. Transactions are signed and sent by the user's wallet, never here.
// Documented public Arc RPC endpoints (docs.arc.io connect-to-arc). They rate-limit separately, so a
// rate-limited or failing one is skipped in favour of the next.
const UPSTREAM = {
  mainnet: [
    'https://rpc.mainnet.arc.io',
    'https://rpc.blockdaemon.mainnet.arc.io',
    'https://rpc.drpc.mainnet.arc.io',
    'https://rpc.quicknode.mainnet.arc.io',
  ],
  testnet: ['https://rpc.testnet.arc.io'],
}

const READ_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_call',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionCount',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getLogs',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'net_version',
])

const MAX_BODY_BYTES = 100_000
const MAX_BATCH = 50
const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' }

function reject(status, id, message) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: -32601, message } }), {
    status,
    headers: HEADERS,
  })
}

export async function onRequestPost({ request, params }) {
  const upstreams = UPSTREAM[params.net]
  if (!upstreams) return new Response('Not found', { status: 404 })

  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return reject(413, null, 'Request too large')

  let body
  try {
    body = JSON.parse(text)
  } catch {
    return reject(400, null, 'Invalid JSON')
  }
  const calls = Array.isArray(body) ? body : [body]
  if (calls.length === 0 || calls.length > MAX_BATCH) return reject(400, null, 'Invalid batch size')
  for (const call of calls) {
    if (!call || typeof call.method !== 'string' || !READ_METHODS.has(call.method)) {
      return reject(403, call && call.id, 'Method not allowed on the read-only proxy')
    }
  }

  let last = { status: 502, text: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'No upstream answered' } }) }
  for (const upstream of upstreams) {
    try {
      const res = await fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text })
      const out = await res.text()
      const limited = res.status === 429 || res.status >= 500 || out.includes('"code":-32005') || out.includes('rate limit')
      last = { status: res.status, text: out }
      if (!limited) return new Response(out, { status: res.status, headers: HEADERS })
    } catch {
      // try the next upstream
    }
  }
  return new Response(last.text, { status: last.status, headers: HEADERS })
}

export function onRequest() {
  return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } })
}
