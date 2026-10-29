// MiniMax 统一封装（契约 §2.2）：Key 只读 process.env.MINIMAX_API_KEY，30 秒超时，
// 失败/超时返回错误对象，绝不抛穿。模型名从响应里取；记录 model/duration_ms/tokens。
// 测试通过 __hooks.call 注入假调用，禁止在此写死任何 Key。

const DEFAULT_ENDPOINT = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';
const DEFAULT_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M1';
const TIMEOUT_MS = 30000;

// 仅供测试注入：__hooks.call(messages) => Promise<{ok, content, model, tokens, error}>
export const __hooks = { call: null };

export async function callMiniMax(messages, { timeoutMs = TIMEOUT_MS } = {}) {
  if (typeof __hooks.call === 'function') {
    const t0 = Date.now();
    try {
      const r = await __hooks.call(messages);
      return {
        ok: !!r.ok,
        content: r.content || '',
        model: r.model || 'mock',
        durationMs: r.durationMs ?? (Date.now() - t0),
        tokens: r.tokens ?? null,
        error: r.error || null
      };
    } catch (e) {
      return { ok: false, content: '', model: 'mock', durationMs: Date.now() - t0, tokens: null, error: String(e && e.message || e) };
    }
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return { ok: false, content: '', model: null, durationMs: 0, tokens: null, error: 'MINIMAX_API_KEY 未配置' };
  }

  const endpoint = process.env.MINIMAX_BASE_URL || DEFAULT_ENDPOINT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.MINIMAX_MODEL || DEFAULT_MODEL,
        messages,
        max_tokens: 2048,
        temperature: 0.3
      }),
      signal: controller.signal
    });
    const durationMs = Date.now() - t0;
    const text = await resp.text();
    if (!resp.ok) {
      return { ok: false, content: '', model: null, durationMs, tokens: null, error: `HTTP ${resp.status}: ${text.slice(0, 500)}` };
    }
    let data;
    try { data = JSON.parse(text); } catch {
      return { ok: false, content: '', model: null, durationMs, tokens: null, error: `响应非 JSON: ${text.slice(0, 200)}` };
    }
    const content = data?.choices?.[0]?.message?.content || '';
    if (!content) {
      return { ok: false, content: '', model: data?.model || null, durationMs, tokens: null, error: `响应无正文: ${text.slice(0, 200)}` };
    }
    return {
      ok: true,
      content: String(content).trim(),
      model: data.model || process.env.MINIMAX_MODEL || DEFAULT_MODEL,
      durationMs,
      tokens: data.usage?.total_tokens ?? (data.usage ? data.usage.total_tokens : null),
      error: null
    };
  } catch (e) {
    const durationMs = Date.now() - t0;
    const aborted = e && e.name === 'AbortError';
    return {
      ok: false, content: '', model: null, durationMs, tokens: null,
      error: aborted ? `请求超时（>${timeoutMs}ms）` : String((e && e.message) || e)
    };
  } finally {
    clearTimeout(timer);
  }
}
