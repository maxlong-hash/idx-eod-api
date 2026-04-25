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

function sendError(response, statusCode, message) {
  response.status(statusCode).json({ error: message });
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function serializeRecordsToCsv(records) {
  const headers = [
    '<date>',
    '<ticker>',
    '<open>',
    '<high>',
    '<low>',
    '<close>',
    '<volume>',
    '<freq>',
    '<valuasi>',
    '<nbsa>'
  ];

  const lines = [
    headers.join(',')
  ];

  for (const record of records) {
    lines.push(
      [
        record.date,
        record.ticker,
        record.open,
        record.high,
        record.low,
        record.close,
        record.volume,
        record.tradeFrequency,
        record.tradeValue,
        record.nbsa
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  return lines.join('\n');
}

function buildHistoryFilename(ticker, startDate, endDate) {
  return `${ticker}_${startDate}_${endDate}.csv`;
}

function buildHistoryDownloadUrl(baseUrl, { ticker, startDate, endDate, order }) {
  const params = new URLSearchParams({
    ticker,
    startDate,
    endDate,
    order
  });
  return `${baseUrl}/files/eod-history.csv?${params.toString()}`;
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
      historyEndpoint: '/api/eod/history',
      ihsgEndpoint: '/api/eod/ihsg',
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
  <p>This API provides read-only access to raw IDX end-of-day stock market history from a locally maintained dataset.</p>
  <p>The API does not require account login and does not intentionally store end-user personal information submitted through requests.</p>
  <p>Basic server logs may record request metadata such as timestamps and IP addresses for reliability and abuse prevention.</p>
  <p>Data returned by this API is limited to raw market history records for a ticker and date range.</p>
  <p>Operator contact: replace this text with your real contact email before publishing publicly.</p>
  <p>Service base URL: <a href="${baseUrl}">${baseUrl}</a></p>
</body>
</html>`);
  });

  app.get('/openapi.json', async (request, response) => {
    const baseUrl = getRequestBaseUrl(request, options.publicBaseUrl);
    response.json(buildOpenApiSchema(baseUrl));
  });

  app.get('/files/eod-history.csv', async (request, response) => {
    try {
      const ticker = String(request.query.ticker ?? '').trim();
      if (!ticker) {
        sendError(response, 400, 'ticker is required');
        return;
      }

      const latestAvailableDate = store.getLatestAvailableDate(ticker);
      if (!latestAvailableDate) {
        sendError(response, 404, `No history found for ticker ${ticker.toUpperCase()}`);
        return;
      }

      const requestedStartDate = request.query.startDate ? String(request.query.startDate) : undefined;
      const requestedEndDate = request.query.endDate ? String(request.query.endDate) : undefined;
      const order = request.query.order === 'desc' ? 'desc' : 'asc';
      const records = store.getHistory({
        ticker,
        startDate: requestedStartDate,
        endDate: requestedEndDate,
        order
      });

      if (records.length === 0) {
        sendError(
          response,
          404,
          requestedStartDate || requestedEndDate
            ? `No history found for ${ticker.toUpperCase()} in the requested date range`
            : `No history found for ${ticker.toUpperCase()}`
        );
        return;
      }

      const serializedRecords = records.map((record) => store.serializeRecord(record));
      const startDate = serializedRecords[0]?.date ?? latestAvailableDate;
      const endDate = serializedRecords[serializedRecords.length - 1]?.date ?? latestAvailableDate;
      const fileName = buildHistoryFilename(ticker.toUpperCase(), startDate, endDate);

      response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      response.type('text/csv; charset=utf-8').send(serializeRecordsToCsv(serializedRecords));
    } catch (error) {
      sendError(response, 400, error.message);
    }
  });

  const sendHistoryResponse = async (request, response, fixedTicker = null) => {
    try {
      const ticker = fixedTicker ?? String(request.query.ticker ?? '').trim();
      if (!ticker) {
        sendError(response, 400, 'ticker is required');
        return;
      }

      const startDate = request.query.startDate ? String(request.query.startDate) : undefined;
      const endDate = request.query.endDate ? String(request.query.endDate) : undefined;
      const order = request.query.order === 'desc' ? 'desc' : 'asc';
      const format = String(request.query.format ?? 'file_url').trim().toLowerCase();

      if (format !== 'json' && format !== 'csv' && format !== 'file_url') {
        sendError(response, 400, 'format must be one of json, csv, or file_url');
        return;
      }

      const baseUrl = getRequestBaseUrl(request, options.publicBaseUrl);
      const latestAvailableDate = store.getLatestAvailableDate(ticker);
      if (!latestAvailableDate) {
        sendError(response, 404, `No history found for ticker ${ticker.toUpperCase()}`);
        return;
      }

      const records = store.getHistory({
        ticker,
        startDate,
        endDate,
        order
      });

      if (records.length === 0) {
        sendError(
          response,
          404,
          startDate || endDate
            ? `No history found for ${ticker.toUpperCase()} in the requested date range`
            : `No history found for ${ticker.toUpperCase()}`
        );
        return;
      }

      const serializedRecords = records.map((record) => store.serializeRecord(record));
      const earliestReturnedDate = records.reduce(
        (current, record) => (current === null || record.date < current ? record.date : current),
        null
      );
      const latestReturnedDate = records.reduce(
        (current, record) => (current === null || record.date > current ? record.date : current),
        null
      );

      if (format === 'csv') {
        response
          .type('text/csv; charset=utf-8')
          .send(serializeRecordsToCsv(serializedRecords));
        return;
      }

      const downloadUrl = buildHistoryDownloadUrl(baseUrl, {
        ticker: ticker.toUpperCase(),
        startDate: earliestReturnedDate,
        endDate: latestReturnedDate,
        order
      });

      if (format === 'file_url') {
        response.json({
          ticker: ticker.toUpperCase(),
          startDate: earliestReturnedDate,
          endDate: latestReturnedDate,
          latestAvailableDate,
          returned: records.length,
          downloadUrl,
          openaiFileResponse: [downloadUrl]
        });
        return;
      }

      response.json({
        ticker: ticker.toUpperCase(),
        startDate: earliestReturnedDate,
        endDate: latestReturnedDate,
        latestAvailableDate,
        returned: records.length,
        records: serializedRecords
      });
    } catch (error) {
      sendError(response, 400, error.message);
    }
  };

  app.get('/api/eod/history', async (request, response) => {
    await sendHistoryResponse(request, response);
  });

  app.get('/api/eod/ihsg', async (request, response) => {
    await sendHistoryResponse(request, response, 'IHSG');
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
