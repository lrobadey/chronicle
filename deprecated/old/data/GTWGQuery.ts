// GTWGQuery.ts - Fluent, composable query builder for the Ground-Truth World Graph
// NOTE: Pure in-memory operations only; does not mutate GTWG.

import type { GTWG, GTWGEntity, GTWGRelationType, GTWGEntityType } from '../types/GTWGTypes';

export type QueryDirection = 'out' | 'in' | 'both';

export class GTWGQuery {
  private readonly gtwg: GTWG;
  private readonly ids: Set<string>; // current working set

  constructor(gtwg: GTWG, ids?: Iterable<string>) {
    this.gtwg = gtwg;
    this.ids = new Set(ids ?? gtwg.entities.map(e => e.id));
  }

  // --- internal helper to spawn a new query with a reduced id set ---
  private next(ids: Iterable<string>): GTWGQuery {
    return new GTWGQuery(this.gtwg, ids);
  }

  // ---------------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------------

  /** Filter by entity type (single or array). */
  filterByType(type: GTWGEntityType | GTWGEntityType[]): GTWGQuery {
    const typeArr = Array.isArray(type) ? type : [type];
    const newIds = Array.from(this.ids).filter(id => {
      const entity = this.gtwg.entities.find(e => e.id === id);
      return entity ? typeArr.includes(entity.type) : false;
    });
    return this.next(newIds);
  }

  /** Filter by property value or predicate. Checks both top-level keys and properties.* */
  filterByProperty(key: string, matcher: any | ((value: any) => boolean)): GTWGQuery {
    const predicate: (v: any) => boolean =
      typeof matcher === 'function'
        ? (matcher as (value: any) => boolean)
        : (v: any) => {
            if (Array.isArray(matcher)) return matcher.includes(v);
            return v === matcher;
          };

    const newIds = Array.from(this.ids).filter(id => {
      const entity = this.gtwg.entities.find(e => e.id === id);
      if (!entity) return false;
      const val = (entity as any)[key] ?? (entity as any).properties?.[key];
      return predicate(val);
    });
    return this.next(newIds);
  }

  // ---------------------------------------------------------------------------
  // Graph Traversal
  // ---------------------------------------------------------------------------

  /** Expand to entities connected by a relation type. */
  getConnected(relationType?: GTWGRelationType, direction: QueryDirection = 'out'): GTWGQuery {
    const relatedIds = new Set<string>();

    const includeRelation = (type: string) => !relationType || type === relationType;

    this.gtwg.relations.forEach(rel => {
      if (direction === 'out' || direction === 'both') {
        if (this.ids.has(rel.from) && includeRelation(rel.type)) {
          relatedIds.add(rel.to);
        }
      }
      if (direction === 'in' || direction === 'both') {
        if (this.ids.has(rel.to) && includeRelation(rel.type)) {
          relatedIds.add(rel.from);
        }
      }
    });

    return this.next(relatedIds);
  }

  // ---------------------------------------------------------------------------
  // Termination
  // ---------------------------------------------------------------------------
  execute(): GTWGEntity[] {
    return Array.from(this.ids).map(id => this.gtwg.entities.find(e => e.id === id)!).filter(Boolean);
  }
}
