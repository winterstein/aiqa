/**
 * Elasticsearch operations for storing and querying OpenTelemetry spans and examples.
 * 
 * Lifecycle: Call initClient() before any operations, closeClient() during shutdown.
 * All functions throw if client not initialized. Uses two indices: 'traces' for spans, 'DATASET_EXAMPLES' for examples.
 */

import { Client } from '@elastic/elasticsearch';
import Span from '../common/types/Span.js';
import SearchQuery from '../common/SearchQuery.js';
import { loadSchema, jsonSchemaToEsMapping, getTypeDefinition } from '../common/utils/schema-loader.js';
import { searchEntities as searchEntitiesEs } from './es_query.js';
import Example from '../common/types/Example.js';

let client: Client | null = null;
const SPAN_INDEX = process.env.SPANS_INDEX || 'aiqa_spans';
const SPAN_INDEX_ALIAS = process.env.SPANS_INDEX_ALIAS || 'aiqa_spans_alias';
const DATASET_EXAMPLES_INDEX = process.env.DATASET_EXAMPLES_INDEX || 'aiqa_dataset_examples';
const DATASET_EXAMPLES_INDEX_ALIAS = process.env.DATASET_EXAMPLES_INDEX_ALIAS || 'aiqa_dataset_examples_alias';

/**
 * Initialize Elasticsearch client. Must be called before any operations.
 */
export function initClient(elasticsearchUrl: string = 'http://localhost:9200'): void {
  client = new Client({
    node: elasticsearchUrl,
    requestTimeout: 10000,
  });
}

export function getClient(): Client {
  if (!client) {
    throw new Error('Elasticsearch client not initialized. Call initClient() first.');
  }
  return client;
}

/**  Recursively generate Elasticsearch mappings from JSON Schema properties */
function generateEsMappingsFromSchema(properties: Record<string, any>): Record<string, any> {
  const mappings: Record<string, any> = {};
  
  for (const [fieldName, prop] of Object.entries(properties)) {
    // Special handling: use 'flattened' type for all 'attributes' fields to avoid mapping explosion
    if (fieldName === 'attributes' && prop.type === 'object') {
      mappings[fieldName] = { type: 'flattened' };
      continue;
    }
    
    // Special handling for HrTime fields (startTime, endTime, duration)
    // These are arrays of [seconds, nanoseconds] that we'll convert to milliseconds (long)
    if ((fieldName === 'startTime' || fieldName === 'endTime' || fieldName === 'duration') &&
        prop.type === 'array' && prop.items?.type === 'integer' && 
        prop.minItems === 2 && prop.maxItems === 2) {
      mappings[fieldName] = { type: 'long' };
      continue;
    }
    
    const baseMapping = jsonSchemaToEsMapping(prop, fieldName);
    
    // If it's an object type, recursively process nested properties
    if (prop.type === 'object' && prop.properties) {
      baseMapping.properties = generateEsMappingsFromSchema(prop.properties);
    }
    
    // If it's an array with object items, process the item properties
    if (prop.type === 'array' && prop.items?.type === 'object' && prop.items.properties) {
      baseMapping.properties = generateEsMappingsFromSchema(prop.items.properties);
    }
    
    // Special handling for events array (nested type with specific structure)
    // Events have 'time' property (HrTime) which maps to 'timestamp' in ES
    if (fieldName === 'events' && prop.type === 'array' && prop.items?.properties) {
      const eventProps = prop.items.properties;
      baseMapping.properties = {};
      if (eventProps.name) {
        baseMapping.properties.name = jsonSchemaToEsMapping(eventProps.name, 'name');
      }
      // Map 'time' (HrTime) to 'timestamp' (date) in Elasticsearch
      if (eventProps.time) {
        baseMapping.properties.timestamp = { type: 'date' };
      }
      // Use flattened type for event attributes
      if (eventProps.attributes) {
        baseMapping.properties.attributes = { type: 'flattened' };
      }
    }
    
    mappings[fieldName] = baseMapping;
  }
  
  return mappings;
}

// Generate Elasticsearch mappings from Span schema
function generateSpanMappings(): any {
  const spanSchema = loadSchema('Span');
  const spanDef = getTypeDefinition(spanSchema, 'Span');
  
  if (!spanDef || !spanDef.properties) {
    throw new Error('Could not find Span properties in schema');
  }
  
  // Generate all mappings from schema (including nested objects)
  return generateEsMappingsFromSchema(spanDef.properties);
}

// Generate Elasticsearch mappings for Example schema
// Examples have a spans field that should use flattened and time types like Span
function generateExampleMappings(): any {
  const exampleSchema = loadSchema('Example');
  const exampleDef = getTypeDefinition(exampleSchema, 'Example');
  
  if (!exampleDef || !exampleDef.properties) {
    throw new Error('Could not find Example properties in schema');
  }
  
  // Generate base mappings from schema
  const mappings = generateEsMappingsFromSchema(exampleDef.properties);
  
  // Reuse span mappings for the spans array field - spans are nested Span objects
  if (mappings.spans && mappings.spans.type === 'nested') {
    const spanMappings = generateSpanMappings();
    mappings.spans.properties = spanMappings;
  }
  
  // Special handling for inputs field - store as-is, not indexed
  if (mappings.inputs) {
    mappings.inputs = { type: 'object', enabled: false };
  }
  
  return mappings;
}

// Generic function to create an Elasticsearch index
async function createIndex(indexName: string, mappings: any): Promise<void> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  const indexExists = await client.indices.exists({ index: indexName });
  if (indexExists) {
    // Index exists - try to update mapping with any new fields
    // Elasticsearch allows adding new fields but not changing existing ones
    try {
      await client.indices.putMapping({
        index: indexName,
        properties: mappings
      });
    } catch (error: any) {
      // Ignore mapping update errors (e.g., if fields already exist or can't be updated)
      // This is safe - existing fields won't be changed, new fields will be added
      console.warn(`Could not update mapping for ${indexName}:`, error.message);
    }
    return;
  }

  await client.indices.create({
    index: indexName,
    body: {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        'mapping.total_fields.limit': 1000,
        'mapping.depth.limit': 20,
      },
      mappings: {
        properties: mappings,
        dynamic: false
      }
    }
  });
}

// Convert HrTime tuple [seconds, nanoseconds] to milliseconds
function hrTimeToMillis(hrTime: [number, number] | undefined): number | undefined {
  if (!hrTime || !Array.isArray(hrTime) || hrTime.length !== 2) {
    return undefined;
  }
  return hrTime[0] * 1000 + Math.floor(hrTime[1] / 1000000);
}

// Transform span document for Elasticsearch (convert HrTime tuples to milliseconds)
function transformSpanForEs(doc: any): any {
  const transformed = { ...doc };
  if (Array.isArray(transformed.startTime)) {
    transformed.startTime = hrTimeToMillis(transformed.startTime);
  }
  if (Array.isArray(transformed.endTime)) {
    transformed.endTime = hrTimeToMillis(transformed.endTime);
  }
  if (Array.isArray(transformed.duration)) {
    transformed.duration = hrTimeToMillis(transformed.duration);
  }
  // Transform events array - convert time to timestamp
  if (Array.isArray(transformed.events)) {
    transformed.events = transformed.events.map((event: any) => {
      if (event && Array.isArray(event.time)) {
        const { time, ...rest } = event;
        return { ...rest, timestamp: hrTimeToMillis(event.time) };
      }
      return event;
    });
  }
  return transformed;
}

// Transform example document for Elasticsearch (convert spans array with HrTime tuples)
function transformExampleForEs(doc: any): any {
  const transformed = { ...doc };
  // Transform spans array if present
  if (Array.isArray(transformed.spans)) {
    transformed.spans = transformed.spans.map((span: any) => {
      return transformSpanForEs(span);
    });
  }
  return transformed;
}

// Generic bulk insert function
async function bulkInsert<T>(indexName: string, documents: T[], transformFn?: (doc: any) => any): Promise<void> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  if (documents.length === 0) return;

  const transform = transformFn || transformSpanForEs;

  const body = documents.flatMap(doc => {
    const transformed = transform(doc);
    const docId = (doc as any).spanId || (doc as any).id;
    const indexAction = docId 
      ? { index: { _index: indexName, _id: docId } }
      : { index: { _index: indexName } };
    return [indexAction, transformed];
  });

  const response = await client.bulk({ 
    body,
    refresh: 'wait_for' // Make documents immediately searchable
  });

  // Check for errors in bulk response
  if (response.errors) {
    const erroredDocuments: any[] = [];
    response.items.forEach((action: any, i: number) => {
      const operation = Object.keys(action)[0];
      if (action[operation].error) {
        erroredDocuments.push({
          operation,
          document: documents[Math.floor(i / 2)],
          error: action[operation].error
        });
      }
    });
    if (erroredDocuments.length > 0) {
      throw new Error(`Bulk insert errors: ${JSON.stringify(erroredDocuments, null, 2)}`);
    }
  }
}

// Generic search function wrapper
async function searchEntities<T>(
  indexName: string,
  searchQuery?: SearchQuery | string | null,
  filters?: Record<string, string>,
  limit: number = 100,
  offset: number = 0
): Promise<{ hits: T[]; total: number }> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }

  return searchEntitiesEs<T>(
    client,
    indexName,
    searchQuery,
    filters,
    limit,
    offset
  );
}

// Also ensure index aliases exist and point to the correct indices
async function ensureAlias(index: string, alias: string): Promise<void> {
  if (index === alias) return; // skip if alias is just the index name
  if (!client) throw new Error('Elasticsearch client not initialized.');
  
  // Check if index exists first
  const indexExists = await client.indices.exists({ index });
  if (!indexExists) {
    throw new Error(`Index ${index} does not exist. Create it before setting up aliases.`);
  }
  
  // Check if alias already points to this index
  try {
    const aliasExists = await client.indices.existsAlias({ name: alias, index });
    if (aliasExists) {
      return; // Alias already correctly configured
    }
  } catch (error: any) {
    // If existsAlias throws (e.g., alias doesn't exist), continue to set it up
    // Only rethrow if it's not a 404 (not found) error
    if (error.meta?.statusCode && error.meta.statusCode !== 404) {
      throw error;
    }
  }
  
  // Get current alias assignments to remove them from other indices if needed
  let indicesWithAlias: string[] = [];
  try {
    const aliasIndices = await client.indices.getAlias({ name: alias });
    if (aliasIndices && typeof aliasIndices === 'object' && !Array.isArray(aliasIndices)) {
      indicesWithAlias = Object.keys(aliasIndices).filter(i => i !== index);
    }
  } catch (error: any) {
    // If alias doesn't exist (404), that's fine - we'll create it
    // Only rethrow if it's not a 404 error
    if (error.meta?.statusCode && error.meta.statusCode !== 404) {
      throw error;
    }
  }
  
  // Build actions: remove alias from other indices, then add to target index
  const actions: any[] = [];
  if (indicesWithAlias.length > 0) {
    actions.push(...indicesWithAlias.map(i => ({ remove: { index: i, alias } })));
  }
  actions.push({ add: { index, alias } });
  
  // Update aliases atomically
  await client.indices.updateAliases({
    body: { actions }
  });
}
  
/**
 * Create Elasticsearch indices with mappings. Safe to call multiple times (skips if index exists).
 * Call during application startup.
 */
export async function createIndices(): Promise<void> {
  const spanMappings = generateSpanMappings();
  const exampleMappings = generateExampleMappings();
  await createIndex(SPAN_INDEX, spanMappings);
  await createIndex(DATASET_EXAMPLES_INDEX, exampleMappings);
 
  await ensureAlias(SPAN_INDEX, SPAN_INDEX_ALIAS);
  await ensureAlias(DATASET_EXAMPLES_INDEX, DATASET_EXAMPLES_INDEX_ALIAS);
}

/**
 * Bulk insert spans into 'traces' index. Spans should have organisation set.
 */
export async function bulkInsertSpans(spans: Span[]): Promise<void> {
  return bulkInsert<Span>(SPAN_INDEX_ALIAS, spans);
}


/**
 * Search spans in 'traces' index. Filters by organisationId if provided.
 * @param searchQuery - Gmail-style search query or SearchQuery instance. Returns all if null.
 */
export async function searchSpans(
  searchQuery?: SearchQuery | string | null,
  organisationId?: string,
  limit: number = 100,
  offset: number = 0
): Promise<{ hits: Span[]; total: number }> {
  return searchEntities<Span>(
    SPAN_INDEX_ALIAS,
    searchQuery,
    { organisation: organisationId },
    limit,
    offset
  );
}

/**
 * Bulk insert examples into 'DATASET_EXAMPLES' index. Examples should have organisation and dataset set.
 */
export async function bulkInsertExamples(examples: Example[]): Promise<void> {
  return bulkInsert<Example>(DATASET_EXAMPLES_INDEX_ALIAS, examples, transformExampleForEs);
}

/**
 * Search examples in 'DATASET_EXAMPLES' index. Filters by organisationId and/or datasetId if provided.
 * @param searchQuery - Gmail-style search query or SearchQuery instance. Returns all if null.
 */
export async function searchExamples(
  searchQuery?: SearchQuery | string | null,
  organisationId?: string,
  datasetId?: string,
  limit: number = 100,
  offset: number = 0
): Promise<{ hits: Example[]; total: number }> {
  const filters: Record<string, string> = {};
  if (organisationId) {
    filters.organisation = organisationId;
  }
  if (datasetId) {
    filters.dataset = datasetId;
  }
  return searchEntities<Example>(
    DATASET_EXAMPLES_INDEX_ALIAS,
    searchQuery,
    Object.keys(filters).length > 0 ? filters : undefined,
    limit,
    offset
  );
}

/**
 * Delete an index. Useful for testing.
 */
export async function deleteIndex(indexName: string): Promise<void> {
  if (!client) {
    throw new Error('Elasticsearch client not initialized.');
  }
  const indexExists = await client.indices.exists({ index: indexName });
  if (indexExists) {
    await client.indices.delete({ index: indexName });
  }
}

/**
 * Close Elasticsearch client. Call during graceful shutdown.
 */
export async function closeClient(): Promise<void> {
  if (client) {
    // Elasticsearch client doesn't have a close method, but we can reset it
    client = null;
  }
}

