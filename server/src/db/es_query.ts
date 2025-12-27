/**
 * Elasticsearch query building functions.
 * Converts SearchQuery objects to Elasticsearch query DSL.
 */

import { Client } from '@elastic/elasticsearch';
import SearchQuery from '../common/SearchQuery.js';

/**
 * Convert SearchQuery to Elasticsearch query
 */
export function searchQueryToEsQuery(sq: SearchQuery | string | null | undefined): any {
  if (!sq) {
    return { match_all: {} };
  }

  const searchQuery = typeof sq === 'string' ? new SearchQuery(sq) : sq;
  if (!searchQuery.tree || searchQuery.tree.length === 0) {
    return { match_all: {} };
  }

  return buildEsQuery(searchQuery.tree);
}

/**
 * Process a single bit/item into an Elasticsearch query
 */
function buildEsQuery_oneBit(bit: any): any {
  if (typeof bit === 'string') {
    return { match: { _all: bit } };
  }
  if (typeof bit === 'object' && !Array.isArray(bit)) {
    const keys = Object.keys(bit);
    if (keys.length === 1) {
      const key = keys[0];
      let value = bit[key];
      // Handle unset (missing/null field)
      if (value === 'unset') {
        return { bool: { must_not: { exists: { field: key } } } };
      }
      // Convert string numbers to actual numbers for numeric fields
      if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        value = parseInt(value, 10);
      } else if (typeof value === 'string' && /^-?\d*\.\d+$/.test(value)) {
        value = parseFloat(value);
      }
      return { term: { [key]: value } };
    }
  }
  return buildEsQuery(Array.isArray(bit) ? bit : [bit]);
}

/**
 * Build Elasticsearch query from parse tree
 */
export function buildEsQuery(tree: any[]): any {
  if (typeof tree === 'string') {
    return { match: { _all: tree } };
  }

  if (tree.length === 1) {
    return buildEsQuery_oneBit(tree[0]);
  }

  const op = tree[0];
  const bits = tree.slice(1);
  const queries = bits.map((bit: any) => buildEsQuery_oneBit(bit));

  if (op === 'OR') {
    return { bool: { should: queries, minimum_should_match: 1 } };
  } else {
    return { bool: { must: queries } };
  }
}

/**
 * Build filter clauses from a filters object.
 */
function buildFilterClauses(filters?: Record<string, string>): any[] {
  if (!filters) return [];
  return Object.entries(filters)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({ term: { [key]: value } }));
}

/**
 * Get sort field based on index name (examples use 'created', spans use '@timestamp').
 */
function getSortField(indexName: string): string {
  return indexName.includes('examples') ? 'created' : '@timestamp';
}

/**
 * Merge unindexed_attributes back into attributes for search results.
 */
function mergeUnindexedAttributes(hit: any): any {
  if (!hit.unindexed_attributes) return hit;
  return {
    ...hit,
    attributes: { ...hit.attributes, ...hit.unindexed_attributes }
  };
}

/**
 * Extract total count from Elasticsearch response (handles both formats).
 */
function extractTotal(total: number | { value: number }): number {
  return typeof total === 'number' ? total : total.value;
}

/**
 * Generic search function for Elasticsearch
 */
export async function searchEntities<T>(
  client: Client,
  indexName: string,
  searchQuery?: SearchQuery | string | null,
  filters?: Record<string, string>,
  limit: number = 100,
  offset: number = 0
): Promise<{ hits: T[]; total: number }> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  const baseQuery = searchQueryToEsQuery(searchQuery);
  const mustClauses: any[] = [];

  // Add the search query if it's not match_all
  if (!baseQuery.match_all) {
    mustClauses.push(baseQuery);
  }

  // Add filters
  mustClauses.push(...buildFilterClauses(filters));

  // If no must clauses, use match_all
  if (mustClauses.length === 0) {
    mustClauses.push({ match_all: {} });
  }

  const result = await client.search<T>({
    index: indexName,
    query: { bool: { must: mustClauses } },
    size: limit,
    from: offset,
    sort: [{ [getSortField(indexName)]: { order: 'desc' } }]
  });

  const hits = (result.hits.hits || [])
    .map((hit: any) => hit._source!)
    .map(mergeUnindexedAttributes);
  const total = extractTotal(result.hits.total as number | { value: number });

  return { hits, total };
}

