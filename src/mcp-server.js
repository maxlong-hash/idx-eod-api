import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

function jsonText(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  };
}

export function createEodMcpServer(store) {
  const server = new McpServer({
    name: 'idx-eod-mcp',
    version: '1.0.0'
  });

  server.registerTool(
    'search',
    {
      title: 'Search EOD data',
      description:
        'Read-only compatibility tool for ChatGPT and deep research. Search EOD dataset documents by ticker, date, or metadata query.',
      inputSchema: {
        query: z.string().min(1).describe('Search query, for example "BBCA 2026-04-17" or "dataset metadata"')
      },
      annotations: readOnlyAnnotations()
    },
    async ({ query }) => {
      await store.ensureLoaded();
      const result = store.search(query, 10);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result)
          }
        ]
      };
    }
  );

  server.registerTool(
    'fetch',
    {
      title: 'Fetch EOD document',
      description:
        'Read-only compatibility tool for ChatGPT and deep research. Fetches the full document for an EOD search result id.',
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe('Document id from the search tool, for example "record:BBCA:2026-04-17"')
      },
      annotations: readOnlyAnnotations()
    },
    async ({ id }) => {
      await store.ensureLoaded();
      const document = store.fetchDocument(id);
      if (!document) {
        throw new Error(`Document not found for id: ${id}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(document)
          }
        ]
      };
    }
  );

  server.registerTool(
    'get_latest_available_date',
    {
      title: 'Get latest date',
      description: 'Get the latest available EOD date globally or for a specific ticker.',
      inputSchema: {
        ticker: z
          .string()
          .trim()
          .min(2)
          .max(8)
          .optional()
          .describe('Optional stock ticker, for example BBCA')
      },
      annotations: readOnlyAnnotations()
    },
    async ({ ticker }) => {
      await store.ensureLoaded();
      const latestDate = store.getLatestAvailableDate(ticker);
      if (!latestDate) {
        throw new Error(ticker ? `No data found for ticker ${ticker}` : 'Dataset is empty');
      }

      return jsonText({
        ticker: ticker?.toUpperCase() ?? null,
        latestDate
      });
    }
  );

  server.registerTool(
    'get_eod_record',
    {
      title: 'Get one EOD record',
      description: 'Get one EOD row for a ticker and date. If date is omitted, the latest record is returned.',
      inputSchema: {
        ticker: z.string().trim().min(2).max(8).describe('Stock ticker, for example BBCA'),
        date: z
          .string()
          .trim()
          .optional()
          .describe('Optional date. Prefer YYYY-MM-DD, for example 2026-04-17')
      },
      annotations: readOnlyAnnotations()
    },
    async ({ ticker, date }) => {
      await store.ensureLoaded();
      const record = store.getRecord(ticker, date);
      if (!record) {
        throw new Error(
          date
            ? `No EOD record found for ${ticker.toUpperCase()} on ${date}`
            : `No EOD record found for ${ticker.toUpperCase()}`
        );
      }

      return jsonText(store.serializeRecord(record));
    }
  );

  server.registerTool(
    'get_eod_history',
    {
      title: 'Get EOD history',
      description: 'Get historical EOD records for a ticker within an optional date range.',
      inputSchema: {
        ticker: z.string().trim().min(2).max(8).describe('Stock ticker, for example BBCA'),
        startDate: z
          .string()
          .trim()
          .optional()
          .describe('Optional range start date, prefer YYYY-MM-DD'),
        endDate: z
          .string()
          .trim()
          .optional()
          .describe('Optional range end date, prefer YYYY-MM-DD'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(30)
          .describe('Maximum number of rows to return'),
        order: z
          .enum(['asc', 'desc'])
          .default('desc')
          .describe('Sort order for returned rows')
      },
      annotations: readOnlyAnnotations()
    },
    async ({ ticker, startDate, endDate, limit, order }) => {
      await store.ensureLoaded();
      const records = store.getHistory({
        ticker,
        startDate,
        endDate,
        limit,
        order
      });

      return jsonText({
        ticker: ticker.toUpperCase(),
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        returned: records.length,
        records: records.map((record) => store.serializeRecord(record))
      });
    }
  );

  server.registerTool(
    'get_chart_package',
    {
      title: 'Get chart package',
      description:
        'Get chart-ready technical rows for a ticker with OHLCV, NBSA, and moving averages MA20, MA50, and MA200.',
      inputSchema: {
        ticker: z.string().trim().min(2).max(8).describe('Stock ticker, for example BBCA'),
        startDate: z
          .string()
          .trim()
          .optional()
          .describe('Optional range start date, prefer YYYY-MM-DD'),
        endDate: z
          .string()
          .trim()
          .optional()
          .describe('Optional range end date, prefer YYYY-MM-DD'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .default(500)
          .describe('Maximum number of rows to return'),
        order: z
          .enum(['asc', 'desc'])
          .default('asc')
          .describe('Sort order for returned rows. Use asc for charting.')
      },
      annotations: readOnlyAnnotations()
    },
    async ({ ticker, startDate, endDate, limit, order }) => {
      await store.ensureLoaded();
      const payload = store.getTechnicalChartData({
        ticker,
        startDate,
        endDate,
        limit,
        order
      });

      if (payload.returned === 0) {
        throw new Error(
          startDate || endDate
            ? `No chart data found for ${ticker.toUpperCase()} in the requested range`
            : `No chart data found for ${ticker.toUpperCase()}`
        );
      }

      return jsonText(payload);
    }
  );

  server.registerTool(
    'list_tickers',
    {
      title: 'List tickers',
      description: 'List available tickers, optionally filtered by prefix.',
      inputSchema: {
        prefix: z
          .string()
          .trim()
          .max(8)
          .optional()
          .describe('Optional ticker prefix, for example BB'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Maximum number of tickers to return')
      },
      annotations: readOnlyAnnotations()
    },
    async ({ prefix, limit }) => {
      await store.ensureLoaded();
      return jsonText({
        prefix: prefix?.toUpperCase() ?? null,
        tickers: store.listTickers({ prefix, limit })
      });
    }
  );

  server.registerTool(
    'get_market_day_summary',
    {
      title: 'Get market day summary',
      description: 'Get aggregate market summary and top movers for a trading day. If date is omitted, latest date is used.',
      inputSchema: {
        date: z
          .string()
          .trim()
          .optional()
          .describe('Optional trading date, prefer YYYY-MM-DD'),
        topN: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('How many top items to include')
      },
      annotations: readOnlyAnnotations()
    },
    async ({ date, topN }) => {
      await store.ensureLoaded();
      const summary = store.getMarketDaySummary(date, topN);
      if (!summary) {
        throw new Error(date ? `No market data found for ${date}` : 'Dataset is empty');
      }

      return jsonText(summary);
    }
  );

  return server;
}
