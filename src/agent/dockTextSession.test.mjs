import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createDockTextSession } from './dockTextSession.js';
import { createRealtimeSession } from '../voice/realtimeSession.js';

const chosen = {
  provider: 'chatgpt',
  model: 'authorized-model',
  binding: 'account-A',
};
const reply = (content) =>
  Response.json({ message: { role: 'assistant', content } });
function fixture(overrides = {}) {
  const events = [];
  const requests = [];
  const lifetime = new AbortController();
  const chat = createDockTextSession({
    emit: (event) => events.push(event),
    runAction: async () => ({ ok: true }),
    signal: lifetime.signal,
    getSelection: () => chosen,
    fetchImpl: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return reply('Done');
    },
    ...overrides,
  });
  return { chat, events, requests, lifetime };
}

test('dock uses the bound ChatGPT endpoint and preserves opaque Responses continuation', async () => {
  const bodies = [];
  const reasoning = [
    { type: 'reasoning', id: 'r1', encrypted_content: 'opaque', summary: [] },
  ];
  let actions = 0;
  const f = fixture({
    runAction: async () => {
      actions++;
      return { ok: true };
    },
    fetchImpl: async (url, init) => {
      assert.equal(url, '/api/agent/command');
      const body = JSON.parse(init.body);
      bodies.push(body);
      assert.equal(body.provider, 'chatgpt');
      assert.equal(body.binding, 'account-A');
      assert.equal(body.model, chosen.model);
      if (bodies.length === 1)
        return Response.json({
          message: {
            role: 'assistant',
            content: '',
            response_reasoning: reasoning,
            tool_calls: [
              {
                id: 'call1',
                type: 'function',
                function: { name: 'fly_to', arguments: '{"location":"Tokyo"}' },
              },
            ],
          },
          toolCalls: [
            { id: 'call1', name: 'fly_to', args: { location: 'Tokyo' } },
          ],
        });
      assert.deepEqual(body.messages[1].response_reasoning, reasoning);
      assert.equal(body.messages[2].tool_call_id, 'call1');
      return reply('Tokyo');
    },
  });
  assert.equal(f.chat.start(), true);
  assert.equal(f.chat.sendText('Fly to Tokyo'), true);
  await tick();
  assert.equal(actions, 1);
  assert.equal(bodies.length, 2);
  assert.equal(f.chat.sendText('Now zoom out'), true);
  await tick();
  assert.equal(bodies[2].messages[0].content, 'Fly to Tokyo');
  assert.equal(bodies[2].messages.at(-1).content, 'Now zoom out');
  assert.equal(f.events.filter((e) => e.type === 'completion').length, 2);
});

test('no implicit provider, account or model fallback', () => {
  for (const selection of [
    null,
    {},
    { ...chosen, binding: '' },
    { ...chosen, model: '' },
    { ...chosen, provider: 'openai' },
  ]) {
    const f = fixture({ getSelection: () => selection });
    assert.equal(f.chat.start(), false);
    assert.equal(f.chat.sendText('hello'), false);
    assert.equal(f.requests.length, 0);
  }
});

test('selection is pinned until explicit stop; a new account gets no old history', async () => {
  let selection = { ...chosen };
  const f = fixture({ getSelection: () => selection });
  f.chat.start();
  f.chat.sendText('private A');
  await tick();
  selection = { ...chosen, binding: 'account-B' };
  f.chat.sendText('still A');
  await tick();
  assert.equal(f.requests[1].body.binding, 'account-A');
  f.chat.stop();
  f.chat.start();
  f.chat.sendText('private B');
  await tick();
  assert.equal(f.requests[2].body.binding, 'account-B');
  assert.equal(f.requests[2].body.messages.length, 1);
});

test('Stop cancels a reply, retains earlier conversation, and rejects overlapping sends', async () => {
  const bodies = [];
  let count = 0;
  const f = fixture({
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (++count !== 2) return reply('answer');
      return new Promise((_resolve, reject) =>
        init.signal.addEventListener(
          'abort',
          () => reject(init.signal.reason),
          { once: true },
        ),
      );
    },
  });
  f.chat.start();
  f.chat.sendText('first');
  await tick();
  f.chat.sendText('second');
  assert.equal(f.chat.sendText('overlap'), false);
  assert.equal(f.chat.cancelTurn(), true);
  await tick();
  assert.equal(f.events.at(-1).status, 'cancelled');
  assert.equal(f.chat.sendText('third'), true);
  await tick();
  assert.equal(bodies[2].messages[0].content, 'first');
  assert.equal(
    bodies[2].messages.some((m) => m.content === 'answer'),
    true,
  );
});

test('failed reply retains history, lifecycle abort suppresses late completion', async () => {
  let count = 0;
  let finish;
  const f = fixture({
    fetchImpl: async () => {
      if (++count === 1)
        return Response.json({ error: 'account unavailable' }, { status: 503 });
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  f.chat.start();
  f.chat.sendText('remember');
  await tick();
  assert.equal(f.events.at(-1).state, 'error');
  assert.equal(f.chat.sendText('follow up'), true);
  f.lifetime.abort();
  const size = f.events.length;
  finish(reply('late'));
  await tick();
  assert.equal(f.events.length, size);
  assert.equal(f.chat.start(), false);
});

test('Realtime adapter routes text through the injected engine and keeps voice separate', async () => {
  const events = [];
  const requests = [];
  let starts = 0;
  const controller = {
    status: 'idle',
    start: () => {
      starts++;
    },
    stop() {},
    isActive: () => false,
  };
  const adapter = createRealtimeSession({
    emit: (event) => events.push(event),
    runAction: async () => ({ ok: true }),
    createController: () => controller,
    createTextSession: (options) =>
      createDockTextSession({ ...options, getSelection: () => chosen }),
    fetchImpl: async (url) => {
      requests.push(url);
      return reply('hello');
    },
  });
  adapter.start({ textOnly: true });
  assert.deepEqual(adapter.getStartOptions(), {
    pushToTalk: false,
    textOnly: true,
  });
  adapter.sendText('hello');
  await tick();
  assert.deepEqual(requests, ['/api/agent/command']);
  assert.equal(starts, 0);
  assert.equal(
    events.some((e) => e.type === 'transcript' && e.text === 'hello'),
    true,
  );
  adapter.start({ pushToTalk: false });
  assert.equal(starts, 1);
  assert.equal(adapter.getStartOptions().textOnly, undefined);
});
