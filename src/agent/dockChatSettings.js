import { createDockTextSession } from './dockTextSession.js';
import { createTextChat } from '../voice/textChat.js';
import { t } from '../i18n/index.js';

export const DOCK_CHAT_SELECTION_KEY = 'godsEyeView.chat.connection.v1';

/** Shared Settings owns selection, never credentials or conversation contents. */
export function bindDockChatSettings({
  ui,
  invalidate,
  fetchImpl = globalThis.fetch.bind(globalThis),
  storage,
  view = globalThis.window,
  schedule = setTimeout,
  unschedule = clearTimeout,
}) {
  const targetStorage = () =>
    storage === undefined ? globalThis.localStorage : storage;
  let saved = {};
  try {
    saved = JSON.parse(targetStorage()?.getItem(DOCK_CHAT_SELECTION_KEY)) || {};
  } catch {
    /* Optional storage. */
  }
  let provider = ['api', 'chatgpt'].includes(saved.provider)
    ? saved.provider
    : '';
  let model = '';
  let status = null;
  let models = [];
  let binding = null;
  let generation = 0;
  let dead = false;
  let updating = false;
  let loading = false;
  let error = '';
  let operationError = '';
  let signInPath = '';
  let timer;
  const requests = new Set();
  const note = () =>
    provider === 'chatgpt'
      ? t(
          'ChatGPT receives your messages, reference data and tool results through your signed-in account. API keys are not used. Voice authorization is separate.',
        )
      : provider === 'api'
        ? t(
            'Chat uses the selected voice provider’s API key and may incur API charges.',
          )
        : t(
            'Choose a chat connection in Chat Settings before sending a message.',
          );
  const publish = () => {
    if (dead) return;
    ui.update('chat', {
      authNote: note,
      accountSettings: {
        provider,
        model,
        models,
        accounts: status?.accounts || [],
        account: status?.active || '',
        connected: Boolean(status?.configured),
        pending: Boolean(status?.pending),
        loading,
        updating,
        error,
        signInPath,
        note: note(),
      },
    });
  };
  function persist() {
    // Only the connection and model preference per opaque account ID are persisted.
    // Bindings, credentials and conversation contents remain outside browser storage.
    try {
      targetStorage()?.setItem(
        DOCK_CHAT_SELECTION_KEY,
        JSON.stringify({
          provider,
          models: {
            ...(saved.models || {}),
            ...(status?.active && model ? { [status.active]: model } : {}),
          },
        }),
      );
    } catch {
      /* Optional storage. */
    }
  }
  function boundary() {
    generation++;
    for (const request of requests) request.abort();
    requests.clear();
    refreshPromise = null;
    unschedule(timer);
    binding = null;
    models = [];
    model = '';
    signInPath = '';
    loading = false;
    invalidate();
  }
  async function json(path, body, signal) {
    const response = await fetchImpl(`/api/agent/${path}`, {
      ...(body !== undefined
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
      signal,
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  }
  const current = (stamp) =>
    !dead && stamp === generation && provider === 'chatgpt';
  function poll() {
    unschedule(timer);
    if (!dead && provider === 'chatgpt')
      timer = schedule(() => void refresh(), 1500);
  }
  let refreshPromise;
  function refresh() {
    if (refreshPromise) return refreshPromise;
    const task = load();
    refreshPromise = task;
    void task.finally(() => {
      if (refreshPromise === task) refreshPromise = null;
    });
    return task;
  }
  async function load() {
    if (dead || provider !== 'chatgpt' || updating) return;
    const stamp = generation;
    const controller = new AbortController();
    requests.add(controller);
    loading = true;
    publish();
    try {
      const data = await json('chatgpt/status', undefined, controller.signal);
      if (!current(stamp)) return;
      if (
        status &&
        (data.binding !== status.binding ||
          data.active !== status.active ||
          data.configured !== status.configured)
      ) {
        boundary();
        status = data;
        publish();
        return;
      }
      status = data;
      if (data.configured && !data.pending && !binding) {
        const listing = await json(
          'models?provider=chatgpt',
          undefined,
          controller.signal,
        );
        if (!current(stamp)) return;
        // A listing from a different authorization cannot select a model.
        if (!listing.binding || listing.binding !== data.binding)
          throw new Error(t('ChatGPT account changed. Refresh Chat Settings.'));
        binding = listing.binding;
        models = Array.isArray(listing.models) ? listing.models : [];
        const remembered = saved.models?.[data.active];
        model = models.some((item) => item.id === remembered) ? remembered : '';
      }
      error = data.error || operationError;
    } catch (failure) {
      if (!current(stamp) || controller.signal.aborted) return;
      boundary(); // Fail closed, including when a previously connected account becomes unavailable.
      status = null;
      error = failure.message;
    } finally {
      requests.delete(controller);
      if (!dead && stamp === generation) loading = false;
      publish();
      poll();
    }
  }
  async function mutate(route, body, popup) {
    if (dead || updating || provider !== 'chatgpt') {
      popup?.close();
      return;
    }
    boundary();
    const stamp = generation;
    updating = true;
    error = operationError = '';
    publish();
    try {
      const data = await json(`chatgpt/${route}`, body);
      if (!current(stamp)) {
        popup?.close();
        return;
      }
      if (route === 'login') {
        if (
          !/^\/api\/agent\/chatgpt\/authorize\?ticket=[\w-]+$/.test(data.path)
        )
          throw new Error(t('Could not start ChatGPT sign-in.'));
        if (popup) popup.location.href = data.path;
        else signInPath = data.path;
      } else {
        status = data;
        if (route === 'logout' && !data.revoked)
          error = operationError = t(
            'Signed out locally. Remote revocation was not confirmed; disconnect this app in ChatGPT Settings.',
          );
      }
    } catch (failure) {
      popup?.close();
      if (current(stamp)) {
        status = null;
        error = operationError = failure.message;
      }
    } finally {
      updating = false;
      publish();
      if (current(stamp)) {
        if (route === 'logout') poll();
        else void refresh();
      } else if (!dead && provider === 'chatgpt') void refresh();
    }
  }
  const offs = [
    ui.on('chat-connection', (value) => {
      if (!['api', 'chatgpt', ''].includes(value) || value === provider) return;
      boundary();
      provider = value;
      status = null;
      error = operationError = '';
      persist();
      publish();
      if (provider === 'chatgpt') void refresh();
    }),
    ui.on('chat-account', (account) => {
      if (
        status?.pending ||
        !status?.accounts?.some((item) => item.id === account && item.signedIn)
      )
        return;
      void mutate('select', { account });
    }),
    ui.on('chat-model', (value) => {
      if (
        updating ||
        loading ||
        !binding ||
        !models.some((item) => item.id === value) ||
        value === model
      )
        return;
      // Keep the authorized listing, but always retire the old conversation.
      invalidate();
      model = value;
      saved = {
        ...saved,
        models: { ...(saved.models || {}), [status.active]: model },
      };
      persist();
      publish();
    }),
    ui.on('chat-login', () => {
      if (updating || provider !== 'chatgpt') return;
      const popup = view?.open?.('about:blank', '_blank');
      if (popup) popup.opener = null;
      void mutate('login', { account: null }, popup);
    }),
    ui.on('chat-logout', () => void mutate('logout', {})),
    ui.on('settings-button', () => {
      if (provider === 'chatgpt') void refresh();
    }),
  ];
  publish();
  if (provider === 'chatgpt') void refresh();
  const thisSettings = {
    refresh,
    getSelection: () =>
      provider === 'chatgpt' &&
      !updating &&
      !status?.pending &&
      status?.configured &&
      binding &&
      model
        ? { provider, model, binding }
        : null,
    createTextSession(options) {
      // Construct the existing adapters; switching never reuses a live transport.
      let active;
      let epoch = 0;
      const stop = (settings) => {
        epoch++;
        active?.stop(settings);
        active = null;
      };
      return {
        getAuthNote: note,
        async start() {
          stop({ preserveStatus: true });
          const stamp = epoch;
          if (provider === 'chatgpt') await refresh();
          if (dead || stamp !== epoch || options.signal?.aborted) return false;
          const emit = (event) => {
            if (!dead && stamp === epoch) options.emit(event);
          };
          if (provider === 'api') active = createTextChat({ ...options, emit });
          else if (provider === 'chatgpt')
            active = createDockTextSession({
              ...options,
              emit,
              getSelection: () => thisSettings.getSelection(),
              getAuthNote: note,
            });
          else {
            emit({ type: 'state', state: 'error', detail: note() });
            return false;
          }
          return active.start();
        },
        stop,
        cancelTurn: () => active?.cancelTurn() ?? false,
        sendText: (text) => active?.sendText(text) ?? false,
        sendMapEvent: (event) => active?.sendMapEvent(event) ?? false,
      };
    },
    destroy() {
      if (dead) return;
      dead = true;
      boundary();
      for (const off of offs) off();
    },
  };
  return thisSettings;
}
