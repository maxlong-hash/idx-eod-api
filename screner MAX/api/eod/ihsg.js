import { proxyEodRequest } from '../../server/eodProxy.js';

export default async function handler(request, response) {
  await proxyEodRequest(request, response, '/api/eod/ihsg');
}
