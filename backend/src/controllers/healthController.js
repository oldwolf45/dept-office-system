import { ok } from '../middleware/response.js';

export function health(req, res) {
  return ok(res, {
    status: 'ok',
    service: 'legacy-office-backend',
    time: new Date().toISOString()
  });
}
