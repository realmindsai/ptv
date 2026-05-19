import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { ChatRequest, SseEvent } from './types';

export type ToolBundle = {
  geocode: any;
  plan: any;
  bike_route: any;
  search_stops: any;
  nearby_stops: any;
};

export type RunTurnOpts = {
  tools: ToolBundle;
  model?: string;
};

const SERVER_NAME = 'ptv-chat';
const TOOL_PREFIX = `mcp__${SERVER_NAME}__`;
const TOOL_NAMES = ['geocode', 'plan', 'bike_route', 'search_stops', 'nearby_stops'] as const;

function systemPrompt(origin?: { lat: number; lon: number }, today = new Date()): string {
  return [
    'You are the assistant for ptv-chat — a Melbourne bike + train trip planner.',
    '',
    'Tools available (your complete toolset; there are no others):',
    '- geocode: place name -> {lat, lon} via Nominatim (Victoria-bounded).',
    '- plan: bike+train (or bike-only) trip between two coords. goal=commute|day-ride|max-path,',
    '  mode=bike-only|bike-train, maxTransfers=0|1. Returns 1-3 labeled finalist routes per call.',
    '- bike_route: pure bicycle routing between two coords. goal=commute (fastest/safest),',
    '  day-ride (prefers cycleways), or max-path (longest on dedicated path).',
    '- search_stops: find PTV stops by name.',
    '- nearby_stops: find PTV stops near a coord.',
    '',
    'How the tools work under the hood (so you can answer "what engine?" questions):',
    '- Bicycle routing (bike_route + every bike leg inside plan) is GraphHopper, hosted',
    '  locally on the same network. goal=commute uses the default `bike` profile;',
    '  goal=day-ride and goal=max-path use GraphHopper custom_model requests that bias',
    '  toward cycleways/paths and away from busy roads.',
    '- Walking legs (rare; only used when plan needs a foot connection) use OSRM AU.',
    '- Transit data comes from the PTV Timetable API.',
    '',
    'Every bike route includes elevation analytics from GraphHopper, returned in the tool',
    'summary: km, min, kmOnPath (km on cycleway/path/track), ascendM, descendM (totals),',
    'maxSustainedGradePercent + maxSustainedGradeM (worst sustained climb), flatFraction',
    'and steepFraction (proportion of the route at <2% / >6% grade). For plan results, the',
    'same fields are aggregated across all bike legs of each itinerary.',
    '',
    'Schedule details — the plan tool result includes per-leg breakdown: each train leg',
    'reports its real PTV-sourced route name, from/to stop names, departLocal and',
    'arriveLocal in Melbourne local time, and a runRef. The itinerary also exposes',
    'tripDepartLocal / tripArriveLocal (first train depart, last train arrive). Quote',
    'these directly when the user asks about timing — never invent or estimate them.',
    '',
    'Time arguments to plan (depart, arriveBy):',
    '- "HH:MM" is interpreted as TODAY in Melbourne local. Only use it when the user',
    '  is asking about today.',
    '- For any other date (e.g. "Sunday 25 May, arrive by 7am"), pass a full ISO8601',
    '  string with timezone offset, e.g. "2026-05-25T07:00:00+10:00". Melbourne is',
    '  +10:00 (AEST) or +11:00 (AEDT, October to April).',
    '',
    'Workflow:',
    '1. Geocode any place names that are not already coordinates.',
    '2. Call plan (or bike_route for pure-bike asks). You may call it multiple times to',
    '   compare goals or modes; each call adds candidate path(s) to the user map.',
    '3. Reply concisely. Name each route. Do not repeat geometry; the user sees polylines.',
    '   Do quote elevation numbers and train depart/arrive times from the summary.',
    '',
    `Today is ${today.toISOString().slice(0, 10)} (UTC). Melbourne local may be a day ahead.`,
    `Origin hint: ${origin ? `${origin.lat},${origin.lon}` : 'unknown'}.`,
  ].join('\n');
}

// Map ONE SDKMessage to zero or more SseEvent. Exported for unit testing.
export function mapSdkMessage(msg: any): SseEvent[] {
  if (!msg || typeof msg !== 'object') return [];
  switch (msg.type) {
    case 'stream_event': {
      const e = msg.event;
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        return [{ type: 'text_delta', delta: e.delta.text }];
      }
      return [];
    }
    case 'assistant': {
      const blocks = msg.message?.content ?? [];
      const out: SseEvent[] = [];
      for (const b of blocks) {
        if (b.type === 'tool_use') {
          const stripped = typeof b.name === 'string' && b.name.startsWith(TOOL_PREFIX)
            ? b.name.slice(TOOL_PREFIX.length)
            : b.name;
          out.push({ type: 'tool_call', id: b.id, name: stripped, args: b.input ?? {} });
        } else if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
          // The SDK delivers complete assistant text in one block (no partial deltas
          // unless includePartialMessages is enabled). Forward it as a single text_delta
          // so the client sees the assistant's words. If stream_event deltas ARE
          // enabled by a future config, the same text will arrive twice — at that
          // point gate this branch on the absence of stream events.
          out.push({ type: 'text_delta', delta: b.text });
        }
      }
      return out;
    }
    case 'user': {
      const blocks = msg.message?.content ?? [];
      const out: SseEvent[] = [];
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          const summary = Array.isArray(b.content)
            ? b.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('')
            : typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
          out.push({
            type: 'tool_result',
            id: b.tool_use_id,
            ok: b.is_error !== true,
            summary: summary.slice(0, 1000),
          });
        }
      }
      return out;
    }
    default:
      return [];
  }
}

export async function* runTurn(
  req: ChatRequest,
  opts: RunTurnOpts,
): AsyncGenerator<SseEvent> {
  yield { type: 'turn_start' };
  try {
    // Build the in-process MCP server hosting our five tools.
    const sdkTools = TOOL_NAMES.map((name) => {
      const t = (opts.tools as any)[name];
      // Each tool factory has shape {name, description, schema, handler}.
      // We adapt the handler to MCP CallToolResult (content array).
      return {
        name: t.name,
        description: t.description,
        inputSchema: t.schema,
        handler: async (args: unknown) => {
          const out = await t.handler(args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(out) }] };
        },
      };
    });
    const mcpServer = createSdkMcpServer({ name: SERVER_NAME, tools: sdkTools as any });
    const allowedTools = TOOL_NAMES.map((n) => `${TOOL_PREFIX}${n}`);

    // Convert prior turns into an AsyncIterable<SDKUserMessage> so the model sees history.
    // The SDK is happy with `prompt: string` for a single-turn fresh chat;
    // for multi-turn, supply the final user message as `prompt` string and pass
    // earlier messages via a custom approach. Simplest: concatenate as plain text.
    // (When history grows, switch to a real AsyncIterable.)
    const lastUser = [...req.messages].reverse().find(m => m.role === 'user');
    const prompt = lastUser?.content ?? '';
    const priorHistory = req.messages
      .filter(m => m !== lastUser)
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');
    const fullPrompt = priorHistory ? `${priorHistory}\n\nUSER: ${prompt}` : prompt;

    const stream = query({
      prompt: fullPrompt,
      options: {
        model: req.model ?? opts.model ?? process.env.MODEL ?? 'claude-sonnet-4-6',
        systemPrompt: systemPrompt(req.origin),
        mcpServers: { [SERVER_NAME]: mcpServer },
        allowedTools,
      },
    });

    for await (const msg of stream) {
      for (const ev of mapSdkMessage(msg)) yield ev;
    }
  } catch (err: any) {
    yield { type: 'error', message: err?.message ?? String(err) };
  } finally {
    yield { type: 'turn_end' };
  }
}
