import { initialState, reduce } from './state';
import { streamChat } from './sse';
import { initMap } from './map';
import { renderMessages } from './chat';
import { renderLog } from './log';
import { renderLegend } from './legend';
import type { State, Action, LogEntry, Message } from './types';

const LS_KEY = 'ptv-chat:messages';
const LS_LOG = 'ptv-chat:logOpen';
const LS_DOCK = 'ptv-chat:dockCollapsed';
const LS_WIDTH = 'ptv-chat:dockWidth';
const LS_CLIENT_ID = 'ptv-chat:client-id';
const LS_CONV_ID   = 'ptv-chat:conversation-id';

function ensureClientId(): string {
  let id = localStorage.getItem(LS_CLIENT_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LS_CLIENT_ID, id);
  }
  return id;
}
function ensureConversationId(): string {
  let id = localStorage.getItem(LS_CONV_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LS_CONV_ID, id);
  }
  return id;
}
function newConversationId(): string {
  const id = crypto.randomUUID();
  localStorage.setItem(LS_CONV_ID, id);
  return id;
}

const clientId = ensureClientId();
let conversationId = ensureConversationId();

const DEFAULT_DOCK_W = 360;
const MIN_DOCK_W = 280;

let state: State = initialState();
try {
  const raw = localStorage.getItem(LS_KEY);
  const parsed: Message[] = raw ? JSON.parse(raw) : [];
  if (Array.isArray(parsed)) state.messages = parsed;
} catch { /* ignore */ }
state.logOpen = localStorage.getItem(LS_LOG) === '1';
state.dockCollapsed = localStorage.getItem(LS_DOCK) === '1';

// Restore dock width
const savedW = parseInt(localStorage.getItem(LS_WIDTH) ?? '', 10);
const initialW = Number.isFinite(savedW) && savedW >= MIN_DOCK_W ? savedW : DEFAULT_DOCK_W;
document.documentElement.style.setProperty('--dock-w', `${initialW}px`);

const map = initMap('map');
const $messages = document.getElementById('messages') as HTMLElement;
const $log = document.getElementById('log') as HTMLElement;
const $legend = document.getElementById('path-legend') as HTMLElement;
const $form = document.getElementById('send-form') as HTMLFormElement;
const $input = document.getElementById('send-input') as HTMLTextAreaElement;
const $dock = document.getElementById('chat') as HTMLElement;
const $resizer = document.getElementById('dock-resizer') as HTMLElement;
const $toggleLog = document.getElementById('toggle-log') as HTMLButtonElement;
const $collapse = document.getElementById('collapse-chat') as HTMLButtonElement;
const $newChat = document.getElementById('new-chat') as HTMLButtonElement;

function dispatch(action: Action) {
  state = reduce(state, action);
  render();
}

function render() {
  renderMessages($messages, state);
  renderLog($log, state);
  renderLegend($legend, state);
  $dock.classList.toggle('dock--collapsed', state.dockCollapsed);
  localStorage.setItem(LS_KEY, JSON.stringify(state.messages));
  localStorage.setItem(LS_LOG, state.logOpen ? '1' : '0');
  localStorage.setItem(LS_DOCK, state.dockCollapsed ? '1' : '0');
  map.setActive(state.activePathId);
}

async function tryGeolocate(): Promise<{ lat: number; lon: number } | undefined> {
  if (!navigator.geolocation) return undefined;
  try {
    return await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        reject,
        { timeout: 1500, maximumAge: 60_000 },
      );
    });
  } catch {
    return undefined;
  }
}

async function send() {
  const content = $input.value.trim();
  if (!content || state.streaming) return;
  $input.value = '';
  dispatch({ type: 'user_send', content });
  const origin = await tryGeolocate();
  let mapClearedForTurn = false;
  try {
    await streamChat(
      { messages: state.messages, origin },
      (ev) => {
        switch (ev.type) {
          case 'turn_start':
            dispatch({ type: 'turn_start' });
            break;
          case 'text_delta':
            dispatch({ type: 'text_delta', delta: ev.delta });
            break;
          case 'tool_call': {
            const entry: LogEntry = {
              id: ev.id, name: ev.name, args: ev.args, startedAt: Date.now(),
            };
            dispatch({ type: 'tool_call', entry });
            break;
          }
          case 'tool_result':
            dispatch({ type: 'tool_result', id: ev.id,
                       result: { ok: ev.ok, summary: ev.summary } });
            break;
          case 'path_add': {
            if (!mapClearedForTurn) {
              map.clear();
              mapClearedForTurn = true;
            }
            const path = { id: ev.pathId, label: ev.label, color: ev.color, itinerary: ev.itinerary };
            dispatch({ type: 'path_add', path });
            map.addPath(path);
            map.fitToPaths();
            break;
          }
          case 'turn_end':
            dispatch({ type: 'turn_end' });
            break;
          case 'error':
            dispatch({ type: 'error', message: ev.message });
            break;
        }
      },
      undefined,
      {
        'X-Ptv-Client-Id': clientId,
        'X-Ptv-Conversation-Id': conversationId,
      },
    );
  } catch (err: any) {
    dispatch({ type: 'error', message: err?.message ?? String(err) });
  }
}

$form.addEventListener('submit', (e) => {
  e.preventDefault();
  void send();
});

// Enter = send, Shift+Enter = newline.
$input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  }
});

$toggleLog.addEventListener('click', () => dispatch({ type: 'toggle_log' }));
$collapse.addEventListener('click', () => dispatch({ type: 'toggle_dock' }));
$newChat.addEventListener('click', () => {
  if (!confirm('Clear chat?')) return;
  localStorage.removeItem(LS_KEY);
  conversationId = newConversationId();
  map.clear();
  dispatch({ type: 'reset_chat' });
});

document.addEventListener('chat:set-active', (e: any) => {
  dispatch({ type: 'set_active', id: e.detail });
});

// Drag-resize: pull the left edge of the dock to widen/narrow.
(function wireResizer() {
  let dragging = false;
  $resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    $resizer.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(MIN_DOCK_W, Math.min(window.innerWidth - 40, window.innerWidth - e.clientX));
    document.documentElement.style.setProperty('--dock-w', `${w}px`);
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    $resizer.classList.remove('dragging');
    const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--dock-w'), 10);
    if (Number.isFinite(w)) localStorage.setItem(LS_WIDTH, String(w));
    // Invalidate Leaflet so it re-measures the visible map area.
    window.dispatchEvent(new Event('resize'));
  });
})();

render();
