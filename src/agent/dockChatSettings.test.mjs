import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import {
  bindDockChatSettings,
  DOCK_CHAT_SELECTION_KEY,
} from './dockChatSettings.js';
import { createTestVoiceUi } from '../testSupport/voiceUi.mjs';
import { mountVoiceView } from '../testSupport/voiceView.mjs';
const flush = async () => {
  for (let i = 0; i < 8; i++) await tick();
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { resolve, promise };
};
function fixture(t, overrides = {}) {
  const ui = createTestVoiceUi({ panel: true, pinia: overrides.pinia });
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key),
    setItem: (key, value) => store.set(key, value),
  };
  let state = {
    configured: true,
    active: 'A',
    binding: 'binding-A',
    accounts: [
      { id: 'A', label: 'alice@example.test', signedIn: true },
      { id: 'B', label: 'bob@example.test', signedIn: true },
    ],
  };
  let adapter;
  let invalidations = 0;
  const events = [];
  const requests = [];
  const commands = [];
  let poll;
  const fetchImpl = async (url, init = {}) => {
    requests.push(url);
    const body = init.body && JSON.parse(init.body);
    if (url.endsWith('/status')) return Response.json(state);
    if (url.includes('/models?'))
      return Response.json({
        binding: state.binding,
        models: [{ id: 'model-1' }, { id: 'model-2' }],
      });
    if (url.endsWith('/select')) {
      state = {
        ...state,
        active: body.account,
        binding: `binding-${body.account}`,
      };
      return Response.json(state);
    }
    if (url.endsWith('/logout')) {
      state = {
        ...state,
        active: null,
        configured: false,
        binding: 'out',
        pending: false,
      };
      return Response.json({ ...state, revoked: true });
    }
    if (url.endsWith('/login'))
      return Response.json({
        path: '/api/agent/chatgpt/authorize?ticket=fixture-ticket',
      });
    if (url.endsWith('/command')) {
      commands.push(body);
      return overrides.command
        ? overrides.command(body, init)
        : Response.json({ message: { role: 'assistant', content: 'Done' } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const settings = bindDockChatSettings({
    ui,
    storage: overrides.storage || storage,
    view: overrides.view || { open: () => null },
    fetchImpl: overrides.fetchImpl || fetchImpl,
    invalidate: () => {
      invalidations++;
      adapter?.stop();
    },
    schedule: (fn) => {
      poll = fn;
      return 1;
    },
    unschedule() {},
  });
  adapter = settings.createTextSession({
    provider: 'openai',
    emit: (event) => events.push(event),
    runAction: async () => ({ ok: true }),
    fetchImpl: overrides.fetchImpl || fetchImpl,
  });
  t.after(() => {
    adapter.stop();
    settings.destroy();
    ui.remove();
  });
  return {
    settings,
    ui,
    adapter,
    events,
    requests,
    commands,
    store,
    storage,
    get invalidations() {
      return invalidations;
    },
    setState(patch) {
      state = { ...state, ...patch };
    },
    poll: () => poll?.(),
    async choose() {
      ui.emit('chat-connection', 'chatgpt');
      await flush();
      ui.emit('chat-model', 'model-1');
    },
  };
}

test('explicit ChatGPT connection and authorized model are required; no API fallback', async (t) => {
  const f = fixture(t);
  assert.equal(await f.adapter.start(), false);
  assert.equal(f.requests.length, 0);
  await f.choose();
  assert.equal(await f.adapter.start(), true);
  f.adapter.sendText('hello');
  await flush();
  assert.equal(f.commands[0].provider, 'chatgpt');
  assert.equal(f.commands[0].binding, 'binding-A');
  f.ui.emit('chat-logout');
  await flush();
  assert.equal(await f.adapter.start(), false);
  assert.equal(f.adapter.sendText('blocked'), false);
  assert.ok(
    f.requests.every(
      (url) => !url.includes('/openai/') && !url.includes('/gemini/'),
    ),
  );
});

test('account switch aborts active request, rejects late answers and separates engine history', async (t) => {
  const late = deferred();
  let signal;
  const f = fixture(t, {
    command: (body, init) => {
      signal = init.signal;
      return late.promise;
    },
  });
  await f.choose();
  await f.adapter.start();
  f.adapter.sendText('A secret');
  await flush();
  f.ui.emit('chat-account', 'B');
  await flush();
  assert.equal(signal.aborted, true);
  assert.equal(f.settings.getSelection(), null); // B must select its own model.
  late.resolve(
    Response.json({ message: { role: 'assistant', content: 'late A secret' } }),
  );
  await flush();
  assert.ok(!f.events.some((event) => event.text === 'late A secret'));
  f.ui.emit('chat-model', 'model-2');
  await f.adapter.start();
  f.adapter.sendText('B message');
  await flush();
  assert.equal(f.commands.at(-1).binding, 'binding-B');
  assert.ok(!JSON.stringify(f.commands.at(-1).messages).includes('A secret'));
});

test('provider switch retires a pending start without using an API key', async (t) => {
  const late = deferred();
  const f = fixture(t, { fetchImpl: () => late.promise });
  f.ui.emit('chat-connection', 'chatgpt');
  const started = f.adapter.start();
  f.ui.emit('chat-connection', 'api');
  late.resolve(
    Response.json({ configured: true, binding: 'stale', active: 'A' }),
  );
  assert.equal(await started, false);
  assert.equal(f.adapter.sendText('must not send'), false);
  assert.equal(f.ui.state.chat.accountSettings.provider, 'api');
  assert.equal(f.ui.state.chat.accountSettings.connected, false);
});

test('external logout or account change invalidates the running session on refresh', async (t) => {
  const f = fixture(t);
  await f.choose();
  await f.adapter.start();
  const count = f.invalidations;
  f.setState({ binding: 'other-tab', active: 'B' });
  await f.settings.refresh();
  assert.equal(f.invalidations, count + 1);
  assert.equal(f.adapter.sendText('old account'), false);
  assert.equal(f.settings.getSelection(), null);
});

test('only model preferences persist; reload revalidates authorization and restores the same account model', async (t) => {
  const f = fixture(t);
  await f.choose();
  const stored = f.store.get(DOCK_CHAT_SELECTION_KEY);
  assert.deepEqual(JSON.parse(stored), {
    provider: 'chatgpt',
    models: { A: 'model-1' },
  });
  assert.ok(!stored.includes('binding-A'));
  const restored = fixture(t, { storage: f.storage });
  await flush();
  assert.deepEqual(restored.settings.getSelection(), {
    provider: 'chatgpt',
    model: 'model-1',
    binding: 'binding-A',
  });
  restored.setState({ configured: false, active: null, binding: 'out' });
  await restored.settings.refresh();
  assert.equal(restored.settings.getSelection(), null);
});

test('model change cancels the conversation and only advertised models can be selected', async (t) => {
  const f = fixture(t);
  await f.choose();
  await f.adapter.start();
  f.ui.emit('chat-model', 'unlisted');
  assert.equal(f.settings.getSelection().model, 'model-1');
  f.ui.emit('chat-model', 'model-2');
  assert.equal(f.adapter.sendText('old conversation'), false);
  assert.equal(f.settings.getSelection().model, 'model-2');
});

test('Settings view exposes account identity, model, privacy, popup fallback and logout', async (t) => {
  const view = mountVoiceView(t);
  const f = fixture(t, { pinia: view.pinia });
  f.ui.update('voicePanel', {
    hidden: false,
    context: 'chat',
    settingsHidden: false,
  });
  await view.settle();
  const change = async (id, value) => {
    const node = document.getElementById(id);
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await view.settle();
  };
  await change('gev-chat-connection', 'chatgpt');
  assert.match(
    document.getElementById('gev-chat-account').textContent,
    /alice@example.test/,
  );
  assert.equal(document.getElementById('gev-chat-model').value, '');
  await change('gev-chat-model', 'model-1');
  assert.equal(f.settings.getSelection().model, 'model-1');
  assert.match(
    document.querySelector('.gev-chat-account-settings').textContent,
    /API keys are not used/,
  );
  document.getElementById('gev-chat-login').click();
  await flush();
  await view.settle();
  const link = document.querySelector('.gev-chat-account-settings a');
  assert.equal(
    link.getAttribute('href'),
    '/api/agent/chatgpt/authorize?ticket=fixture-ticket',
  );
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  document.getElementById('gev-chat-logout').click();
  await flush();
  await view.settle();
  assert.equal(f.settings.getSelection(), null);
  assert.match(
    document.querySelector('.gev-chat-account-settings').textContent,
    /Sign in to use/,
  );
});

test('failed status refresh fails closed and does not leak stale model results', async (t) => {
  let fail = false;
  const f = fixture(t, {
    fetchImpl: async (url) => {
      if (fail) throw new Error('offline');
      if (url.endsWith('/status'))
        return Response.json({
          configured: true,
          active: 'A',
          binding: 'binding-A',
        });
      return Response.json({
        binding: 'binding-A',
        models: [{ id: 'model-1' }],
      });
    },
  });
  await f.choose();
  assert.ok(f.settings.getSelection());
  fail = true;
  await f.settings.refresh();
  assert.equal(f.settings.getSelection(), null);
  assert.equal(f.ui.state.chat.accountSettings.error, 'offline');
});

test('production chat composition clears visible and engine history on an account boundary', async (t) => {
  const { createVoiceCommands } = await import('../voice/sessionCommands.js');
  const { createVoicePanelHost } = await import('../voice/panel/host.js');
  const ui = createTestVoiceUi({ panel: true });
  const host = createVoicePanelHost();
  let account = 'A';
  const sent = [];
  const fetchImpl = async (url, init = {}) => {
    const body = init.body && JSON.parse(init.body);
    const status = () => ({
      configured: true,
      active: account,
      binding: `binding-${account}`,
      accounts: [
        { id: 'A', label: 'Alice', signedIn: true },
        { id: 'B', label: 'Bob', signedIn: true },
      ],
    });
    if (url.endsWith('/status')) return Response.json(status());
    if (url.endsWith('/select')) {
      account = body.account;
      return Response.json(status());
    }
    if (url.includes('/models?'))
      return Response.json({
        binding: `binding-${account}`,
        models: [{ id: 'model-1' }],
      });
    if (url.endsWith('/command')) {
      sent.push(body);
      return Response.json({
        message: { role: 'assistant', content: 'Reply' },
      });
    }
    throw Error(url);
  };
  const commands = createVoiceCommands({
    runner: async () => ({ ok: true }),
    panelHost: host,
    createControl: () => ui,
    createChatSettings: (options) =>
      bindDockChatSettings({
        ...options,
        fetchImpl,
        storage: null,
        schedule: () => 1,
        unschedule() {},
      }),
    createSession(options) {
      const chat = options.createTextSession({ ...options, fetchImpl });
      let typed = false;
      return {
        capabilities: {},
        getStartOptions: () => ({ textOnly: typed }),
        start(settings) {
          typed = Boolean(settings?.textOnly);
          return chat.start();
        },
        stop(settings) {
          chat.stop(settings);
          options.emit({ type: 'state', state: 'idle' });
        },
        sendText: chat.sendText,
        sendMapEvent: chat.sendMapEvent,
        cancelTurn: chat.cancelTurn,
        getTextAuthNote: chat.getAuthNote,
      };
    },
  });
  t.after(() => {
    commands.stop({ removeUi: true });
    host.destroy();
  });
  ui.emit('chat-connection', 'chatgpt');
  await flush();
  ui.emit('chat-model', 'model-1');
  ui.emit('chat-button');
  ui.emit('chat-input', 'A private message');
  ui.emit('chat-submit');
  await flush();
  assert.equal(sent.length, 1);
  assert.ok(
    ui.chatMessages.some((message) =>
      message.text.includes('A private message'),
    ),
  );
  ui.emit('chat-input', 'A unsent draft');
  ui.emit('chat-account', 'B');
  await flush();
  assert.equal(ui.state.chat.draft, '');
  assert.deepEqual(ui.chatMessages, []);
  assert.equal(commands.session.state, 'idle');
  ui.emit('chat-model', 'model-1');
  ui.emit('chat-input', 'B message');
  ui.emit('chat-submit');
  await flush();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].binding, 'binding-B');
  assert.ok(!JSON.stringify(sent[1].messages).includes('A private message'));
});

test('late model discovery cannot overwrite a newer account or revive logout', async (t) => {
  const listing = deferred();
  let account = 'A';
  const f = fixture(t, {
    fetchImpl: async (url, init = {}) => {
      const status = () => ({
        active: account,
        binding: `binding-${account}`,
        configured: true,
        accounts: [
          { id: 'A', signedIn: true },
          { id: 'B', signedIn: true },
        ],
      });
      if (url.endsWith('/status')) return Response.json(status());
      if (url.endsWith('/select')) {
        account = JSON.parse(init.body).account;
        return Response.json(status());
      }
      if (url.includes('/models?'))
        return account === 'A'
          ? listing.promise
          : Response.json({
              binding: 'binding-B',
              models: [{ id: 'model-2' }],
            });
      throw Error(url);
    },
  });
  f.ui.emit('chat-connection', 'chatgpt');
  await flush();
  f.ui.emit('chat-account', 'B');
  await flush();
  f.ui.emit('chat-model', 'model-2');
  assert.equal(f.settings.getSelection().binding, 'binding-B');
  listing.resolve(
    Response.json({ binding: 'binding-A', models: [{ id: 'stale-model' }] }),
  );
  await flush();
  assert.equal(f.settings.getSelection().binding, 'binding-B');
  assert.deepEqual(f.ui.state.chat.accountSettings.models, [{ id: 'model-2' }]);
});

test('unmount cancels an active request and suppresses a late transcript', async (t) => {
  const late = deferred();
  let signal;
  const f = fixture(t, {
    command: (body, init) => {
      signal = init.signal;
      return late.promise;
    },
  });
  await f.choose();
  await f.adapter.start();
  f.adapter.sendText('wait');
  await flush();
  f.settings.destroy();
  assert.equal(signal.aborted, true);
  late.resolve(
    Response.json({
      message: { role: 'assistant', content: 'late after unmount' },
    }),
  );
  await flush();
  assert.ok(!f.events.some((event) => event.text === 'late after unmount'));
});

test('an unsafe authorization URL is refused and its popup is closed', async (t) => {
  let closed = false;
  const popup = {
    opener: {},
    location: {},
    close() {
      closed = true;
    },
  };
  const f = fixture(t, {
    view: { open: () => popup },
    fetchImpl: async (url) =>
      url.endsWith('/login')
        ? Response.json({
            path: 'https://untrusted.example/authorize?token=secret',
          })
        : Response.json({ configured: false }),
  });
  f.ui.emit('chat-connection', 'chatgpt');
  await flush();
  f.ui.emit('chat-login');
  await flush();
  assert.equal(closed, true);
  assert.equal(popup.opener, null);
  assert.equal(popup.location.href, undefined);
  assert.equal(f.ui.state.chat.accountSettings.signInPath, '');
});
