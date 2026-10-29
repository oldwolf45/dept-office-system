// 统一返回格式：{ code: 0, data, message }（PRD 14.4.10）
// code 非 0 为业务错误；404、异常也走同一格式。

export function ok(res, data = null, message = '') {
  return res.json({ code: 0, data, message });
}

export function fail(res, code = 1, message = '业务错误', httpStatus = 200, data = null) {
  return res.status(httpStatus).json({ code, data, message });
}

// 404 统一格式
export function notFound(req, res) {
  return fail(res, 4040, `接口不存在: ${req.method} ${req.originalUrl}`, 404);
}

// 全局错误处理
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('[error]', err);
  }
  const code = status >= 500 ? 5000 : status;
  return fail(res, code, err.message || '服务器内部错误', status);
}
