import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { JsonlSessionStore } from '../engine/session/jsonlStore';
import type { TurnEngine } from '../engine/turnEngine';
import { DEFAULT_WORLD_ID } from '../worlds';
import { isChronicleError } from '../engine/errors';
import {
  OperatorCliEngine,
  type OperatorViewMode,
} from './operatorEngine';
import {
  renderArtifacts,
  renderCouncilInspection,
  renderHistory,
  renderPromptInspection,
  renderRouteSummary,
  renderSessionList,
  renderSessionSummary,
  renderStaffAskReport,
  renderCurrentThoughts,
  renderStateInspection,
  renderStewardInspection,
  renderTraceTimeline,
  renderTurnExecutionReport,
  renderTurnExplanation,
  renderWorldInspection,
  renderWorldList,
  type RenderOptions,
} from './operatorRender';
import {
  renderDebugEvent,
  resolveApiKey,
  resolveCliApiMode,
  resolveStartupWorld,
  thinkingPhaseForDebugEvent,
  type CliApiMode,
  type DebugDetail,
  type CliTerminal,
  type CliTranscriptEvent,
} from './app';
import type { GMReasoningEffort } from '../agents/gm/gmAgent';
import type { NarratorStyle } from '../agents/narrator/narratorAgent';
import type { DebugEvent } from '../engine/debug';
import { startStaffCli } from './staffApp';
import { ThinkingAnimation } from './thinkingAnimation';

export interface OperatorCliRunOptions {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  engine: TurnEngine;
  store: JsonlSessionStore;
  allowNonTty?: boolean;
  transcript?: (event: CliTranscriptEvent) => void;
  playTerminal?: CliTerminal;
}

type InspectTarget =
  | 'session'
  | 'state'
  | 'route'
  | 'steward'
  | 'council'
  | 'trace'
  | 'history'
  | 'artifacts'
  | 'prompts'
  | 'world';

interface GlobalOptions {
  sessionId?: string;
  worldId?: string;
  json: boolean;
  raw: boolean;
  verbose: boolean;
  diff: boolean;
  noNarration: boolean;
  view: OperatorViewMode;
  narratorStyle: NarratorStyle;
  gmReasoningEffort: GMReasoningEffort;
  apiMode: CliApiMode;
  allowNonTty: boolean;
}

type ParsedCommand =
  | { kind: 'help' }
  | { kind: 'play' }
  | { kind: 'turn-run'; text: string }
  | { kind: 'turn-explain'; text: string }
  | { kind: 'inspect'; target: InspectTarget }
  | { kind: 'staff-ask'; question: string }
  | { kind: 'staff-interactive' }
  | { kind: 'session-new'; requestedSessionId?: string }
  | { kind: 'session-resume'; sessionId: string }
  | { kind: 'session-list' }
  | { kind: 'worlds-list' };

interface PlayState {
  sessionId: string;
  playerId: string;
  worldId: string;
  worldDisplayName: string;
  apiKey?: string;
  apiMode: CliApiMode;
  narratorStyle: NarratorStyle;
  gmReasoningEffort: GMReasoningEffort;
  render: RenderOptions;
}

export async function runOperatorCli(options: OperatorCliRunOptions): Promise<number> {
  const env = options.env || process.env;
  const writeOutput = (text: string) => {
    options.transcript?.({ type: 'output', text });
    output.write(text);
  };
  const defaultOptions: GlobalOptions = {
    json: false,
    raw: false,
    verbose: false,
    diff: false,
    noNarration: false,
    view: 'operator',
    narratorStyle: 'michener',
    gmReasoningEffort: 'low',
    apiMode: resolveCliApiMode(env.CHRONICLE_API_MODE),
    worldId: env.CHRONICLE_STARTUP_WORLD_ID || undefined,
    allowNonTty: options.allowNonTty ?? isTruthyEnv(env.CHRONICLE_ALLOW_NON_TTY),
  };
  const parsed = parseCommandTree(options.argv, defaultOptions);
  const operator = new OperatorCliEngine({
    engine: options.engine,
    store: options.store,
  });
  const apiKey = resolveApiKey(env);

  if (parsed.command.kind === 'play') {
    return runPlayLoop({
      operator,
      engine: options.engine,
      apiKey,
      options: parsed.options,
      transcript: options.transcript,
      terminal: options.playTerminal,
      env,
    });
  }

  if (parsed.command.kind === 'staff-interactive') {
    const result = await startStaffCli(options.engine, {
      sessionId: parsed.options.sessionId,
      apiKey: effectiveApiKey(apiKey, parsed.options.apiMode),
      allowNonTty: parsed.options.allowNonTty,
    });
    return result.exitCode;
  }

  try {
    const rendered = await executeCommand({
      command: parsed.command,
      options: parsed.options,
      operator,
      apiKey,
    });
    if (rendered != null) {
      writeOutput(rendered.endsWith('\n') ? rendered : `${rendered}\n`);
    }
    return 0;
  } catch (error) {
    writeOutput(`Error: ${formatError(error)}\n`);
    return 1;
  }
}

async function executeCommand(params: {
  command: ParsedCommand;
  options: GlobalOptions;
  operator: OperatorCliEngine;
  apiKey?: string;
}): Promise<string | null> {
  const { command, options, operator, apiKey } = params;
  const renderOptions = toRenderOptions(options);

  switch (command.kind) {
    case 'help':
      return helpText();
    case 'turn-run': {
      const report = await operator.runTurnDetailed({
        sessionId: options.sessionId,
        worldId: options.worldId || DEFAULT_WORLD_ID,
        playerId: 'player-1',
        playerText: command.text,
        apiKey: effectiveApiKey(apiKey, options.apiMode),
        apiMode: options.apiMode,
        gmReasoningEffort: options.gmReasoningEffort,
        narratorStyle: options.narratorStyle,
      });
      return options.json ? prettyJSON(report) : renderTurnExecutionReport(report, renderOptions);
    }
    case 'turn-explain': {
      const explanation = await operator.explainTurn({
        sessionId: options.sessionId,
        worldId: options.worldId || DEFAULT_WORLD_ID,
        playerId: 'player-1',
        playerText: command.text,
      });
      return options.json ? prettyJSON(explanation) : renderTurnExplanation(explanation, renderOptions);
    }
    case 'inspect': {
      const sessionId = await resolveTargetSessionId(operator, options.sessionId);
      switch (command.target) {
        case 'session': {
          const session = await operator.getSessionSummary(sessionId);
          return options.json ? prettyJSON(session) : renderSessionSummary(session);
        }
        case 'state': {
          const state = await operator.getStateSnapshot(sessionId, 'player-1');
          return options.json ? prettyJSON(state) : renderStateInspection(state, renderOptions);
        }
        case 'route': {
          const route = await operator.getLatestRouteSummary(sessionId);
          return options.json ? prettyJSON(route) : renderRouteSummary(route || {
            classification: null,
            deterministicOwner: null,
            requiredDomains: [],
            optionalDomains: [],
            heldBeatsToConsider: [],
            pendingEventsToCheck: [],
            rationale: null,
            councilTaskCount: 0,
            councilDomains: [],
            ownerLabel: 'unknown owner',
            closeRoute: null,
            stewardHandled: false,
            gmHandled: false,
            fallbackReason: null,
          });
        }
        case 'steward': {
          const steward = await operator.getStewardInspection(sessionId);
          return options.json ? prettyJSON(steward) : renderStewardInspection(steward, renderOptions);
        }
        case 'council': {
          const council = await operator.getCouncilInspection(sessionId);
          return options.json ? prettyJSON(council) : renderCouncilInspection(council, renderOptions);
        }
        case 'trace': {
          const trace = await operator.getLatestTurnTrace(sessionId);
          return options.json ? prettyJSON(trace) : renderTraceTimeline(trace.timeline, renderOptions);
        }
        case 'history': {
          const history = await operator.getTurnHistory(sessionId);
          return options.json ? prettyJSON(history) : renderHistory(history);
        }
        case 'artifacts': {
          const artifacts = await operator.getArtifacts(sessionId);
          return options.json ? prettyJSON(artifacts) : renderArtifacts(artifacts);
        }
        case 'prompts': {
          const prompts = await operator.getPromptInspection(sessionId);
          return options.json ? prettyJSON(prompts) : renderPromptInspection(prompts, renderOptions);
        }
        case 'world': {
          const world = await operator.getWorldInspection(sessionId);
          return options.json ? prettyJSON(world) : renderWorldInspection(world, renderOptions);
        }
      }
      throw new Error(`Unknown inspect target: ${command.target}`);
    }
    case 'staff-ask': {
      const report = await operator.askStaff({
        sessionId: options.sessionId,
        worldId: options.worldId || DEFAULT_WORLD_ID,
        playerId: 'player-1',
        question: command.question,
        apiKey: effectiveApiKey(apiKey, options.apiMode),
        apiMode: options.apiMode,
      });
      return options.json ? prettyJSON(report) : renderStaffAskReport(report, renderOptions);
    }
    case 'session-new': {
      const initialized = await operator.initSessionDetailed({
        sessionId: command.requestedSessionId,
        worldId: options.worldId || DEFAULT_WORLD_ID,
        apiKey: effectiveApiKey(apiKey, options.apiMode),
        apiMode: options.apiMode,
      });
      if (options.json) {
        return prettyJSON(initialized);
      }
      return [
        renderSessionSummary(initialized.sessionSummary),
        `## Opening\n${initialized.result.opening}`,
      ].join('\n\n');
    }
    case 'session-resume': {
      const initialized = await operator.initSessionDetailed({
        sessionId: command.sessionId,
        worldId: options.worldId,
        apiKey: effectiveApiKey(apiKey, options.apiMode),
        apiMode: options.apiMode,
      });
      if (options.json) {
        return prettyJSON(initialized);
      }
      return [
        renderSessionSummary(initialized.sessionSummary),
        `## Opening\n${initialized.result.opening}`,
      ].join('\n\n');
    }
    case 'session-list': {
      const sessions = await operator.listSessions();
      return options.json ? prettyJSON(sessions) : renderSessionList(sessions);
    }
    case 'worlds-list': {
      const worlds = operator.listWorlds();
      return options.json ? prettyJSON(worlds) : renderWorldList(worlds);
    }
    case 'play':
    case 'staff-interactive':
      return null;
  }
}

async function runPlayLoop(params: {
  operator: OperatorCliEngine;
  engine: TurnEngine;
  apiKey?: string;
  options: GlobalOptions;
  transcript?: (event: CliTranscriptEvent) => void;
  terminal?: CliTerminal;
  env?: NodeJS.ProcessEnv;
}): Promise<number> {
  const terminal = params.terminal || createTerminal();
  const thinkingAnimation = new ThinkingAnimation({
    terminal,
    ansi: shouldUseAnsi(params.env || process.env),
  });
  const playLoopStartedAt = Date.now();
  const writeOutput = (text: string) => {
    thinkingAnimation.beforeWrite();
    params.transcript?.({ type: 'output', text });
    terminal.write(text);
    thinkingAnimation.afterWrite();
  };
  const readLine = async (prompt: string) => {
    params.transcript?.({ type: 'prompt', text: prompt });
    const line = await terminal.readLine(prompt);
    if (line != null) {
      params.transcript?.({ type: 'input', text: line });
    }
    return line;
  };
  if (!params.options.allowNonTty && !terminal.isTTY()) {
    writeOutput('Error: play mode requires an interactive terminal.\n');
    terminal.close();
    return 1;
  }

  let state: PlayState | null = null;
  const liveDebugDetail = (): DebugDetail => {
    const view = state?.render.view ?? params.options.view;
    return view === 'full' || view === 'raw' ? 'raw' : 'summary';
  };
  let liveThoughtsStarted = false;
  const streamDebugEvent = (event: DebugEvent) => {
    const phase = thinkingPhaseForDebugEvent(event);
    if (phase) {
      thinkingAnimation.setPhase(phase);
    }
    if (event.type === 'llm.response.received' && event.reasoningHeadings?.some(heading => heading.trim()) && !liveThoughtsStarted) {
      writeOutput('## Current Thoughts\n');
      liveThoughtsStarted = true;
    }
    const rendered = renderDebugEvent(event, liveDebugDetail());
    if (rendered) {
      writeOutput(rendered);
    }
  };
  try {
    const worldPromptStartedAt = Date.now();
    // #region agent log
    fetch('http://127.0.0.1:7412/ingest/6414e5d3-0ba2-48dd-aec2-bcdd9c092ae4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'10fa75'},body:JSON.stringify({sessionId:'10fa75',runId:'play-startup',hypothesisId:'H1',location:'src/cli/operatorCli.ts:355',message:'play loop entered',data:{apiMode:params.options.apiMode,hasSessionId:Boolean(params.options.sessionId),hasStartupWorldId:Boolean(params.options.worldId)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const startupWorld = await resolveStartupWorld({
      terminal,
      readLine,
      write: writeOutput,
      sessionId: params.options.sessionId,
      startupWorldId: params.options.worldId,
    });
    // #region agent log
    fetch('http://127.0.0.1:7412/ingest/6414e5d3-0ba2-48dd-aec2-bcdd9c092ae4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'10fa75'},body:JSON.stringify({sessionId:'10fa75',runId:'play-startup',hypothesisId:'H1',location:'src/cli/operatorCli.ts:362',message:'startup world resolved',data:{elapsedMs:Date.now()-worldPromptStartedAt,selectedWorldId:startupWorld?.id??null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!startupWorld) {
      return 0;
    }

    thinkingAnimation.start('opening');
    const initSessionStartedAt = Date.now();
    const initialized = await params.operator.initSessionDetailed({
      sessionId: params.options.sessionId,
      worldId: startupWorld.id,
      apiKey: effectiveApiKey(params.apiKey, params.options.apiMode),
      apiMode: params.options.apiMode,
      onDebugEvent: streamDebugEvent,
    });
    // #region agent log
    fetch('http://127.0.0.1:7412/ingest/6414e5d3-0ba2-48dd-aec2-bcdd9c092ae4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'10fa75'},body:JSON.stringify({sessionId:'10fa75',runId:'play-startup',hypothesisId:'H2',location:'src/cli/operatorCli.ts:379',message:'initial session initialized',data:{elapsedMs:Date.now()-initSessionStartedAt,worldId:startupWorld.id,usedFallback:initialized.usedFallback,created:initialized.result.created},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    thinkingAnimation.stop();
    state = {
      sessionId: initialized.result.sessionId,
      playerId: 'player-1',
      worldId: initialized.result.world.id,
      worldDisplayName: initialized.result.world.displayName,
      apiKey: effectiveApiKey(params.apiKey, params.options.apiMode),
      apiMode: initialized.usedFallback ? 'fallback' : params.options.apiMode,
      narratorStyle: params.options.narratorStyle,
      gmReasoningEffort: params.options.gmReasoningEffort,
      render: toRenderOptions(params.options),
    };

    if (state.apiMode === 'fallback') {
      writeOutput('(Fallback mode - deterministic runtime)\n\n');
    } else if (!state.apiKey) {
      writeOutput('(No API key - running in deterministic fallback mode)\n\n');
    } else if (initialized.usedFallback) {
      writeOutput('(API unavailable - switched to deterministic fallback mode)\n\n');
    }
    writeOutput(`## Chronicle Play\nsession=${state.sessionId} | world=${state.worldDisplayName}\n\n`);
    writeOutput(`${initialized.result.opening}\n\n`);
    writeOutput('Type `:help` for operator commands, or enter your action.\n\n');

    for (;;) {
      const line = await readLine(playPrompt(state));
      if (line == null) return 0;
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith(':') || trimmed.startsWith('/')) {
        const result = await handlePlayCommand({
          line: trimmed,
          state,
          operator: params.operator,
          engine: params.engine,
          apiKey: params.apiKey,
        });
        if (result.exit) return 0;
        state = result.state;
        if (result.outputText) {
          writeOutput(`${result.outputText}\n\n`);
        }
        continue;
      }

      thinkingAnimation.start('thinking');
      liveThoughtsStarted = false;
      const playTurnStartedAt = Date.now();
      const report = await params.operator.runTurnDetailed({
        sessionId: state.sessionId,
        worldId: state.worldId,
        playerId: state.playerId,
        playerText: trimmed,
        apiKey: effectiveApiKey(state.apiKey, state.apiMode),
        apiMode: state.apiMode,
        gmReasoningEffort: state.gmReasoningEffort,
        narratorStyle: state.narratorStyle,
        onDebugEvent: streamDebugEvent,
      });
      // #region agent log
      fetch('http://127.0.0.1:7412/ingest/6414e5d3-0ba2-48dd-aec2-bcdd9c092ae4',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'10fa75'},body:JSON.stringify({sessionId:'10fa75',runId:'play-turn',hypothesisId:'H5',location:'src/cli/operatorCli.ts:442',message:'play turn completed',data:{elapsedMs:Date.now()-playTurnStartedAt,totalSincePlayLoopMs:Date.now()-playLoopStartedAt,executionMode:report.input.executionMode,route:report.route.classification,councilDomains:report.route.councilDomains},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      thinkingAnimation.stop();
      if (report.input.executionMode === 'auto->fallback') {
        state.apiMode = 'fallback';
        state.apiKey = undefined;
        writeOutput('(API request failed - switched to deterministic fallback mode)\n\n');
      }
      writeOutput(`${renderPlayTurnSummary(report, state.render, { omitCurrentThoughts: liveThoughtsStarted })}\n\n`);
    }
  } catch (error) {
    thinkingAnimation.stop();
    writeOutput(`Error: ${formatError(error)}\n`);
    return 1;
  } finally {
    thinkingAnimation.stop();
    terminal.close();
  }
}

async function handlePlayCommand(params: {
  line: string;
  state: PlayState;
  operator: OperatorCliEngine;
  engine: TurnEngine;
  apiKey?: string;
}): Promise<{ state: PlayState; exit: boolean; outputText?: string }> {
  const isLegacySlash = params.line.startsWith('/');
  const tokens = tokenizeCommandLine(params.line.slice(1));
  if (!tokens.length) return { state: params.state, exit: false };
  const [head, ...rest] = tokens;

  if (head === 'exit' || head === 'quit') {
    return { state: params.state, exit: true };
  }

  if (head === 'help') {
    return { state: params.state, exit: false, outputText: playHelpText() };
  }

  if (head === 'style') {
    const next = rest[0];
    if (!isNarratorStyle(next)) {
      return { state: params.state, exit: false, outputText: 'Usage: :style <lyric|cinematic|michener>' };
    }
    return {
      state: { ...params.state, narratorStyle: next },
      exit: false,
      outputText: `Narrator style=${next}`,
    };
  }

  if (head === 'reasoning') {
    const next = rest[0];
    if (!isReasoningLevel(next)) {
      return { state: params.state, exit: false, outputText: 'Usage: :reasoning <low|medium|high>' };
    }
    return {
      state: { ...params.state, gmReasoningEffort: next },
      exit: false,
      outputText: `Reasoning=${next}`,
    };
  }

  if (head === 'mode') {
    const next = rest[0];
    if (!next || (next !== 'auto' && next !== 'fallback' && next !== 'live')) {
      return { state: params.state, exit: false, outputText: 'Usage: :mode <auto|fallback|live>' };
    }
    return {
      state: {
        ...params.state,
        apiMode: next,
        apiKey: next === 'fallback' ? undefined : params.apiKey,
      },
      exit: false,
      outputText: `API mode=${next}`,
    };
  }

  if (head === 'debug' || head === 'trace') {
    const next = rest[0];
    const view = next === 'off' ? 'operator' : 'full';
    return {
      state: { ...params.state, render: { ...params.state.render, view } },
      exit: false,
      outputText: `${isLegacySlash ? 'Deprecated slash command.' : 'Debug view updated.'} view=${view}`,
    };
  }

  if (head === 'detail') {
    const next = rest[0];
    const view = next === 'raw' ? 'raw' : next === 'summary' ? 'summary' : next === 'full' ? 'full' : next === 'operator' ? 'operator' : null;
    if (!view) {
      return { state: params.state, exit: false, outputText: 'Usage: :detail <summary|operator|full|raw>' };
    }
    return {
      state: { ...params.state, render: { ...params.state.render, view } },
      exit: false,
      outputText: `${isLegacySlash ? 'Deprecated slash command.' : 'Detail view updated.'} view=${view}`,
    };
  }

  const mappedTokens = mapLegacySlashCommand(head, rest);
  const parsed = parseCommandTree(mappedTokens.tokens, {
    json: false,
    raw: params.state.render.raw === true || params.state.render.view === 'raw',
    verbose: params.state.render.verbose === true,
    diff: params.state.render.diff === true,
    noNarration: params.state.render.noNarration === true,
    view: params.state.render.view,
    narratorStyle: params.state.narratorStyle,
    gmReasoningEffort: params.state.gmReasoningEffort,
    apiMode: params.state.apiMode,
    sessionId: params.state.sessionId,
    worldId: params.state.worldId,
    allowNonTty: true,
  });

  if (parsed.command.kind === 'play') {
    return { state: params.state, exit: false, outputText: playHelpText() };
  }

  if (parsed.command.kind === 'session-new') {
    const initialized = await params.operator.initSessionDetailed({
      sessionId: parsed.command.requestedSessionId,
      worldId: parsed.options.worldId || params.state.worldId,
      apiKey: effectiveApiKey(params.apiKey, parsed.options.apiMode),
      apiMode: parsed.options.apiMode,
    });
    return {
      state: {
        ...params.state,
        sessionId: initialized.result.sessionId,
        worldId: initialized.result.world.id,
        worldDisplayName: initialized.result.world.displayName,
      },
      exit: false,
      outputText: [
        renderSessionSummary(initialized.sessionSummary),
        `## Opening\n${initialized.result.opening}`,
      ].join('\n\n'),
    };
  }

  if (parsed.command.kind === 'session-resume') {
    const initialized = await params.operator.initSessionDetailed({
      sessionId: parsed.command.sessionId,
      worldId: parsed.options.worldId,
      apiKey: effectiveApiKey(params.apiKey, parsed.options.apiMode),
      apiMode: parsed.options.apiMode,
    });
    return {
      state: {
        ...params.state,
        sessionId: initialized.result.sessionId,
        worldId: initialized.result.world.id,
        worldDisplayName: initialized.result.world.displayName,
      },
      exit: false,
      outputText: [
        renderSessionSummary(initialized.sessionSummary),
        `## Opening\n${initialized.result.opening}`,
      ].join('\n\n'),
    };
  }

  const rendered = await executeCommand({
    command: parsed.command,
    options: {
      ...parsed.options,
      sessionId: parsed.options.sessionId || params.state.sessionId,
      worldId: parsed.options.worldId || params.state.worldId,
      narratorStyle: params.state.narratorStyle,
      gmReasoningEffort: params.state.gmReasoningEffort,
      apiMode: params.state.apiMode,
    },
    operator: params.operator,
    apiKey: params.apiKey,
  });
  return {
    state: params.state,
    exit: false,
    outputText: `${mappedTokens.deprecationNotice || ''}${mappedTokens.deprecationNotice && rendered ? '\n\n' : ''}${rendered || ''}`.trim(),
  };
}

function renderPlayTurnSummary(
  report: Awaited<ReturnType<OperatorCliEngine['runTurnDetailed']>>,
  render: RenderOptions,
  options: { omitCurrentThoughts?: boolean } = {},
): string {
  const lines = [
    `[route] ${report.route.classification || 'unknown'} -> ${report.route.ownerLabel}`,
    `[dispatch] ${report.route.councilDomains.length ? report.route.councilDomains.join(', ') : 'none'}`,
    `[decision] accepted=${report.decision.acceptedEvents.length} rejected=${report.decision.rejectedEvents.length}${report.route.fallbackReason ? ` fallback=${report.route.fallbackReason}` : ''}`,
    `[state] ${report.stateDelta.summary}`,
  ];

  if (render.view === 'full' || render.view === 'raw') {
    lines.push(`[timeline] ${report.timeline.length} event(s) captured`);
  }

  const currentThoughts = options.omitCurrentThoughts ? null : renderCurrentThoughts(report.raw.latestTurn.trace?.llmCalls);
  if (currentThoughts) {
    lines.push('', currentThoughts);
  }

  if (report.narration.text) {
    lines.push('', report.narration.text);
  }

  lines.push('', 'Hint: :inspect trace --view full | :inspect council | :inspect route');
  return lines.join('\n');
}

function parseCommandTree(argv: string[], defaults: GlobalOptions): { command: ParsedCommand; options: GlobalOptions } {
  const options = { ...defaults };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    switch (token) {
      case '--json':
        options.json = true;
        break;
      case '--raw':
        options.raw = true;
        options.view = 'raw';
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--diff':
        options.diff = true;
        break;
      case '--no-narration':
        options.noNarration = true;
        break;
      case '--session':
        options.sessionId = expectOptionValue(argv, ++index, '--session');
        break;
      case '--world':
        options.worldId = expectOptionValue(argv, ++index, '--world');
        break;
      case '--view':
        options.view = parseView(expectOptionValue(argv, ++index, '--view'));
        break;
      case '--style':
        options.narratorStyle = parseNarratorStyle(expectOptionValue(argv, ++index, '--style'));
        break;
      case '--reasoning':
        options.gmReasoningEffort = parseReasoning(expectOptionValue(argv, ++index, '--reasoning'));
        break;
      case '--api-mode':
        options.apiMode = resolveCliApiMode(expectOptionValue(argv, ++index, '--api-mode'));
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  if (!positionals.length) {
    return { command: { kind: 'play' }, options };
  }

  const [first, second, ...rest] = positionals;
  if (first === 'help') return { command: { kind: 'help' }, options };
  if (first === 'play') return { command: { kind: 'play' }, options };
  if (first === 'turn' && second === 'run') return { command: { kind: 'turn-run', text: requireText(rest, 'turn run') }, options };
  if (first === 'turn' && second === 'explain') return { command: { kind: 'turn-explain', text: requireText(rest, 'turn explain') }, options };
  if (first === 'inspect' && isInspectTarget(second)) return { command: { kind: 'inspect', target: second }, options };
  if (first === 'staff' && second === 'ask') return { command: { kind: 'staff-ask', question: requireText(rest, 'staff ask') }, options };
  if (first === 'staff' && second === 'interactive') return { command: { kind: 'staff-interactive' }, options };
  if (first === 'session' && second === 'new') return { command: { kind: 'session-new', requestedSessionId: rest[0] }, options };
  if (first === 'session' && second === 'resume') return { command: { kind: 'session-resume', sessionId: requireSingle(rest[0], 'session resume <sessionId>') }, options };
  if (first === 'session' && second === 'list') return { command: { kind: 'session-list' }, options };
  if (first === 'worlds' && second === 'list') return { command: { kind: 'worlds-list' }, options };

  throw new Error(`Unknown command: ${positionals.join(' ')}`);
}

async function resolveTargetSessionId(operator: OperatorCliEngine, sessionId?: string): Promise<string> {
  if (sessionId) return sessionId;
  const sessions = await operator.listSessions();
  if (!sessions.length) {
    throw new Error('No sessions found. Create one with `chronicle session new` or run `chronicle play`.');
  }
  return sessions[0]!.sessionId;
}

function toRenderOptions(options: GlobalOptions): RenderOptions {
  return {
    view: options.view,
    raw: options.raw,
    verbose: options.verbose,
    diff: options.diff,
    noNarration: options.noNarration,
  };
}

function expectOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function requireText(tokens: string[], command: string): string {
  const text = tokens.join(' ').trim();
  if (!text) throw new Error(`${command} requires text`);
  return text;
}

function requireSingle(value: string | undefined, usage: string): string {
  if (!value) throw new Error(`Usage: ${usage}`);
  return value;
}

function parseView(value: string): OperatorViewMode {
  if (value === 'summary' || value === 'operator' || value === 'full' || value === 'raw') return value;
  throw new Error('--view must be one of summary|operator|full|raw');
}

function parseNarratorStyle(value: string): NarratorStyle {
  if (value === 'lyric' || value === 'cinematic' || value === 'michener') return value;
  throw new Error('--style must be one of lyric|cinematic|michener');
}

function parseReasoning(value: string): GMReasoningEffort {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  throw new Error('--reasoning must be one of low|medium|high');
}

function isInspectTarget(value: string | undefined): value is InspectTarget {
  return value === 'session'
    || value === 'state'
    || value === 'route'
    || value === 'steward'
    || value === 'council'
    || value === 'trace'
    || value === 'history'
    || value === 'artifacts'
    || value === 'prompts'
    || value === 'world';
}

function effectiveApiKey(apiKey: string | undefined, apiMode: CliApiMode): string | undefined {
  return apiMode === 'fallback' ? undefined : apiKey;
}

function createTerminal(): CliTerminal {
  const rl = readline.createInterface({ input, output });
  const queuedLines: string[] = [];
  let pendingResolve: ((line: string | null) => void) | undefined;
  let closed = false;

  rl.on('line', line => {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = undefined;
      resolve(line);
      return;
    }
    queuedLines.push(line);
  });

  rl.on('close', () => {
    closed = true;
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = undefined;
      resolve(null);
    }
  });

  return {
    isTTY: () => Boolean(input.isTTY && output.isTTY),
    write: text => {
      output.write(text);
    },
    readLine: (prompt: string) => {
      output.write(prompt);
      if (queuedLines.length) {
        return Promise.resolve(queuedLines.shift() ?? null);
      }
      if (closed) {
        return Promise.resolve(null);
      }
      return new Promise<string | null>(resolve => {
        pendingResolve = resolve;
      });
    },
    supportsTransientStatus: () => Boolean(input.isTTY && output.isTTY),
    renderTransientStatus: text => {
      output.write(`\x1b[2K\r${text}`);
    },
    clearTransientStatus: () => {
      output.write('\x1b[2K\r');
    },
    close: () => rl.close(),
  };
}

function shouldUseAnsi(env: NodeJS.ProcessEnv): boolean {
  if (env.NO_COLOR) return false;
  if (env.TERM === 'dumb') return false;
  return true;
}

function playPrompt(state: PlayState): string {
  return `[${state.worldId} turn:${state.sessionId.slice(0, 8)}] > `;
}

function playHelpText(): string {
  return [
    'Play commands:',
    '  :help',
    '  :inspect session|state|route|steward|council|trace|history|artifacts|prompts|world [--view <summary|operator|full|raw>] [--json]',
    '  :session new [sessionId]',
    '  :session resume <sessionId>',
    '  :session list',
    '  :staff ask "<question>"',
    '  :style <lyric|cinematic|michener>',
    '  :reasoning <low|medium|high>',
    '  :mode <auto|fallback|live>',
    '  :exit',
    '',
    'Legacy slash commands still work temporarily:',
    '  /help /state /session /new /style /reasoning /debug /trace /detail /exit',
  ].join('\n');
}

function helpText(): string {
  return [
    'Chronicle operator CLI',
    '',
    'Commands:',
    '  chronicle play',
    '  chronicle turn run "<text>"',
    '  chronicle turn explain "<text>"',
    '  chronicle inspect session|state|route|steward|council|trace|history|artifacts|prompts|world [--session <id>]',
    '  chronicle staff ask "<question>"',
    '  chronicle staff interactive',
    '  chronicle session new [sessionId] [--world <id>]',
    '  chronicle session resume <sessionId>',
    '  chronicle session list',
    '  chronicle worlds list',
    '',
    'Flags:',
    '  --json',
    '  --raw',
    '  --verbose',
    '  --diff',
    '  --no-narration',
    '  --view <summary|operator|full|raw>',
    '  --session <id>',
    '  --world <id>',
    '  --style <lyric|cinematic|michener>',
    '  --reasoning <low|medium|high>',
    '  --api-mode <auto|fallback|live>',
  ].join('\n');
}

function tokenizeCommandLine(inputText: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < inputText.length; index += 1) {
    const char = inputText[index]!;
    if (quote) {
      if (char === '\\' && index + 1 < inputText.length) {
        current += inputText[index + 1]!;
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function mapLegacySlashCommand(head: string, rest: string[]): { tokens: string[]; deprecationNotice?: string } {
  switch (head) {
    case 'state':
      return { tokens: ['inspect', 'state'], deprecationNotice: 'Deprecated slash command: use `:inspect state`.' };
    case 'session':
      return { tokens: ['inspect', 'session'], deprecationNotice: 'Deprecated slash command: use `:inspect session`.' };
    case 'new':
      return { tokens: ['session', 'new', ...rest], deprecationNotice: 'Deprecated slash command: use `:session new`.' };
    case 'help':
      return { tokens: ['help'] };
    case 'exit':
      return { tokens: ['exit'] };
    default:
      return { tokens: [head, ...rest], deprecationNotice: rest.length || head !== 'inspect' ? 'Deprecated slash command.' : undefined };
  }
}

function isNarratorStyle(value: string | undefined): value is NarratorStyle {
  return value === 'lyric' || value === 'cinematic' || value === 'michener';
}

function isReasoningLevel(value: string | undefined): value is GMReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high';
}

function prettyJSON(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatError(error: unknown): string {
  if (isChronicleError(error)) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
