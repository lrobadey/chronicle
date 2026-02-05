import type { ActorId, GridPos, ItemId } from './state';

export interface EventMeta {
  id: string;
  turn: number;
  by: 'player' | 'gm' | 'system';
  actorId?: ActorId;
}

export type WorldEvent =
  | {
      meta?: EventMeta;
      type: 'MoveActor';
      actorId: ActorId;
      to: GridPos;
      toLocationId?: string;
      mode?: 'walk' | 'run';
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'PickUpItem';
      actorId: ActorId;
      itemId: ItemId;
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'DropItem';
      actorId: ActorId;
      itemId: ItemId;
      at?: GridPos;
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'Speak';
      actorId: ActorId;
      text: string;
      toActorId?: ActorId;
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'AdvanceTime';
      minutes: number;
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'CreateEntity';
      entity:
        | { kind: 'item'; data: { id: ItemId; name: string; description?: string; location: { kind: 'ground'; pos: GridPos } } }
        | { kind: 'npc'; data: { id: ActorId; name: string; pos: GridPos } }
        | { kind: 'location'; data: { id: string; name: string; description: string; anchor: GridPos } };
      note?: string;
    }
  | {
      meta?: EventMeta;
      type: 'SetFlag';
      key: string;
      value: unknown;
      note?: string;
    };
