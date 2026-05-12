import { proxyEodRequest } from '../_eodProxy.js';

export default async function handler(request, response) {
  await proxyEodRequest(request, response, '/api/eod/ihsg');
}
