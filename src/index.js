import path from 'node:path';
import process from 'node:process';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { EodDataStore } from './eod-store.js';
import { createEodMcpServer } from './mcp-server.js';
import { buildOpenApiSchema, getRequestBaseUrl } from './openapi.js';

function getArgValue(flagName) {
  const direct = process.argv.find((arg) => arg.startsWith(`${flagName}=`));
  if (direct) {
    return direct.slice(flagName.length + 1);
  }

  const index = process.argv.findIndex((arg) => arg === flagName);
  if (index >= 0) {
    return process.argv[index + 1];
  }

  return null;
}

function resolveOptions() {
  const transport = getArgValue('--transport') ?? process.env.MCP_TRANSPORT ?? 'http';
  const port = Number(getArgValue('--port') ?? process.env.PORT ?? 3000);
  const host = getArgValue('--host') ?? process.env.HOST ?? '127.0.0.1';
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? null;
  const filePath = process.env.EOD_FILE_PATH
    ? path.resolve(process.env.EOD_FILE_PATH)
    : path.resolve(process.cwd(), 'EOD 2023-2026.txt');

  return {
    transport,
    port,
    host,
    publicBaseUrl,
    filePath
  };
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function sendError(response, statusCode, message) {
  response.status(statusCode).json({ error: message });
}

async function startStdioServer(store) {
  const server = createEodMcpServer(store);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error(`[idx-eod-mcp] stdio server ready with dataset ${store.filePath}`);

  const shutdown = async () => {
    await server.close();
    await transport.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function startHttpServer(store, options) {
  const app = createMcpExpressApp({ host: options.host });

  app.get('/', async (_request, response) => {
    response.json({
      name: 'idx-eod-mcp',
      status: 'ok',
      transport: 'http',
      mcpEndpoint: '/mcp',
      openApiEndpoint: '/openapi.json',
      privacyPolicyEndpoint: '/privacy',
      stats: store.getStats()
    });
  });

  app.get('/health', async (_request, response) => {
    response.json({
      status: 'ok',
      stats: store.getStats()
    });
  });

  app.get('/privacy', async (request, response) => {
    const baseUrl = getRequestBaseUrl(request, options.publicBaseUrl);
    response.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>IDX EOD API Privacy Policy</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 760px; margin: 40px auto; line-height: 1.6;">
  <h1>IDX EOD API Privacy Policy</h1>
  <p>This API provides read-only access to IDX end-of-day stock market data from a locally maintained dataset.</p>
  <p>The API does not require account login and does not intentionally store end-user personal information submitted through requests.</p>
  <p>Basic server logs may record request metadata such as timestamps and IP addresses for reliability and abuse prevention.</p>
  <p>Data returned by this API is limited to market data records and derived summaries.</p>
  <p>Operator contact: replace this text with your real contact email before publishing publicly.</p>
  <p>Service base URL: <a href="${baseUrl}">${baseUrl}</a></p>
</body>
</html>`);
  });

  app.get('/openapi.json', async (request, response) => {
    const baseUrl = getRequestBaseUrl(request, options.publicBaseUrl);
    response.json(buildOpenApiSchema(baseUrl));
  });

  app.get('/api/eod/latest-date', async (request, response) => {
    try {
      const ticker = request.query.ticker ? String(request.query.ticker) : undefined;
      const latestDate = store.getLatestAvailableDate(ticker);

      if (!latestDate) {
        sendError(response, 404, ticker ? `No data found for ticker ${ticker}` : 'Dataset is empty');
        return;
      }

      response.json({
        ticker: ticker?.toUpperCase() ?? null,
        latestDate
      });
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/eod/record', async (request, response) => {
    try {
      const ticker = String(request.query.ticker ?? '').trim();
      const date = request.query.date ? String(request.query.date) : undefined;

      if (!ticker) {
        sendError(response, 400, 'ticker is required');
        return;
      }

      const record = store.getRecord(ticker, date);
      if (!record) {
        sendError(
          response,
          404,
          date
            ? `No EOD record found for ${ticker.toUpperCase()} on ${date}`
            : `No EOD record found for ${ticker.toUpperCase()}`
        );
        return;
      }

      response.json(store.serializeRecord(record));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/eod/history', async (request, response) => {
    try {
      const ticker = String(request.query.ticker ?? '').trim();
      if (!ticker) {
        sendError(response, 400, 'ticker is required');
        return;
      }

      const startDate = request.query.startDate ? String(request.query.startDate) : undefined;
      const endDate = request.query.endDate ? String(request.query.endDate) : undefined;
      const defaultLimit = startDate || endDate ? 2000 : 30;
      const limit = Math.min(parsePositiveInteger(request.query.limit, defaultLimit), 2000);
      const order = request.query.order === 'asc' ? 'asc' : 'desc';
      const records = store.getHistory({
        ticker,
        startDate,
        endDate,
        limit,
        order
      });

      response.json({
        ticker: ticker.toUpperCase(),
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        returned: records.length,
        records: records.map((record) => store.serializeRecord(record))
      });
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/eod/tickers', async (request, response) => {
    try {
      const prefix = request.query.prefix ? String(request.query.prefix) : undefined;
      const limit = Math.min(parsePositiveInteger(request.query.limit, 50), 500);

      response.json({
        prefix: prefix?.toUpperCase() ?? null,
        tickers: store.listTickers({ prefix, limit })
      });
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/api/eod/market-summary', async (request, response) => {
    try {
      const date = request.query.date ? String(request.query.date) : undefined;
      const topN = Math.min(parsePositiveInteger(request.query.topN, 10), 50);
      const summary = store.getMarketDaySummary(date, topN);

      if (!summary) {
        sendError(response, 404, date ? `No market data found for ${date}` : 'Dataset is empty');
        return;
      }

      response.json(summary);
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  app.get('/documents/dataset/metadata', async (_request, response) => {
    response.json(store.getDatasetMetadataDocument());
  });

  app.get('/documents/ticker/:ticker', async (request, response) => {
    const document = store.getTickerDocument(request.params.ticker);
    if (!document) {
      response.status(404).json({ error: 'Ticker document not found' });
      return;
    }

    response.json(document);
  });

  app.get('/documents/date/:date', async (request, response) => {
    const document = store.getDateDocument(request.params.date);
    if (!document) {
      response.status(404).json({ error: 'Date document not found' });
      return;
    }

    response.json(document);
  });

  app.get('/documents/record/:ticker/:date', async (request, response) => {
    const document = store.getRecordDocument(request.params.ticker, request.params.date);
    if (!document) {
      response.status(404).json({ error: 'Record document not found' });
      return;
    }

    response.json(document);
  });

  app.post('/mcp', async (request, response) => {
    const server = createEodMcpServer(store);

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      });

      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);

      response.on('close', async () => {
        await transport.close();
        await server.close();
      });
    } catch (error) {
      console.error('[idx-eod-mcp] HTTP transport error:', error);

      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error'
          },
          id: null
        });
      }
    }
  });

  app.get('/mcp', async (_request, response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.'
      },
      id: null
    });
  });

  app.delete('/mcp', async (_request, response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.'
      },
      id: null
    });
  });

  app.listen(options.port, options.host, () => {
    console.log(
      `[idx-eod-mcp] HTTP server listening on http://${options.host}:${options.port} with dataset ${store.filePath}`
    );
  });
}

async function main() {
  const options = resolveOptions();
  const store = new EodDataStore({
    filePath: options.filePath,
    publicBaseUrl: options.publicBaseUrl
  });

  await store.ensureLoaded();

  if (options.transport === 'stdio') {
    await startStdioServer(store);
    return;
  }

  if (options.transport === 'http') {
    await startHttpServer(store, options);
    return;
  }

  throw new Error(`Unsupported transport: ${options.transport}`);
}

main().catch((error) => {
  console.error('[idx-eod-mcp] fatal error:', error);
  process.exit(1);
});
