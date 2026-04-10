import type { SystemsDesignerResultDetail } from '../council';
import type { StewardCloseInput, StewardCloseResult } from './types';

function emptyAgendaUpdates() {
  return {};
}

export function closeStewardTurn(input: StewardCloseInput): StewardCloseResult {
  const domains = input.councilResults.map(packet => packet.result.domain);
  const systemsPacket = input.councilResults.find(packet => packet.result.domain === 'systems');

  if (!systemsPacket) {
    return {
      handled: false,
      fallbackReason: 'systems_result_missing',
      summary: 'Steward fell back because no systems council result was returned.',
      proposedEvents: [],
      acceptedEvents: [],
      rejectedEvents: [],
      agendaUpdates: emptyAgendaUpdates(),
      directorUpdates: null,
      narratorHandoff: { kind: 'legacy', packet: null },
      trace: {
        route: 'fallback_to_gm',
        reason: 'systems_result_missing',
        councilDomains: domains,
      },
    };
  }

  const detail = (systemsPacket.result.detail || null) as SystemsDesignerResultDetail | null;
  if (!detail?.handled || !detail.narratorPacket) {
    return {
      handled: false,
      fallbackReason: detail?.fallbackReason || 'systems_result_unhandled',
      summary: systemsPacket.result.summary,
      proposedEvents: [],
      acceptedEvents: [],
      rejectedEvents: [],
      agendaUpdates: emptyAgendaUpdates(),
      directorUpdates: null,
      narratorHandoff: { kind: 'legacy', packet: null },
      trace: {
        route: 'fallback_to_gm',
        reason: detail?.fallbackReason || 'systems_result_unhandled',
        councilDomains: domains,
      },
    };
  }

  return {
    handled: true,
    summary: systemsPacket.result.summary,
    proposedEvents: systemsPacket.result.proposedEvents,
    acceptedEvents: [],
    rejectedEvents: [],
    agendaUpdates: emptyAgendaUpdates(),
    directorUpdates: null,
    narratorHandoff: {
      kind: 'systems_v1',
      packet: detail.narratorPacket,
    },
    trace: {
      route: 'systems_council',
      councilDomains: domains,
    },
  };
}
