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
      title: 'IDX EOD History API',
      version: '1.0.0',
      description:
        'Read-only API for retrieving full raw IDX end-of-day history for a ticker, either across the full available range or for a custom date range.'
    },
    servers: [
      {
        url: baseUrl
      }
    ],
    security: [
      {
        ApiKeyAuth: []
      }
    ],
    paths: {
      '/api/screener/max': {
        get: {
          operationId: 'getScreenerMaxResults',
          summary: 'Get cached screner MAX screening results',
          description:
            'Returns cached screner MAX stock screening results generated from the latest max-screener CSV export. Use this endpoint from Custom GPT Actions to find ranked IDX technical signals.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional single ticker or comma-separated tickers, for example BBCA or BBCA,BRPT.'
            },
            {
              name: 'tickers',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional comma-separated ticker watchlist. Alias for ticker when multiple values are used.'
            },
            {
              name: 'filter',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['all', 'signals', 'reversal', 'momentum', 'breakout', 'passive', 'risk'],
                default: 'all'
              },
              description: 'Optional signal group filter. signals returns currently active trading signals.'
            },
            {
              name: 'signal',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional exact signal filter, for example SMART SNIPER, SMART GAMMA, G ACC, or BETA BREAKOUT.'
            },
            {
              name: 'regime',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional RISEN regime filter, for example EXPLOSIVE BULL.'
            },
            {
              name: 'quadrant',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['LEADING', 'IMPROVING', 'WEAKENING', 'LAGGING', 'N/A']
              },
              description: 'Optional relative-strength quadrant filter.'
            },
            {
              name: 'minScore',
              in: 'query',
              required: false,
              schema: { type: 'number' },
              description: 'Optional minimum screener score.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 50, minimum: 1, maximum: 1000 },
              description: 'Maximum records to return.'
            },
            {
              name: 'sort',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['score_desc', 'score_asc', 'change_desc', 'change_asc', 'ticker_asc'],
                default: 'score_desc'
              },
              description: 'Sort order for returned records.'
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['json', 'csv', 'file_url'],
                default: 'json'
              },
              description: 'Response format. json is recommended for Custom GPT; file_url returns a CSV URL.'
            }
          ],
          responses: {
            '200': {
              description: 'Cached screner MAX results.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/ScreenerMaxResponse' },
                      { $ref: '#/components/schemas/ScreenerMaxFileResponse' }
                    ]
                  }
                },
                'text/csv': {
                  schema: { type: 'string' }
                }
              }
            }
          }
        }
      },
      '/api/eod/history': {
        get: {
          operationId: 'getEodHistory',
          summary: 'Get full raw EOD history',
          description:
            'Returns raw EOD history for one ticker. Default format=file_url returns a CSV file URL. Use format=json or format=csv for inline data.',
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
              description: 'Optional custom start date in YYYY-MM-DD format.'
            },
            {
              name: 'endDate',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                format: 'date'
              },
              description: 'Optional custom end date in YYYY-MM-DD format.'
            },
            {
              name: 'order',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['asc', 'desc'],
                default: 'asc'
              },
              description: 'Sort order for returned rows. Default is asc.'
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['file_url', 'json', 'csv'],
                default: 'file_url'
              },
              description: 'Response format. file_url returns a downloadable CSV file URL in openaiFileResponse.'
            }
          ],
          responses: {
            '200': {
              description: 'Raw EOD history.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        $ref: '#/components/schemas/EodHistoryResponse'
                      },
                      {
                        $ref: '#/components/schemas/EodHistoryFileResponse'
                      }
                    ]
                  }
                },
                'text/csv': {
                  schema: {
                    type: 'string'
                  }
                }
              }
            }
          }
        }
      },
      '/api/eod/ihsg': {
        get: {
          operationId: 'getIhsgHistory',
          summary: 'Get raw IHSG EOD history',
          description:
            'Returns raw IHSG index EOD history. Default format=file_url returns a CSV file URL. Use optional dates for a custom range.',
          parameters: [
            {
              name: 'startDate',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                format: 'date'
              },
              description: 'Optional custom start date in YYYY-MM-DD format.'
            },
            {
              name: 'endDate',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                format: 'date'
              },
              description: 'Optional custom end date in YYYY-MM-DD format.'
            },
            {
              name: 'order',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['asc', 'desc'],
                default: 'asc'
              },
              description: 'Sort order for returned rows. Default is asc.'
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['file_url', 'json', 'csv'],
                default: 'file_url'
              },
              description: 'Response format. file_url returns a downloadable CSV file URL in openaiFileResponse.'
            }
          ],
          responses: {
            '200': {
              description: 'Raw IHSG EOD history.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      {
                        $ref: '#/components/schemas/EodHistoryResponse'
                      },
                      {
                        $ref: '#/components/schemas/EodHistoryFileResponse'
                      }
                    ]
                  }
                },
                'text/csv': {
                  schema: {
                    type: 'string'
                  }
                }
              }
            }
          }
        }
      },
      '/api/ownership/holders': {
        get: {
          operationId: 'getOwnershipHolders',
          summary: 'Get ownership holders',
          description:
            'Returns shareholder ownership rows for a ticker and period. Default format=file_url returns a CSV URL.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Stock ticker, for example PGAS.'
            },
            {
              name: 'period',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional period YYYY-MM. Defaults to latest holder snapshot.'
            },
            {
              name: 'investorType',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional investor type filter, for example CP, IS, ID, MF, SC.'
            },
            {
              name: 'localForeign',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['L', 'F', 'LOCAL', 'FOREIGN'] },
              description: 'Optional local or foreign filter.'
            },
            {
              name: 'minPercentage',
              in: 'query',
              required: false,
              schema: { type: 'number' },
              description: 'Optional minimum ownership percentage.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 50, minimum: 1, maximum: 1000 },
              description: 'Maximum rows to return.'
            },
            {
              name: 'sort',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['percentage_desc', 'shares_desc', 'name_asc'],
                default: 'percentage_desc'
              },
              description: 'Sort order.'
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['file_url', 'json', 'csv'],
                default: 'file_url'
              },
              description: 'Response format. file_url returns a downloadable CSV URL.'
            }
          ],
          responses: {
            '200': {
              description: 'Ownership holder rows.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/OwnershipHoldersResponse' },
                      { $ref: '#/components/schemas/OwnershipFileResponse' }
                    ]
                  }
                },
                'text/csv': {
                  schema: { type: 'string' }
                }
              }
            }
          }
        }
      },
      '/api/ownership/history': {
        get: {
          operationId: 'getOwnershipHistory',
          summary: 'Get ownership history',
          description:
            'Returns monthly local and foreign ownership history for a ticker. Default format=file_url returns CSV.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Stock ticker, for example PGAS.'
            },
            {
              name: 'startDate',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional start date or period, for example 2026-02 or 2026-02-01.'
            },
            {
              name: 'endDate',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional end date or period, for example 2026-03 or 2026-03-31.'
            },
            {
              name: 'order',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['asc', 'desc'],
                default: 'asc'
              },
              description: 'Sort order.'
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['file_url', 'json', 'csv'],
                default: 'file_url'
              },
              description: 'Response format. file_url returns a downloadable CSV URL.'
            }
          ],
          responses: {
            '200': {
              description: 'Monthly ownership history.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/OwnershipHistoryResponse' },
                      { $ref: '#/components/schemas/OwnershipFileResponse' }
                    ]
                  }
                },
                'text/csv': {
                  schema: { type: 'string' }
                }
              }
            }
          }
        }
      },
      '/api/ownership/compare': {
        get: {
          operationId: 'compareOwnership',
          summary: 'Compare ownership metric',
          description:
            'Compares one ownership metric between two dates or monthly periods for a ticker.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Stock ticker, for example PGAS.'
            },
            {
              name: 'from',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Start date or period, for example 2026-02.'
            },
            {
              name: 'to',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'End date or period, for example 2026-03.'
            },
            {
              name: 'metric',
              in: 'query',
              required: false,
              schema: { type: 'string', default: 'local_total' },
              description: 'Metric such as local_total, foreign_total, or price.'
            }
          ],
          responses: {
            '200': {
              description: 'Ownership metric comparison.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OwnershipCompareResponse' }
                }
              }
            }
          }
        }
      },
      '/api/ownership/investor-holdings': {
        get: {
          operationId: 'getOwnershipInvestorHoldings',
          summary: 'Get holder stock list',
          description:
            'Returns stocks held by one ownership holder in a period. Example holder=PANIN.',
          parameters: [
            {
              name: 'holder',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Holder or investor name search text.'
            },
            {
              name: 'period',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Period YYYY-MM. Defaults to latest snapshot.'
            },
            {
              name: 'ticker',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional ticker filter.'
            },
            {
              name: 'minPercentage',
              in: 'query',
              required: false,
              schema: { type: 'number' },
              description: 'Optional minimum ownership percentage.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 100, minimum: 1, maximum: 2000 },
              description: 'Maximum rows.'
            },
            {
              name: 'sort',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['percentage_desc', 'shares_desc', 'ticker_asc'],
                default: 'percentage_desc'
              },
              description: 'Sort order.'
            }
          ],
          responses: {
            '200': {
              description: 'Holder stock list.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OwnershipInvestorHoldingsResponse' }
                }
              }
            }
          }
        }
      },
      '/api/ownership/holder-compare': {
        get: {
          operationId: 'compareOwnershipHolder',
          summary: 'Compare holder in a stock',
          description:
            'Compares one holder in one ticker between two periods. Use for accumulation or distribution.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Stock ticker, for example PGAS.'
            },
            {
              name: 'holder',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Holder search text, for example PANIN.'
            },
            {
              name: 'from',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Start period YYYY-MM. Defaults to previous snapshot.'
            },
            {
              name: 'to',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'End period YYYY-MM. Defaults to latest snapshot.'
            }
          ],
          responses: {
            '200': {
              description: 'Holder comparison.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OwnershipHolderCompareResponse' }
                }
              }
            }
          }
        }
      },
      '/api/ownership/investor-compare': {
        get: {
          operationId: 'compareOwnershipInvestor',
          summary: 'Compare holder portfolio',
          description:
            'Compares all stocks held by one holder between two periods.',
          parameters: [
            {
              name: 'holder',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: 'Holder search text, for example PANIN.'
            },
            {
              name: 'from',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Start period YYYY-MM. Defaults to previous snapshot.'
            },
            {
              name: 'to',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'End period YYYY-MM. Defaults to latest snapshot.'
            },
            {
              name: 'ticker',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Optional ticker filter.'
            },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                enum: ['new', 'removed', 'increased', 'decreased', 'scripless_shift', 'script_shift', 'rebalanced', 'unchanged']
              },
              description: 'Optional change status filter.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 100, minimum: 1, maximum: 1000 },
              description: 'Maximum rows.'
            }
          ],
          responses: {
            '200': {
              description: 'Holder portfolio comparison.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OwnershipInvestorCompareResponse' }
                }
              }
            }
          }
        }
      },
      '/api/ownership/network': {
        get: {
          operationId: 'getOwnershipNetwork',
          summary: 'Get ownership network',
          description:
            'Returns nodes and links for stock-to-holder or holder-to-stock ownership network.',
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Ticker root, for example PGAS.'
            },
            {
              name: 'holder',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Holder root if ticker is not provided.'
            },
            {
              name: 'period',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Period YYYY-MM. Defaults to latest snapshot.'
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
              description: 'Primary node limit.'
            },
            {
              name: 'neighborLimit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 5, minimum: 0, maximum: 25 },
              description: 'Neighbor node limit per primary node.'
            }
          ],
          responses: {
            '200': {
              description: 'Ownership graph nodes and links.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OwnershipNetworkResponse' }
                }
              }
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API key',
          description: 'Bearer API key for protected data endpoints. In Custom GPT Actions, set Authentication to API Key and Auth Type to Bearer.'
        }
      },
      schemas: {
        ScreenerMaxRecord: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ticker: { type: 'string' },
            date: { type: 'string', format: 'date' },
            historyBars: { type: ['integer', 'null'] },
            historyQuality: { type: ['string', 'null'] },
            price: { type: ['number', 'null'] },
            changePct: { type: ['number', 'null'] },
            signal: { type: ['string', 'null'] },
            activeSignals: { type: ['string', 'null'] },
            signalGroup: {
              type: 'string',
              enum: ['reversal', 'momentum', 'breakout', 'passive', 'risk']
            },
            activeSignal: { type: 'boolean' },
            sniperLocation: { type: ['string', 'null'] },
            lastActiveSignals: { type: ['string', 'null'] },
            lastActiveDate: { type: ['string', 'null'], format: 'date' },
            lastSniperLocation: { type: ['string', 'null'] },
            regime: { type: ['string', 'null'] },
            quadrant: { type: ['string', 'null'] },
            rvol: { type: ['number', 'null'] },
            ageDays: { type: ['number', 'null'] },
            score: { type: ['number', 'null'] },
            strategy: { type: ['string', 'null'] },
            portfolioCapital: { type: ['number', 'null'] },
            buy1: { type: ['number', 'null'] },
            buy2: { type: ['number', 'null'] },
            buy3: { type: ['number', 'null'] },
            buy4: { type: ['number', 'null'] },
            lot1: { type: ['number', 'null'] },
            lot2: { type: ['number', 'null'] },
            lot3: { type: ['number', 'null'] },
            lot4: { type: ['number', 'null'] },
            totalLots: { type: ['number', 'null'] },
            totalDeployed: { type: ['number', 'null'] },
            cashLeft: { type: ['number', 'null'] },
            avgEntry: { type: ['number', 'null'] },
            riskPct: { type: ['number', 'null'] },
            riskBuy1Pct: { type: ['number', 'null'] },
            riskAvgPct: { type: ['number', 'null'] },
            rewardRisk: { type: ['number', 'null'] },
            rewardRiskBuy1: { type: ['number', 'null'] },
            rewardRiskAvg: { type: ['number', 'null'] }
          },
          required: ['ticker', 'date', 'signalGroup', 'activeSignal']
        },
        ScreenerMaxQuery: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ticker: { type: ['string', 'null'] },
            tickers: { type: ['string', 'null'] },
            filter: { type: 'string' },
            signal: { type: ['string', 'null'] },
            regime: { type: ['string', 'null'] },
            quadrant: { type: ['string', 'null'] },
            minScore: { type: ['number', 'null'] },
            limit: { type: 'integer' },
            sort: { type: 'string' }
          }
        },
        ScreenerMaxResponse: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            sourceFile: { type: 'string' },
            snapshotDate: { type: ['string', 'null'], format: 'date' },
            latestEodDate: { type: ['string', 'null'], format: 'date' },
            isStale: { type: 'boolean' },
            staleReason: { type: ['string', 'null'] },
            generatedAt: { type: 'string', format: 'date-time' },
            totalRecords: { type: 'integer' },
            totalMatches: { type: 'integer' },
            returned: { type: 'integer' },
            query: { $ref: '#/components/schemas/ScreenerMaxQuery' },
            records: {
              type: 'array',
              items: { $ref: '#/components/schemas/ScreenerMaxRecord' }
            }
          },
          required: ['name', 'sourceFile', 'snapshotDate', 'latestEodDate', 'isStale', 'staleReason', 'generatedAt', 'totalRecords', 'totalMatches', 'returned', 'query', 'records']
        },
        ScreenerMaxFileResponse: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            sourceFile: { type: 'string' },
            snapshotDate: { type: ['string', 'null'], format: 'date' },
            latestEodDate: { type: ['string', 'null'], format: 'date' },
            isStale: { type: 'boolean' },
            staleReason: { type: ['string', 'null'] },
            generatedAt: { type: 'string', format: 'date-time' },
            totalMatches: { type: 'integer' },
            returned: { type: 'integer' },
            downloadUrl: { type: 'string', format: 'uri' },
            openaiFileResponse: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uri'
              }
            }
          },
          required: ['name', 'sourceFile', 'snapshotDate', 'latestEodDate', 'isStale', 'staleReason', 'generatedAt', 'totalMatches', 'returned', 'downloadUrl', 'openaiFileResponse']
        },
        OwnershipHolderRecord: {
          type: 'object',
          additionalProperties: true,
          properties: {
            date: { type: 'string', format: 'date' },
            period: { type: 'string' },
            ticker: { type: 'string' },
            issuer_name: { type: 'string' },
            investor_name: { type: 'string' },
            investor_type: { type: 'string' },
            holder_name: { type: 'string' },
            investor_key: { type: 'string' },
            type_code: { type: 'string' },
            local_foreign: { type: 'string' },
            origin: { type: 'string' },
            nationality: { type: 'string' },
            country: { type: 'string' },
            domicile: { type: 'string' },
            jurisdiction: { type: 'string' },
            holdings_scripless: { type: ['number', 'null'] },
            holdings_scrip: { type: ['number', 'null'] },
            total_holding_shares: { type: ['number', 'null'] },
            percentage: { type: ['number', 'null'] },
            scripless_volume: { type: ['number', 'null'] },
            script_volume: { type: ['number', 'null'] },
            volume: { type: ['number', 'null'] },
            ownership_pct: { type: ['number', 'null'] }
          }
        },
        OwnershipHolderMatch: {
          type: 'object',
          additionalProperties: true,
          properties: {
            investor_name: { type: 'string' },
            investor_key: { type: 'string' },
            investor_type: { type: 'string' },
            origin: { type: 'string' },
            country: { type: 'string' },
            domicile: { type: 'string' }
          }
        },
        OwnershipHistoryRecord: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ticker: { type: 'string' },
            date: { type: 'string', format: 'date' },
            price: { type: ['number', 'null'] },
            local_total: { type: ['number', 'null'] },
            foreign_total: { type: ['number', 'null'] }
          }
        },
        OwnershipHoldersResponse: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
            period: { type: ['string', 'null'] },
            date: { type: ['string', 'null'], format: 'date' },
            returned: { type: 'integer' },
            records: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipHolderRecord' }
            }
          },
          required: ['ticker', 'period', 'date', 'returned', 'records']
        },
        OwnershipHistoryResponse: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
            startDate: { type: ['string', 'null'], format: 'date' },
            endDate: { type: ['string', 'null'], format: 'date' },
            returned: { type: 'integer' },
            records: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipHistoryRecord' }
            }
          },
          required: ['ticker', 'startDate', 'endDate', 'returned', 'records']
        },
        OwnershipCompareResponse: {
          type: 'object',
          additionalProperties: true,
          properties: {
            ticker: { type: 'string' },
            metric: { type: 'string' },
            from: { type: 'string', format: 'date' },
            to: { type: 'string', format: 'date' },
            before: { type: ['number', 'null'] },
            after: { type: ['number', 'null'] },
            diff: { type: ['number', 'null'] },
            changePercent: { type: ['number', 'null'] }
          },
          required: ['ticker', 'metric', 'from', 'to', 'before', 'after', 'diff', 'changePercent']
        },
        OwnershipInvestorHoldingsResponse: {
          type: 'object',
          properties: {
            holderQuery: { type: 'string' },
            period: { type: ['string', 'null'] },
            date: { type: ['string', 'null'], format: 'date' },
            returned: { type: 'integer' },
            holderMatches: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipHolderMatch' }
            },
            records: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipHolderRecord' }
            }
          },
          required: ['holderQuery', 'period', 'date', 'returned', 'holderMatches', 'records']
        },
        OwnershipHolderComparisonFields: {
          type: 'object',
          additionalProperties: true,
          properties: {
            status: {
              type: 'string',
              enum: ['new', 'removed', 'increased', 'decreased', 'scripless_shift', 'script_shift', 'rebalanced', 'unchanged']
            },
            previous_volume: { type: 'number' },
            current_volume: { type: 'number' },
            volume_delta: { type: 'number' },
            volume_change_percent: { type: ['number', 'null'] },
            previous_pct: { type: 'number' },
            current_pct: { type: 'number' },
            pct_delta: { type: 'number' },
            previous_scripless: { type: 'number' },
            current_scripless: { type: 'number' },
            scripless_delta: { type: 'number' },
            previous_script: { type: 'number' },
            current_script: { type: 'number' },
            script_delta: { type: 'number' }
          }
        },
        OwnershipHolderCompareResponse: {
          allOf: [
            { $ref: '#/components/schemas/OwnershipHolderComparisonFields' },
            {
              type: 'object',
              properties: {
                ticker: { type: 'string' },
                holderQuery: { type: 'string' },
                holder: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
                previousRecord: {
                  oneOf: [
                    { $ref: '#/components/schemas/OwnershipHolderRecord' },
                    { type: 'null' }
                  ]
                },
                currentRecord: {
                  oneOf: [
                    { $ref: '#/components/schemas/OwnershipHolderRecord' },
                    { type: 'null' }
                  ]
                }
              },
              required: ['ticker', 'holderQuery', 'holder', 'from', 'to', 'previousRecord', 'currentRecord']
            }
          ]
        },
        OwnershipInvestorCompareRecord: {
          allOf: [
            { $ref: '#/components/schemas/OwnershipHolderComparisonFields' },
            {
              type: 'object',
              properties: {
                ticker: { type: 'string' },
                issuer_name: { type: 'string' },
                holder: { type: 'string' },
                previousRecord: {
                  oneOf: [
                    { $ref: '#/components/schemas/OwnershipHolderRecord' },
                    { type: 'null' }
                  ]
                },
                currentRecord: {
                  oneOf: [
                    { $ref: '#/components/schemas/OwnershipHolderRecord' },
                    { type: 'null' }
                  ]
                }
              },
              required: ['ticker', 'issuer_name', 'holder', 'previousRecord', 'currentRecord']
            }
          ]
        },
        OwnershipInvestorCompareResponse: {
          type: 'object',
          properties: {
            holderQuery: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            returned: { type: 'integer' },
            totalMatches: { type: 'integer' },
            holderMatches: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipHolderMatch' }
            },
            records: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipInvestorCompareRecord' }
            }
          },
          required: ['holderQuery', 'from', 'to', 'returned', 'totalMatches', 'holderMatches', 'records']
        },
        OwnershipNetworkNode: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            label: { type: 'string' },
            ticker: { type: 'string' },
            issuer_name: { type: 'string' },
            investor_name: { type: 'string' },
            investor_type: { type: 'string' },
            origin: { type: 'string' },
            country: { type: 'string' },
            domicile: { type: 'string' },
            holderMatches: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipHolderMatch' }
            },
            root: { type: 'boolean' }
          }
        },
        OwnershipNetworkLink: {
          type: 'object',
          additionalProperties: true,
          properties: {
            source: { type: 'string' },
            target: { type: 'string' },
            relation: { type: 'string' },
            volume: { type: ['number', 'null'] },
            percentage: { type: ['number', 'null'] }
          }
        },
        OwnershipNetworkResponse: {
          type: 'object',
          additionalProperties: true,
          properties: {
            mode: { type: ['string', 'null'], enum: ['stock', 'holder', null] },
            period: { type: ['string', 'null'] },
            ticker: { type: 'string' },
            holderQuery: { type: 'string' },
            holder: { type: 'string' },
            returnedHolders: { type: 'integer' },
            returnedHoldings: { type: 'integer' },
            holderMatches: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipHolderMatch' }
            },
            nodes: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipNetworkNode' }
            },
            links: {
              type: 'array',
              items: { $ref: '#/components/schemas/OwnershipNetworkLink' }
            }
          },
          required: ['mode', 'period', 'nodes', 'links']
        },
        OwnershipFileResponse: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
            returned: { type: 'integer' },
            downloadUrl: { type: 'string', format: 'uri' },
            openaiFileResponse: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uri'
              }
            }
          },
          required: ['ticker', 'returned', 'downloadUrl', 'openaiFileResponse']
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
            latestAvailableDate: { type: ['string', 'null'], format: 'date' },
            returned: { type: 'integer' },
            records: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/EodRecord'
              }
            }
          },
          required: ['ticker', 'startDate', 'endDate', 'latestAvailableDate', 'returned', 'records']
        },
        EodHistoryFileResponse: {
          type: 'object',
          properties: {
            ticker: { type: 'string' },
            startDate: { type: ['string', 'null'], format: 'date' },
            endDate: { type: ['string', 'null'], format: 'date' },
            latestAvailableDate: { type: ['string', 'null'], format: 'date' },
            returned: { type: 'integer' },
            downloadUrl: { type: 'string', format: 'uri' },
            openaiFileResponse: {
              type: 'array',
              items: {
                type: 'string',
                format: 'uri'
              }
            }
          },
          required: [
            'ticker',
            'startDate',
            'endDate',
            'latestAvailableDate',
            'returned',
            'downloadUrl',
            'openaiFileResponse'
          ]
        }
      }
    }
  };
}
