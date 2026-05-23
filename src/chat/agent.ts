import type { ChatRequest, SseEvent } from './types';
import type { ToolFactory, OpenAIMessage } from '../llm/types';
import { runAgentLoop } from '../llm/openrouter';

export type ToolBundle = {
  geocode: ToolFactory;
  plan: ToolFactory;
  bike_route: ToolFactory;
  search_stops: ToolFactory;
  nearby_stops: ToolFactory;
  schedule: ToolFactory;
};

export type RunTurnOpts = {
  tools: ToolBundle;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

const TOOL_NAMES = ['geocode', 'plan', 'bike_route', 'search_stops', 'nearby_stops', 'schedule'] as const;

function melbourneCalendarTable(now: Date): string {
  const dayFmt = new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'Australia/Melbourne' });
  const dateFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Australia/Melbourne' });
  const rows: string[] = [];
  for (let i = 0; i < 14; i++) {
    const probe = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const iso = dateFmt.format(probe);
    const weekday = dayFmt.format(probe);
    const tag = i === 0 ? ' ← TODAY' : i === 1 ? ' ← tomorrow' : '';
    rows.push(`  ${iso} (${weekday})${tag}`);
  }
  return [
    'Calendar — Melbourne local dates for the next 14 days:',
    ...rows,
    'When the user says e.g. "next Sunday", pick the FIRST row whose weekday matches',
    'AND whose date is at least 1 day after today. Do not improvise.',
  ].join('\n');
}

function systemPrompt(origin?: { lat: number; lon: number }, today = new Date()): string {
  return [
    'You are the assistant for ptv-chat — a Melbourne bike + train trip planner.',
    '',
    'HARD RULES — NON-NEGOTIABLE:',
    '- ALWAYS produce a bike + train (or bike-only) plan. Never refuse, never punt,',
    '  never reply with prose alone.',
    '- NEVER ask the user clarifying questions. Pick reasonable defaults and proceed.',
    '  If something is ambiguous, decide and state your decision in the reply.',
    '- NEVER invent numbers (km, minutes, depart/arrive times, elevations). Only quote',
    '  values returned by tool calls. If a tool returned nothing, say so and try a',
    '  different tool or a different geocode result — do not fabricate.',
    '- If a tool call fails or returns no results, RETRY with a different query,',
    '  different coords (try search_stops or nearby_stops), or a different goal.',
    '  Do not give up after one failed call.',
    '',
    'Tools available (your complete toolset; there are no others):',
    '- geocode: place name -> {lat, lon} via Photon (fallback Nominatim), Victoria-bounded.',
    '- plan: bike+train (or bike-only) trip between two coords.',
    '- bike_route: pure bicycle routing between two coords.',
    '- search_stops: find PTV stops by name.',
    '- nearby_stops: find PTV stops near a coord.',
    '- schedule: list real upcoming train departures from a PTV stop.',
    '',
    'Workflow:',
    '1. Geocode any place names that are not already coordinates.',
    '2. Call plan (or bike_route for pure-bike asks). For multi-leg days, call plan',
    '   once per leg with the relevant coords + arriveBy or depart time.',
    '3. For timetable / arrive-by asks, ALSO call schedule.',
    '4. Reply concisely. Quote elevation numbers and train depart/arrive times exactly',
    '   as returned by the tools.',
    '',
    melbourneCalendarTable(today),
    `Origin hint: ${origin ? `${origin.lat},${origin.lon} (Melbourne).` : 'unknown.'}`,
  ].join('\n');
}

export async function* runTurn(
  req: ChatRequest,
  opts: RunTurnOpts,
): AsyncGenerator<SseEvent> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    yield { type: 'turn_start' };
    yield { type: 'error', message: 'OPENROUTER_API_KEY is not set' };
    yield { type: 'turn_end' };
    return;
  }

  // Convert prior turns to OpenAI message list; last user message becomes the prompt.
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
  const history: OpenAIMessage[] = req.messages
    .filter((m) => m !== lastUser)
    .map((m) => ({ role: m.role, content: m.content }) as OpenAIMessage);

  const toolList: ToolFactory[] = TOOL_NAMES.map((n) => (opts.tools as any)[n]);

  yield* runAgentLoop(lastUser?.content ?? '', {
    model: req.model ?? opts.model ?? process.env.MODEL ?? 'anthropic/claude-haiku-4.5',
    systemPrompt: systemPrompt(req.origin),
    history,
    tools: toolList,
    apiKey,
    baseUrl: opts.baseUrl ?? process.env.OPENROUTER_BASE_URL,
    fetchImpl: opts.fetchImpl,
  });
}
