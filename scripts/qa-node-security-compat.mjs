#!/usr/bin/env node
// Hermetic Node runtime probe: real HTTP/fetch/streams, synthetic credentials.
// No requests reach OpenAI; application handlers and command loop are real.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { checkServerIdentity } from 'node:tls';
import { chatGptJson } from '../server/providers/agent/chatgpt/http.js';
import { readCompletedResponse } from '../server/providers/agent/chatgpt/responses.js';
import { createAgentCommandHandler } from '../server/providers/agent/routes.js';
import { sameSiteGated } from '../server/providers/common/same-site.js';
import { createAgentSession } from '../src/agent/agentLoop.js';

const passed = [];
const controller = new AbortController();
const auth = {
  status: () => ({ configured: true, binding: 'fixture-binding' }),
  assertBinding(binding) {
    assert.equal(binding, 'fixture-binding');
  },
  async lease(binding) {
    this.assertBinding(binding);
    return { token: 'synthetic-token', signal: controller.signal };
  },
};
let rounds = 0;
let base;
const calls = [];
const handler = sameSiteGated(
  createAgentCommandHandler({
    env: {},
    chatgpt: auth,
    limiter: () => null,
    fetchImpl: (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
      // Preserve the real fetch implementation; redirect only the destination.
      return fetch(`${base}/upstream`, init);
    },
  }),
);
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/api/agent/command') return await handler(req, res);
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/json' });
      res.end();
      return;
    }
    if (req.url === '/pending') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"response.created"}\n\n');
      return;
    }
    if (req.url === '/partial') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"type":"response.created"}\n\n');
      return;
    }
    if (req.url === '/upstream') {
      let text = '';
      for await (const chunk of req) text += chunk;
      const body = JSON.parse(text);
      calls.push(body);
      rounds++;
      assert.equal(body.store, false);
      const output =
        rounds === 1
          ? [
              {
                type: 'function_call',
                id: 'fc_fixture',
                call_id: 'call_fixture',
                namespace: 'gev',
                name: 'zoom_to_globe',
                arguments: '{}',
                status: 'completed',
              },
            ]
          : [
              {
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Done.' }],
              },
            ];
      const event = {
        type: 'response.completed',
        response: {
          id: `response_${rounds}`,
          status: 'completed',
          output,
          usage: { input_tokens: 15, output_tokens: 4, total_tokens: 19 },
        },
      };
      const compressed = brotliCompressSync(
        Buffer.from(`data: ${JSON.stringify(event)}\n\n`),
      );
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Content-Encoding': 'br',
      });
      // Force arbitrary compressed wire boundaries through Node's decoder.
      for (let i = 0; i < compressed.length; i += 7)
        res.write(compressed.subarray(i, i + 7));
      res.end();
      return;
    }
    const encoding = req.url === '/br' ? 'br' : 'gzip';
    const bytes = Buffer.from(
      JSON.stringify({ ok: true, label: 'prueba ñ 中文' }),
    );
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Encoding': encoding,
    });
    res.end(encoding === 'br' ? brotliCompressSync(bytes) : gzipSync(bytes));
  } catch {
    res.writeHead(500);
    res.end('fixture failed');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
base = `http://127.0.0.1:${server.address().port}`;
try {
  for (const encoding of ['gzip', 'br']) {
    assert.deepEqual(await chatGptJson(`${base}/${encoding}`), {
      ok: true,
      label: 'prueba ñ 中文',
    });
    passed.push(`real fetch ${encoding} JSON`);
  }
  await assert.rejects(chatGptJson(`${base}/redirect`), /securely/);
  passed.push('redirect refused');
  const session = createAgentSession({
    fetchImpl: (url, init) => fetch(`${base}${url}`, init),
    runAction: async (name, args) => {
      calls.push({ action: name, args });
      return { ok: true };
    },
  });
  const result = await session.send('zoom out', {
    provider: 'chatgpt',
    model: 'account-model',
    binding: 'fixture-binding',
  });
  assert.equal(result.ok, true);
  assert.equal(result.content, 'Done.');
  assert.equal(rounds, 2);
  assert.deepEqual(
    calls.filter((call) => call.action),
    [{ action: 'zoom_to_globe', args: {} }],
  );
  assert.ok(
    calls
      .at(-1)
      .input.some(
        (item) =>
          item.type === 'function_call_output' &&
          item.call_id === 'call_fixture',
      ),
  );
  passed.push(
    'HTTP command → Brotli SSE → validated action → result round trip',
  );
  for (const headers of [
    { Origin: 'https://evil.example' },
    { 'X-Forwarded-For': '127.0.0.1' },
  ]) {
    const denied = await fetch(`${base}/api/agent/command`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    assert.equal(denied.status, 403);
    await denied.text();
  }
  assert.equal(rounds, 2);
  passed.push(
    'real HTTP foreign origin and forwarded requests denied before inference',
  );
  const partial = await fetch(`${base}/partial`);
  await assert.rejects(
    readCompletedResponse(partial, new AbortController().signal),
    /before completion/,
  );
  passed.push('partial stream refused');
  const abort = new AbortController();
  const pending = await fetch(`${base}/pending`, { signal: abort.signal });
  const reading = readCompletedResponse(pending, abort.signal);
  const rejection = assert.rejects(reading);
  abort.abort();
  await rejection;
  passed.push('real fetch stream cancellation');
  assert.equal(
    checkServerIdentity('127.0.0.1', {
      subjectaltname: 'IP Address:127.0.0.1',
    }),
    undefined,
  );
  assert.ok(
    checkServerIdentity('127.0.0.1', { subjectaltname: 'DNS:127.0.0.1' }),
  );
  passed.push('canonical loopback TLS requires an IP SAN');
  console.log(
    JSON.stringify(
      {
        runtime: process.version,
        openssl: process.versions.openssl,
        undici: process.versions.undici,
        passed,
      },
      null,
      2,
    ),
  );
} finally {
  controller.abort();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
