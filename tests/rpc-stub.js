/**
 * Minimal JSON-RPC stub used to exercise the real indexer against synthetic
 * contract logs — no chain, no network, fully deterministic.
 *
 * It only implements the methods ethers v5 needs for a `queryFilter` run:
 * eth_chainId, net_version, eth_blockNumber, eth_getBlockByNumber and
 * eth_getLogs (with correct topic + range filtering, including batch requests).
 */
import http from "node:http";

function hex(value) {
  return `0x${Number(value).toString(16)}`;
}

function parseQuantity(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    if (value.startsWith("0x")) return Number.parseInt(value, 16);
    if (/^\d+$/.test(value)) return Number(value);
    return null; // block tags such as "latest" are resolved by the caller
  }
  return null;
}

export function createRpcStub({ chainId = 11155111, latestBlock = 1000, logs = [], blockTimestamps = {} } = {}) {
  const requests = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let payload;
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }

      const handleOne = (call) => {
        requests.push(call);
        const { method, params = [] } = call;

        switch (method) {
          case "eth_chainId":
            return hex(chainId);
          case "net_version":
            return String(chainId);
          case "eth_blockNumber":
            return hex(latestBlock);
          case "eth_getBlockByNumber": {
            const tag = params[0];
            const number = tag === "latest" || tag === "pending" ? latestBlock : parseQuantity(tag);
            return {
              number: hex(number),
              hash: `0x${String(number).padStart(64, "0")}`,
              parentHash: `0x${String(Math.max(number - 1, 0)).padStart(64, "0")}`,
              nonce: "0x0000000000000000",
              sha3Uncles: `0x${"0".repeat(64)}`,
              logsBloom: `0x${"0".repeat(512)}`,
              transactionsRoot: `0x${"0".repeat(64)}`,
              stateRoot: `0x${"0".repeat(64)}`,
              receiptsRoot: `0x${"0".repeat(64)}`,
              miner: "0x0000000000000000000000000000000000000000",
              difficulty: "0x0",
              totalDifficulty: "0x0",
              extraData: "0x",
              size: "0x0",
              gasLimit: "0x1c9c380",
              gasUsed: "0x0",
              timestamp: hex(blockTimestamps[number] ?? 1700000000 + number * 12),
              uncles: [],
              transactions: [],
              baseFeePerGas: "0x0",
            };
          }
          case "eth_getLogs": {
            const filter = params[0] || {};
            const from = parseQuantity(filter.fromBlock) ?? 0;
            const to = parseQuantity(filter.toBlock) ?? latestBlock;
            const wantedTopics = filter.topics || [];

            return logs.filter((log) => {
              const block = Number(log.blockNumber);
              if (block < from || block > to) return false;

              for (let i = 0; i < wantedTopics.length; i += 1) {
                const wanted = wantedTopics[i];
                if (!wanted) continue;
                const actual = log.topics[i];
                const list = Array.isArray(wanted) ? wanted : [wanted];
                if (!list.includes(actual)) return false;
              }
              return true;
            });
          }
          default:
            return null;
        }
      };

      const reply = (call) => ({
        jsonrpc: "2.0",
        id: call.id,
        result: handleOne(call),
      });

      const response = Array.isArray(payload) ? payload.map(reply) : reply(payload);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(response));
    });
  });

  return {
    server,
    requests,
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address();
      return `http://127.0.0.1:${port}`;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
    methods() {
      return requests.map((call) => call.method);
    },
  };
}
