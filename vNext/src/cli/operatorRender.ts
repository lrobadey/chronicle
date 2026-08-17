import type {
  CouncilInspection,
  LastRunExplainReport,
  OperatorViewMode,
  PromptInspection,
  SessionSummaryRow,
  StaffAskReport,
  StateInspection,
  StewardInspection,
  TraceTimelineEvent,
  TurnRouteSummary,
  TurnExecutionReport,
  TurnExplanation,
  TurnHistoryRow,
  WorldInspection,
} from './operatorEngine';
import type { TurnTrace } from '../engine/session/types';

export interface RenderOptions {
  view: OperatorViewMode;
  raw?: boolean;
  verbose?: boolean;
  diff?: boolean;
  noNarration?: boolean;
}

export function renderSessionSummary(summary: SessionSummaryRow): string {
  return joinSections([
    renderKeyValues('Session', [
      ['session', summary.sessionId],
      ['world', `${summary.worldDisplayName} (${summary.worldId})`],
      ['turn', String(summary.turn)],
      ['pending_prompt', summary.pendingPromptKind || 'none'],
      ['last_route', summary.lastRoute || 'none'],
      ['last_fallback', summary.lastFallbackReason || 'none'],
      ['updated_at', summary.updatedAtIso || 'n/a'],
    ]),
  ]);
}

export function renderRouteSummary(summary: TurnRouteSummary): string {
  return joinSections([
    renderKeyValues('Route', [
      ['classification', summary.classification || 'unknown'],
      ['owner', summary.ownerLabel],
      ['deterministic_owner', summary.deterministicOwner || 'none'],
      ['required_domains', formatList(summary.requiredDomains)],
      ['optional_domains', formatList(summary.optionalDomains)],
      ['held_beats', formatList(summary.heldBeatsToConsider)],
      ['pending_events', formatList(summary.pendingEventsToCheck)],
      ['council_domains', formatList(summary.councilDomains)],
      ['close_route', summary.closeRoute || 'none'],
      ['steward_handled', summary.stewardHandled ? 'yes' : 'no'],
      ['gm_handled', summary.gmHandled ? 'yes' : 'no'],
      ['fallback_reason', summary.fallbackReason || 'none'],
      ['rationale', summary.rationale || 'none'],
    ]),
  ]);
}

export function renderTurnExplanation(explanation: TurnExplanation, options: RenderOptions): string {
  const sections = [
    renderKeyValues('Explain', [
      ['session', explanation.sessionId || 'ephemeral'],
      ['world', `${explanation.worldDisplayName} (${explanation.worldId})`],
      ['classification', explanation.probableClassification],
      ['deterministic_owner', explanation.likelyDeterministicOwner || 'none'],
      ['required_domains', formatList(explanation.requiredDomains)],
      ['optional_domains', formatList(explanation.optionalDomains)],
      ['held_beats', formatList(explanation.heldBeatsToConsider)],
      ['pending_events', formatList(explanation.pendingEventsToCheck)],
      ['prompt_reply', explanation.promptReply || 'none'],
      ['needs_steward_judgment', explanation.wouldNeedStewardJudgment ? 'yes' : 'no'],
      ['predictive_only', explanation.predictiveOnly ? 'yes' : 'no'],
    ]),
    renderBlock('Why', explanation.why),
  ];

  if (isFullView(options)) {
    sections.push(renderRawBlock('Routing Summary', explanation.routingSummary));
  }

  return joinSections(sections);
}

export function renderTurnExecutionReport(report: TurnExecutionReport, options: RenderOptions): string {
  const sections: string[] = [];

  sections.push(renderKeyValues('Input', [
    ['session', report.input.sessionId],
    ['player', report.input.playerId],
    ['world', `${report.input.worldDisplayName} (${report.input.worldId})`],
    ['execution_mode', report.input.executionMode],
    ['raw_text', report.input.rawPlayerText],
    ['normalized_text', report.input.normalizedPlayerText || 'none'],
    ['pending_prompt_before', report.input.pendingPromptBefore?.kind || 'none'],
  ]));

  sections.push(renderKeyValues('Route', [
    ['classification', report.route.classification || 'unknown'],
    ['owner', report.route.ownerLabel],
    ['deterministic_owner', report.route.deterministicOwner || 'none'],
    ['required_domains', formatList(report.route.requiredDomains)],
    ['optional_domains', formatList(report.route.optionalDomains)],
    ['held_beats', formatList(report.route.heldBeatsToConsider)],
    ['pending_events', formatList(report.route.pendingEventsToCheck)],
    ['council_domains', formatList(report.route.councilDomains)],
    ['close_route', report.route.closeRoute || 'none'],
    ['fallback_reason', report.route.fallbackReason || 'none'],
    ['rationale', report.route.rationale || 'none'],
  ]));

  if (options.verbose || isFullView(options)) {
    sections.push(renderKeyValues('Preflight', [
      ['pending_prompt_active', report.preflight.pendingPromptActive ? 'yes' : 'no'],
      ['pending_prompt_kind', report.preflight.pendingPromptKind || 'none'],
      ['prompt_reply', report.preflight.promptReply || 'none'],
      ['deterministic_owner_candidate', report.preflight.deterministicOwnerCandidate || 'none'],
      ['attempted', report.preflight.attempted ? 'yes' : 'no'],
      ['handled', report.preflight.handled ? 'yes' : 'no'],
      ['notes', formatList(report.preflight.notes)],
    ]));
  }

  sections.push(renderCouncilInspection(report.council, options));

  sections.push(renderKeyValues('Decisions', [
    ['accepted_events', String(report.decision.acceptedEvents.length)],
    ['rejected_events', String(report.decision.rejectedEvents.length)],
    ['council_artifacts', String(report.decision.councilArtifacts.length)],
  ]));

  if (report.gmFallback) {
    sections.push(renderKeyValues('Legacy GM Fallback', [
      ['occurred', 'yes'],
      ['reason', report.gmFallback.reason || 'none'],
      ['summary', report.gmFallback.summary || 'none'],
      ['candidate_events', String(report.gmFallback.candidateEvents.length)],
      ['reasoning_notes', formatList(report.gmFallback.reasoningNotes)],
    ]));
  }

  sections.push(renderKeyValues('State Delta', [
    ['summary', report.stateDelta.summary],
    ['time_delta_minutes', String(report.stateDelta.timeDeltaMinutes)],
    ['moved', report.stateDelta.moved ? 'yes' : 'no'],
    ['new_location', report.stateDelta.newLocationName || 'none'],
    ['new_items', formatList(report.stateDelta.newItems)],
    ['new_clues', formatList(report.stateDelta.newClues)],
  ]));

  const currentThoughts = renderCurrentThoughts(report.raw.latestTurn.trace?.llmCalls);
  if (currentThoughts) {
    sections.push(currentThoughts);
  }

  if (options.diff || isFullView(options)) {
    sections.push(renderRawBlock('State Delta Detail', {
      before: report.stateDelta.before,
      after: report.stateDelta.after,
      acceptedEvents: report.stateDelta.acceptedEvents,
    }));
  }

  if (!options.noNarration) {
    sections.push(renderKeyValues('Narration', [
      ['invoked', report.narration.invoked ? 'yes' : 'no'],
      ['source', report.narration.source],
      ['style', report.narration.style || 'unknown'],
    ]));
    sections.push(renderBlock('Narration Text', report.narration.text || '(none)'));
  }

  if (isFullView(options)) {
    sections.push(renderKeyValues('Persistence', [
      ['turn', String(report.persistence.turn)],
      ['turn_record_saved', report.persistence.turnRecordSaved ? 'yes' : 'no'],
      ['snapshot_saved', report.persistence.snapshotSaved ? 'yes' : 'no'],
      ['pending_prompt_after', report.persistence.pendingPromptAfter?.kind || 'none'],
    ]));
    sections.push(renderRawBlock('Steward', {
      routingSummary: report.steward.routingSummary,
      memory: report.steward.memory,
      finishInput: report.steward.finishInput,
    }));
  }

  if (isRawView(options)) {
    sections.push(renderRawBlock('Raw Trace', report.raw.trace));
    sections.push(renderRawBlock('Raw Debug Events', report.raw.debugEvents));
    sections.push(renderRawBlock('Raw Turn Record', report.raw.latestTurn));
  }

  return joinSections(sections);
}

export function renderCouncilInspection(inspection: CouncilInspection, options: RenderOptions): string {
  const blocks = inspection.domains.map(domain => {
    const lines = [
      `ran=${domain.ran ? 'yes' : 'no'}`,
      `task_id=${domain.taskId || 'none'}`,
      `directive=${domain.directive || 'none'}`,
      `priority=${domain.priority || 'none'}`,
      `summary=${domain.summary || 'none'}`,
      `warnings=${formatList(domain.warnings)}`,
      `confidence=${domain.confidence == null ? 'n/a' : String(domain.confidence)}`,
      `proposed_events=${domain.proposedEventCount}`,
      `artifact=${domain.artifact ? domain.artifact.domain : 'none'}`,
    ];

    if (options.verbose || isFullView(options)) {
      lines.push(`context=${domain.contextSummary || 'none'}`);
      lines.push(`execution_ms=${domain.executionMs == null ? 'n/a' : String(domain.executionMs)}`);
    }

    const body = [`[${domain.domain}]`, ...lines.map(line => `  ${line}`)].join('\n');
    if (isRawView(options)) {
      return `${body}\n${indent(prettyJSON({ context: domain.context, resultDetail: domain.resultDetail }), 2)}`;
    }
    return body;
  });

  return renderBlock('Dispatch', blocks.join('\n\n') || '(no council work)');
}

export function renderStewardInspection(inspection: StewardInspection, options: RenderOptions): string {
  const sections = [
    renderKeyValues('Steward Memory', [
      ['current_goals', formatList(inspection.currentGoals)],
      ['working_hypotheses', formatList(inspection.workingHypotheses)],
      ['intended_beats', formatList(inspection.intendedBeats)],
      ['deferred_questions', formatList(inspection.deferredQuestions)],
      ['continuity_notes', formatList(inspection.continuityNotes)],
      ['last_steward_owned_outcome', inspection.lastStewardOwnedOutcome || 'none'],
      ['last_steward_triggered_fallback', inspection.lastStewardTriggeredFallback || 'none'],
    ]),
  ];

  if (inspection.mostRecentRoutingSummary) {
    sections.push(renderKeyValues('Latest Route', [
      ['classification', inspection.mostRecentRoutingSummary.classification || 'unknown'],
      ['owner', inspection.mostRecentRoutingSummary.ownerLabel],
      ['fallback_reason', inspection.mostRecentRoutingSummary.fallbackReason || 'none'],
    ]));
  }

  if (isFullView(options)) {
    sections.push(renderRawBlock('Per-Turn Memory Changes', inspection.perTurnMemoryChanges));
    sections.push(renderRawBlock('Latest finish_steward_turn Payload', inspection.latestFinishStewardPayload));
    sections.push(renderRawBlock('Council Results Visible At Close', inspection.councilResultsVisibleAtClose));
  }

  return joinSections(sections);
}

export function renderPromptInspection(inspection: PromptInspection, options: RenderOptions): string {
  const sections = [
    renderKeyValues('Prompt', [
      ['session', inspection.sessionId],
      ['kind', inspection.pendingPrompt?.kind || 'none'],
      ['question', inspection.pendingPrompt?.question || 'none'],
      ['options', inspection.pendingPrompt?.options?.map(option => `${option.key}:${option.label}`).join(', ') || 'none'],
      ['data', inspection.pendingPrompt?.data ? prettyJSON(inspection.pendingPrompt.data) : 'none'],
    ]),
  ];

  if (inspection.deterministicReplyHandlers && (options.verbose || isFullView(options))) {
    sections.push(renderRawBlock('Deterministic Reply Handlers', inspection.deterministicReplyHandlers));
  }

  return joinSections(sections);
}

export function renderStateInspection(state: StateInspection, options: RenderOptions): string {
  const sections = [
    renderKeyValues('Session', [
      ['session', state.sessionId],
      ['world', `${state.worldDisplayName} (${state.worldId})`],
      ['turn', String(state.telemetry.turn)],
      ['pending_prompt', state.pendingPrompt?.kind || 'none'],
    ]),
    renderKeyValues('Location', [
      ['location', `${state.telemetry.location.name} (${state.telemetry.location.id || 'none'})`],
      ['description', state.telemetry.location.description],
      ['time', state.telemetry.time.absoluteIso],
      ['weather', state.telemetry.weather.type],
      ['tide', state.telemetry.tide.phase],
    ]),
    renderKeyValues('Nearby', [
      ['locations', formatList(state.telemetry.nearbyLocations.map(location => `${location.name}@${location.distance}`))],
      ['actors', formatList(state.telemetry.nearbyActors.map(actor => `${actor.name}@${actor.distance}`))],
      ['inventory', formatList(state.telemetry.player.inventory.map(item => item.name))],
      ['ledger_tail', formatList(state.telemetry.ledgerTail)],
      ['scheduled_processes', String(state.telemetry.scheduledProcesses.count)],
    ]),
  ];

  if (isFullView(options)) {
    sections.push(renderRawBlock('Director State', state.directorState));
  }

  return joinSections(sections);
}

export function renderTraceTimeline(timeline: TraceTimelineEvent[], options: RenderOptions): string {
  if (!timeline.length) return renderBlock('Trace', '(no trace available)');
  const lines = timeline.map(event => {
    const header = `${String(event.index + 1).padStart(2, '0')}. [${event.phase}] ${event.kind} :: ${event.summary}`;
    const reasoning = renderReasoningHeadings(event.reasoningHeadings);
    if (isRawView(options)) {
      return `${header}\n${indent(prettyJSON(event.data), 2)}`;
    }
    if (isFullView(options) && event.data != null) {
      return `${header}${reasoning ? `\n${indent(reasoning, 2)}` : ''}\n${indent(prettyJSON(event.data), 2)}`;
    }
    return reasoning ? `${header}\n${indent(reasoning, 2)}` : header;
  });
  return renderBlock('Trace', lines.join('\n'));
}

export function renderCurrentThoughts(llmCalls: TurnTrace['llmCalls'] | undefined): string | null {
  const lines = groupReasoningHeadings(llmCalls).map(group => `${group.agent}: ${group.headings.join('; ')}`);
  return lines.length ? renderBlock('Current Thoughts', lines.join('\n')) : null;
}

export function renderHistory(rows: TurnHistoryRow[]): string {
  if (!rows.length) return renderBlock('History', '(no turns)');
  const table = rows.map(row =>
    [
      `turn=${row.turn}`,
      `route=${row.route || 'unknown'}`,
      `domains=${formatList(row.domains)}`,
      `accepted=${row.acceptedEventCount}`,
      `rejected=${row.rejectedEventCount}`,
      `fallback=${row.fallback ? 'yes' : 'no'}`,
      `prompt=${row.pendingPrompt || 'none'}`,
      `input=${row.playerText}`,
      `narration=${row.narrationSummary || 'none'}`,
    ].join(' | '),
  );
  return renderBlock('History', table.join('\n'));
}

export function renderArtifacts(artifacts: Array<{
  turn: number;
  atIso: string;
  domain: string;
  artifactType: string;
  summary: string;
  relationToOutcome: string;
}>): string {
  if (!artifacts.length) return renderBlock('Artifacts', '(none)');
  return renderBlock('Artifacts', artifacts.map(artifact =>
    `turn=${artifact.turn} | domain=${artifact.domain} | type=${artifact.artifactType} | outcome=${artifact.relationToOutcome} | summary=${artifact.summary}`,
  ).join('\n'));
}

export function renderWorldInspection(world: WorldInspection, options: RenderOptions): string {
  const sections = [
    renderKeyValues('World', [
      ['session', world.sessionId],
      ['id', world.world.id],
      ['display_name', world.world.displayName],
      ['actors', String(world.counts.actors)],
      ['items', String(world.counts.items)],
      ['locations', String(world.counts.locations)],
      ['factions', String(world.counts.factions)],
      ['scheduled_processes', String(world.counts.scheduledProcesses)],
    ]),
  ];

  if (isFullView(options)) {
    sections.push(renderRawBlock('World Metadata', {
      metadata: world.world.metadata,
      cliTheme: world.world.cliTheme,
    }));
  }

  return joinSections(sections);
}

export function renderLastRunExplain(report: LastRunExplainReport, options: RenderOptions): string {
  if (report.status === 'no_completed_run') {
    return renderBlock('Last Run Explain', report.message);
  }

  const sections: string[] = [
    renderKeyValues('Last Run', [
      ['session', report.sessionId || 'none'],
      ['world', report.worldDisplayName && report.worldId ? `${report.worldDisplayName} (${report.worldId})` : 'unknown'],
      ['turns', String(report.turnCount)],
      ['fallback_turns', String(report.fallbackTurnCount)],
      ['updated_at', report.lastUpdatedAtIso || 'n/a'],
      ['summary', report.summary],
    ]),
  ];

  for (const turn of report.turns) {
    const lines = [
      `When the player said: ${JSON.stringify(turn.playerText)}`,
      `Route Chronicle took: ${turn.routeClassification}`,
      `Owning subsystem: ${turn.ownerLabel}`,
      `Why that subsystem owned it: ${turn.ownerSummary}`,
      'Major decisions:',
      ...turn.majorDecisions.map(item => `- ${item}`),
      `Fallback use: ${turn.fallbackSummary}`,
      `State change: ${turn.stateDeltaSummary}`,
      `Narration outcome: ${turn.narrationOutcome}`,
    ];

    if (isFullView(options)) {
      lines.push(`Council domains: ${formatList(turn.councilDomains)}`);
      lines.push('');
      lines.push('Route detail:');
      lines.push(indent(prettyJSON(turn.raw.route), 2));
      lines.push('');
      lines.push('Decision detail:');
      lines.push(indent(prettyJSON(turn.raw.decision), 2));
    }

    if (isRawView(options)) {
      lines.push('');
      lines.push('Raw turn detail:');
      lines.push(indent(prettyJSON(turn.raw), 2));
    }

    sections.push(renderBlock(`Turn ${turn.turn}`, lines.join('\n')));
  }

  return joinSections(sections);
}

export function renderStaffAskReport(report: StaffAskReport, options: RenderOptions): string {
  const sections = [
    renderKeyValues('Staff', [
      ['session', report.sessionId],
      ['source', report.source],
      ['current_understanding', report.diagnostics.currentUnderstanding],
      ['known_goals', formatList(report.diagnostics.knownGoals)],
      ['missing_context', formatList(report.diagnostics.missingContext)],
      ['friction_points', formatList(report.diagnostics.frictionPoints)],
      ['improvement_ideas', formatList(report.diagnostics.improvementIdeas)],
      ['suggested_questions', formatList(report.diagnostics.suggestedQuestions)],
      ['confidence_notes', formatList(report.diagnostics.confidenceNotes)],
    ]),
    renderBlock('Employee Reply', report.employeeReply),
  ];

  if (isFullView(options)) {
    sections.push(renderRawBlock('Staff Context', report.context));
  }

  return joinSections(sections);
}

export function renderSessionList(sessions: SessionSummaryRow[]): string {
  if (!sessions.length) return renderBlock('Sessions', '(none)');
  const rows = sessions.map(session =>
    `session=${session.sessionId} | world=${session.worldDisplayName} | turn=${session.turn} | pending=${session.pendingPromptKind || 'none'} | updated=${session.updatedAtIso || 'n/a'}`,
  );
  return renderBlock('Sessions', rows.join('\n'));
}

export function renderWorldList(worlds: Array<{
  id: string;
  displayName: string;
  summary: string | null;
}>): string {
  if (!worlds.length) return renderBlock('Worlds', '(none)');
  return renderBlock('Worlds', worlds.map(world =>
    `${world.id} | ${world.displayName}${world.summary ? ` | ${world.summary}` : ''}`,
  ).join('\n'));
}

function renderKeyValues(title: string, entries: Array<[string, string]>): string {
  return renderBlock(title, entries.map(([key, value]) => `${key}: ${value}`).join('\n'));
}

function renderBlock(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

function renderRawBlock(title: string, value: unknown): string {
  return renderBlock(title, prettyJSON(value));
}

function renderReasoningHeadings(headings: string[] | undefined): string | null {
  const cleaned = cleanHeadings(headings);
  return cleaned.length ? `reasoning: ${cleaned.join('; ')}` : null;
}

function groupReasoningHeadings(llmCalls: TurnTrace['llmCalls'] | undefined): Array<{ agent: string; headings: string[] }> {
  const groups: Array<{ agent: string; headings: string[] }> = [];
  for (const call of llmCalls || []) {
    const headings = cleanHeadings(call.reasoningHeadings);
    if (!headings.length) continue;
    const existing = groups.find(group => group.agent === call.agent);
    if (existing) {
      existing.headings.push(...headings);
    } else {
      groups.push({ agent: call.agent, headings: [...headings] });
    }
  }
  return groups;
}

function cleanHeadings(headings: string[] | undefined): string[] {
  return (headings || []).map(heading => heading.trim()).filter(Boolean);
}

function prettyJSON(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '"[unserializable]"';
  }
}

function joinSections(sections: Array<string | null | undefined>): string {
  return sections.filter(Boolean).join('\n\n');
}

function formatList(values: string[]): string {
  return values.length ? values.join(', ') : 'none';
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return value
    .split('\n')
    .map(line => `${prefix}${line}`)
    .join('\n');
}

function isFullView(options: RenderOptions): boolean {
  return options.view === 'full' || options.view === 'raw';
}

function isRawView(options: RenderOptions): boolean {
  return options.raw === true || options.view === 'raw';
}
