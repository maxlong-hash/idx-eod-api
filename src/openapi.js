export function getRequestBaseUrl(request, configuredPublicBaseUrl = null) {
  if (configuredPublicBaseUrl) {
    return configuredPublicBaseUrl.replace(/\/+$/, '');
  }

  const forwardedProto = request.get?.('x-forwarded-proto');
  const protocol = forwardedProto ?? request.protocol ?? 'http';
  const host = request.get?.('host') ?? request.headers?.host ?? '127.0.0.1:3000';

  return `${protocol}://${host}`;
}

export function buildOpenApiSchema(baseUrl) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'IDX EOD Data API',
      version: '1.0.0',
      description:
        'Read-only API for querying IDX end-of-day stock data. Designed for ChatGPT Custom GPT Actions and other API clients.'
    },
    servers: [
      {
        url: baseUrl
      }
    ],
    paths: {
      '/api/eod/latest-date': {
        get: {
          operationId: 'getLatestAvailableDate',
          summary: 'Get latest available EOD date',
          description: 'Returns the latest available trading date globally or for a specific ticker.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: false,
              schema: {
                type: 'string'
              },
              description: 'Optional stock ticker, for example BBCA.'
            }
          ],
          responses: {
            '200': {
              description: 'Latest available date.',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/LatestDateResponse'
                  }
                }
              }
            }
          }
        }
      },
      '/api/eod/record': {
        get: {
          operationId: 'getEodRecord',
          summary: 'Get one EOD record',
          description: 'Returns a single EOD row for a ticker and date. If date is omitted, the latest row is returned.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: true,
              schema: {
                type: 'string'
              },
              description: 'Stock ticker, for example BBCA.'
            },
            {
              name: 'date',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                format: 'date'
              },
              description: 'Optional date in YYYY-MM-DD format.'
            }
          ],
          responses: {
            '200': {
              description: 'One EOD record.',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/EodRecord'
                  }
                }
              }
            }
          }
        }
      },
      '/api/eod/history': {
        get: {
          operationId: 'getEodHistory',
          summary: 'Get EOD history',
          description: 'Returns historical EOD rows for a ticker within an optional date range.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: true,
              schema: {
                type: 'string'
              },
              description: 'Stock ticker, for example BBCA.'
            },
            {
              name: 'startDate',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                format: 'date'
              },
              description: 'Optional start date in YYYY-MM-DD format.'
            },
            {
              name: 'endDate',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                format: 'date'
              },
              description: 'Optional end date in YYYY-MM-DD format.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: 500,
                default: 30
              },
              description: 'Maximum rows to return.'
            },
            {
              name: 'order',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['asc', 'desc'],
                default: 'desc'
              },
              description: 'Sort order.'
            }
          ],
          responses: {
            '200': {
              description: 'Historical EOD rows.',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/EodHistoryResponse'
                  }
                }
              }
            }
          }
        }
      },
      '/api/eod/tickers': {
        get: {
          operationId: 'listTickers',
          summary: 'List available tickers',
          description: 'Lists available tickers, optionally filtered by prefix.',
          parameters: [
            {
              name: 'prefix',
              in: 'query',
              required: false,
              schema: {
                type: 'string'
              },
              description: 'Optional prefix, for example BB.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: 500,
                default: 50
              },
              description: 'Maximum tickers to return.'
            }
          ],
          responses: {
            '200': {
              description: 'Available tickers.',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/TickersResponse'
                  }
                }
              }
            }
          }
        }
      },
      '/api/eod/market-summary': {
        get: {
          operationId: 'getMarketDaySummary',
          summary: 'Get market day summary',
          description: 'Returns market-wide summary and top movers for a trading date. If date is omitted, latest date is used.',
          parameters: [
            {
              name: 'date',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                format: 'date'
              },
              description: 'Optional trading date in YYYY-MM-DD format.'
            },
            {
              name: 'topN',
              in: 'query',
              required: false,
              schema: {
                type: 'integer',
                minimum: 1,
                maximum: 50,
                default: 10
              },
              description: 'How many top items to include.'
            }
          ],
          responses: {
            '200': {
              description: 'Market summary.',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/MarketSummary'
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        LatestDateResponse: {
          type: 'object',
          properties: {
            ticker: {
              type: ['string', 'null']
            },
            latestDate: {
              type: 'string',
              format: 'date'
            }
          },
          required: ['ticker', 'latestDate']
        },
        EodRecord: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            ticker: { type: 'string' },
            date: { type: 'string', format: 'date' },
            open: { type: ['number', 'null'] },
            high: { type: ['number', 'null'] },
            low: { type: ['number', 'null'] },
            close: { type: ['number', 'null'] },
            volume: { type: ['number', 'null'] },
            tradeFrequency: { type: ['number', 'null'] },
            tradeValue: { type: ['number', 'null'] },
            nbsa: { type: ['number', 'null'] },
            previousClose: { type: ['number', 'null'] },
            change: { type: ['number', 'null'] },
            changePercent: { type: ['number', 'null'] },
            documentUrl: { type: 'string' }
          },
          required: [
            'id',
            'ticker',
            'date',
            'open',
            'high',
            'low',
            'close',
            'volume',
            'tradeFrequency',
            'tradeValue',
            'nbsa',
            'previousClose',
            'change',
            'changePercent',
            'documentUrl'
          ]
        },
        EodHistoryResponse: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
            startDate: { type: ['string', 'null'], format: 'date' },
            endDate: { type: ['string', 'null'], format: 'date' },
            returned: { type: 'integer' },
            records: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/EodRecord'
              }
            }
          },
          required: ['ticker', 'startDate', 'endDate', 'returned', 'records']
        },
        TickerItem: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
            latestDate: { type: ['string', 'null'], format: 'date' },
            latestClose: { type: ['number', 'null'] }
          },
          required: ['ticker', 'latestDate', 'latestClose']
        },
        TickersResponse: {
          type: 'object',
          properties: {
            prefix: { type: ['string', 'null'] },
            tickers: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/TickerItem'
              }
            }
          },
          required: ['prefix', 'tickers']
        },
        MarketSummary: {
          type: 'object',
          properties: {
            date: { type: 'string', format: 'date' },
            totalTickers: { type: 'integer' },
            totalVolume: { type: 'number' },
            totalTradeValue: { type: 'number' },
            gainers: { type: 'integer' },
            losers: { type: 'integer' },
            unchanged: { type: 'integer' },
            topByTradeValue: {
              type: 'array',
              items: { $ref: '#/components/schemas/EodRecord' }
            },
            topByVolume: {
              type: 'array',
              items: { $ref: '#/components/schemas/EodRecord' }
            },
            topGainers: {
              type: 'array',
              items: { $ref: '#/components/schemas/EodRecord' }
            },
            topLosers: {
              type: 'array',
              items: { $ref: '#/components/schemas/EodRecord' }
            }
          },
          required: [
            'date',
            'totalTickers',
            'totalVolume',
            'totalTradeValue',
            'gainers',
            'losers',
            'unchanged',
            'topByTradeValue',
            'topByVolume',
            'topGainers',
            'topLosers'
          ]
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          },
          required: ['error']
        }
      }
    }
  };
}
