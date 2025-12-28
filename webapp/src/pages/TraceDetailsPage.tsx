import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Row, Col, Input } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { createExampleFromSpans, listDatasets, searchSpans } from '../api';
import { Span } from '../common/types';
import { getSpanId, getStartTime, getEndTime, getDurationMs, getDurationUnits } from '../utils/span-utils';
import TextWithStructureViewer from '../components/generic/TextWithStructureViewer';
import CopyButton from '../components/generic/CopyButton';
import ExpandCollapseControl from '../components/generic/ExpandCollapseControl';
import { useToast } from '../utils/toast';
import { durationString } from '../utils/span-utils';
import JsonObjectViewer from '../components/generic/JsonObjectViewer';

interface SpanTree {
	span: Span;
	children: SpanTree[];
}

function collectSpansFromTree(spanTree: SpanTree): Span[] {
	const spans: Span[] = [];
	spans.push(spanTree.span);
	spanTree.children.forEach(child => {
		spans.push(...collectSpansFromTree(child));
	});
	return spans;
}

function getParentSpanId(span: Span): string | null {
	return (span as any).parentSpanId || (span as any).span?.parent?.id || null;
}

function getAllPossibleSpanIds(span: Span): Set<string> {
	const ids = new Set<string>();
	// Check all possible ID fields that might be used as parent references
	const possibleIds = [
		(span as any).clientSpanId,
		(span as any).spanId,
		(span as any).span?.id,
		(span as any).client_span_id,
	];
	possibleIds.forEach(id => {
		if (id && id !== 'N/A') {
			ids.add(String(id));
		}
	});
	// Also add the result from getSpanId (which uses the same logic)
	const spanId = getSpanId(span);
	if (spanId && spanId !== 'N/A') {
		ids.add(spanId);
	}
	return ids;
}

function organiseSpansIntoTree(spans: Span[], parent: Span | null): SpanTree | null {
	if ( ! parent) {
		const roots = spans.filter(span => !getParentSpanId(span));
		if ( ! roots.length) {
			return null;
		}
		// If there's only one root, return its tree
		if (roots.length === 1) {
			return organiseSpansIntoTree(spans, roots[0]);
		}
		// If there are multiple roots, create a virtual root with all roots as children
		const virtualRoot: Span = {
			...roots[0],
			name: 'Multiple Root Spans',
		} as Span;
		const tree: SpanTree = {
			span: virtualRoot,
			children: roots.map(root => organiseSpansIntoTree(spans, root)).filter((child): child is SpanTree => child !== null),
		};
		return tree;
	}
	
	const parentIds = getAllPossibleSpanIds(parent);
	const childSpans = spans.filter(span => {
		const spanParentId = getParentSpanId(span);
		if (!spanParentId) return false;
		// Check if this span's parent ID matches any of the parent's possible IDs
		return parentIds.has(spanParentId);
	});
	
	const tree: SpanTree = {
		span: parent,
		children: childSpans.map(childSpan => organiseSpansIntoTree(spans, childSpan)).filter((child): child is SpanTree => child !== null),
	};
	return tree;
}

const TraceDetailsPage: React.FC = () => {
  const { organisationId, traceId } = useParams<{ organisationId: string; traceId: string }>();

  // Load all spans
  const { data: traceSpans, isLoading: isLoadingSpans } = useQuery({
    queryKey: ['spans', organisationId, traceId],
    queryFn: async () => {
      const result = await searchSpans({ organisationId: organisationId!, query: `traceId:${traceId}`, limit: 1000, offset: 0, fields: '*' }); // Need attributes for input/output display
	  return result.hits;
    },
    enabled: !!organisationId && !!traceId,
  });
  // organise the traceSpans into a tree of spans, with the root span at the top
  // MEMOIZE THIS - it's O(n²) and runs on every render without memoization!
  const spanTree = useMemo(() => {
    return traceSpans ? organiseSpansIntoTree(traceSpans, null) : null;
  }, [traceSpans]);
  
  // Track if we're processing spans (data loaded but tree not ready)
  const isProcessingSpans = traceSpans !== undefined && spanTree === null;
  
  // Calculate duration unit from root span (longest duration) for consistent display across all spans
  const durationUnit = useMemo(() => {
    if (!spanTree) return null;
    const rootDurationMs = getDurationMs(spanTree.span);
    return getDurationUnits(rootDurationMs);
  }, [spanTree]);

  const {data:datasets, isLoading:isLoadingDataSets} = useQuery({
     queryKey: ['datasets'],
	 queryFn: async () => {
		const result = await listDatasets(organisationId);
		return result;
	 },
	 enabled: !!organisationId
  });

  // State for selected span and expanded spans
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [expandedSpanIds, setExpandedSpanIds] = useState<Set<string>>(new Set());
  
  // State for filter input and debounced filter value
  const [filterInput, setFilterInput] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Debounce filter input (500ms delay)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedFilter(filterInput);
    }, 500);
    
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [filterInput]);

  // Initialize selected span to the root span when tree is loaded
  useEffect(() => {
    if (spanTree && !selectedSpanId) {
      const rootSpanId = getSpanId(spanTree.span);
      setSelectedSpanId(rootSpanId);
      // Only expand the root span initially (not all spans) for better performance
      setExpandedSpanIds(new Set([rootSpanId]));
    }
  }, [spanTree, selectedSpanId]);
  
  // Auto-expand nodes that contain matching spans when filter is applied
  useEffect(() => {
    if (!debouncedFilter || !spanTree) {
      return;
    }
    
    const filterLower = debouncedFilter.toLowerCase();
    const spansToExpand = new Set<string>();
    
    // Recursively find all spans that match or have matching descendants
    function findMatchingSpans(tree: SpanTree): boolean {
      const spanName = (tree.span as any).name || '';
      const matches = spanName.toLowerCase().includes(filterLower);
      
      let hasMatchingDescendant = false;
      for (const child of tree.children) {
        if (findMatchingSpans(child)) {
          hasMatchingDescendant = true;
        }
      }
      
      // If this span matches or has a matching descendant, expand its path
      if (matches || hasMatchingDescendant) {
        spansToExpand.add(getSpanId(tree.span));
        // Also expand all ancestors by adding parent spans
        // We'll expand all nodes in the path to matching spans
      }
      
      return matches || hasMatchingDescendant;
    }
    
    findMatchingSpans(spanTree);
    
    // Update expanded spans to include all paths to matching spans
    setExpandedSpanIds(prev => {
      const next = new Set(prev);
      spansToExpand.forEach(id => next.add(id));
      return next;
    });
  }, [debouncedFilter, spanTree]);

  /** spans must be from the same trace */
  const addToDataSet = async (spanTree: SpanTree) => {
	console.log('addToDataSet', spanTree);
	// recursively collect all spans from the tree
	const spans = collectSpansFromTree(spanTree);
	if (!datasets?.length) {
		console.warn("No datasets?!", datasets, isLoadingDataSets);
		return;
	}
	const dataset = datasets[0]; // HACK
	// post to dataset examples
	const ok = await createExampleFromSpans({organisationId, datasetId:dataset.id, spans});
	console.log(ok);
};

  const toggleExpanded = useCallback((spanId: string) => {
    setExpandedSpanIds(prev => {
      const next = new Set(prev);
      if (next.has(spanId)) {
        next.delete(spanId);
      } else {
        next.add(spanId);
      }
      return next;
    });
  }, []);

  const handleSelectSpan = useCallback((spanId: string) => {
    setSelectedSpanId(spanId);
  }, []);

  // Find the selected span from the tree or original spans array
  function findSpanById(tree: SpanTree, id: string): Span | null {
    const treeSpanId = getSpanId(tree.span);
    if (treeSpanId === id) {
      return tree.span;
    }
    for (const child of tree.children) {
      const found = findSpanById(child, id);
      if (found) return found;
    }
    return null;
  }

  const selectedSpan = useMemo(() => {
    if (!selectedSpanId) return null;
    
    // First try to find in the tree
    if (spanTree) {
      const foundInTree = findSpanById(spanTree, selectedSpanId);
      if (foundInTree) {
        return foundInTree;
      }
    }
    
    // Fallback: search in original spans array
    if (traceSpans) {
      const foundInSpans = traceSpans.find(span => {
        const spanId = getSpanId(span);
        return spanId === selectedSpanId;
      });
      if (foundInSpans) {
        return foundInSpans;
      }
    }
    
    return null;
  }, [spanTree, selectedSpanId, traceSpans]);

  // Show loading spinner while fetching spans
  if (isLoadingSpans) {
    return (
      <div className="mt-4" style={{ maxWidth: '100%', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
        <Row>
          <Col>
            <Link to={`/organisation/${organisationId}/traces`} className="btn btn-link mb-3">
              ← Back to Traces
            </Link>
            <h1>Trace: <code>{traceId}</code></h1>
          </Col>
        </Row>
        <Row>
          <Col>
            <div className="text-center" style={{ padding: '40px' }}>
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
              <div style={{ marginTop: '15px' }}>
                <strong>Loading spans data...</strong>
              </div>
            </div>
          </Col>
        </Row>
      </div>
    );
  }

  // Show processing spinner while organizing spans into tree
  if (isProcessingSpans) {
    return (
      <div className="mt-4" style={{ maxWidth: '100%', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
        <Row>
          <Col>
            <Link to={`/organisation/${organisationId}/traces`} className="btn btn-link mb-3">
              ← Back to Traces
            </Link>
            <h1>Trace: <code>{traceId}</code></h1>
          </Col>
        </Row>
        <Row>
          <Col>
            <div className="text-center" style={{ padding: '40px' }}>
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Processing...</span>
              </div>
              <div style={{ marginTop: '15px' }}>
                <strong>Processing spans data...</strong>
                <div className="text-muted" style={{ marginTop: '5px' }}>
                  Organizing {traceSpans?.length || 0} spans into tree structure
                </div>
              </div>
            </div>
          </Col>
        </Row>
      </div>
    );
  }

  return (
    <div className="mt-4" style={{ maxWidth: '100%', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
      <Row>
        <Col>
          <Link to={`/organisation/${organisationId}/traces`} className="btn btn-link mb-3">
            ← Back to Traces
          </Link>
          <h1>Trace: <code>{traceId}</code></h1>
        </Col>
      </Row>
      <Row>
        <Col md={4} style={{ minWidth: 0, maxHeight: '100vh', overflowY: 'auto' }}>
          <h3>Span Tree</h3>
          <div style={{ marginBottom: '10px' }}>
            <Input
              type="text"
              placeholder="Filter by span name..."
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
              style={{ marginBottom: '5px' }}
            />
            {filterInput && (
              <small className="text-muted">
                {debouncedFilter ? 'Filtering...' : 'Type to filter (debounced)'}
              </small>
            )}
          </div>
          {spanTree && (
            <SpanTreeViewer 
              spanTree={spanTree} 
              selectedSpanId={selectedSpanId}
              expandedSpanIds={expandedSpanIds}
              onSelectSpan={handleSelectSpan}
              onToggleExpanded={toggleExpanded}
              durationUnit={durationUnit}
              filter={debouncedFilter}
            />
          )}
        </Col>
        <Col md={8} style={{ minWidth: 0, maxHeight: '100vh', overflowY: 'auto' }}>
          <h3>Span Details: {selectedSpan?.name || selectedSpanId}</h3>
          {selectedSpan ? (
            <SpanDetails span={selectedSpan} />
          ) : (
            <div>Select a span to view details</div>
          )}
        </Col>
      </Row>
      <Row style={{ margin: 0, maxWidth: '100%' }}>
        <Col style={{ minWidth: 0, maxWidth: '100%', paddingLeft: '15px', paddingRight: '15px' }}>
          <FullJson json={traceSpans} />
        </Col>
      </Row>
    </div>
  );
};

function FullJson({ json }: { json: any }) {
	const [isExpanded, setIsExpanded] = useState(false);
	const {showToast} = useToast();
	
	// Only stringify when expanded to avoid expensive operation on initial render
	const jsonString = useMemo(() => {
		return isExpanded ? JSON.stringify(json, null, 2) : '';
	}, [json, isExpanded]);

	if (!json) return null;

	return (
		<div style={{ marginTop: '30px', padding: '15px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9', maxWidth: '100%', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
		  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', minWidth: 0, maxWidth: '100%' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
				<ExpandCollapseControl 
					hasChildren={true} 
					isExpanded={isExpanded} 
					onToggle={() => setIsExpanded(!isExpanded)} 
				/>
				<strong>Full trace JSON</strong>
			</div>
			<CopyButton content={json} showToast={showToast} logToConsole successMessage="Copied json to clipboard and logged to console." />
		  </div>
		  {isExpanded && (
			<pre style={{ 
				fontSize: '11px', 
				maxHeight: '150px', 
				maxWidth: '100%',
				width: '100%',
				minWidth: 0,
				overflow: 'auto',
				overflowX: 'auto',
				overflowY: 'auto',
				margin: 0,
				padding: '10px',
				backgroundColor: '#fff',
				border: '1px solid #ddd',
				borderRadius: '3px',
				wordBreak: 'break-all',
				overflowWrap: 'anywhere',
				whiteSpace: 'pre-wrap',
				boxSizing: 'border-box'
			}}>
				<code style={{ maxWidth: '100%', wordBreak: 'break-all', overflowWrap: 'anywhere', display: 'block' }}>{jsonString.substring(0, 100000)/* traces can get BIG */}</code>
			</pre>
		  )}
		  {!isExpanded && (
			<div style={{ color: '#666', fontStyle: 'italic', padding: '10px' }}>
				Click to expand and view full trace JSON ({Array.isArray(json) ? json.length : 'N/A'} spans)
			</div>
		  )}
		</div>
	  )
}

function SpanTreeViewer({ 
	spanTree, 
	selectedSpanId,
	expandedSpanIds,
	onSelectSpan,
	onToggleExpanded,
	durationUnit,
	filter
}: { 
	spanTree: SpanTree;
	selectedSpanId: string | null;
	expandedSpanIds: Set<string>;
	onSelectSpan: (spanId: string) => void;
	onToggleExpanded: (spanId: string) => void;
	durationUnit: 'ms' | 's' | 'm' | 'h' | 'd' | null | undefined;
	filter?: string;
}) {
	const span = spanTree.span;
	const children = spanTree.children;
	const spanId = getSpanId(span);
	const isExpanded = expandedSpanIds.has(spanId);
	const isSelected = selectedSpanId === spanId;
	
	// Helper function to check if a tree node or any of its descendants match the filter
	const treeMatchesFilter = useCallback((tree: SpanTree, filterLower: string): boolean => {
		const name = (tree.span as any).name || '';
		if (name.toLowerCase().includes(filterLower)) {
			return true;
		}
		return tree.children.some(child => treeMatchesFilter(child, filterLower));
	}, []);
	
	// Check if this span matches the filter
	const spanName = (span as any).name || '';
	const matchesFilter = !filter || spanName.toLowerCase().includes(filter.toLowerCase());
	
	// Recursively check if any descendant matches
	const hasMatchingDescendant = useMemo(() => {
		if (!filter) return true; // Show all when no filter
		return children.some(child => treeMatchesFilter(child, filter.toLowerCase()));
	}, [filter, children, treeMatchesFilter]);
	
	// Only show this node if it matches or has a matching descendant
	if (filter && !matchesFilter && !hasMatchingDescendant) {
		return null;
	}
	
	// Filter children to only show those that match or have matching descendants
	const filteredChildren = useMemo(() => {
		if (!filter) return children;
		const filterLower = filter.toLowerCase();
		return children.filter(child => treeMatchesFilter(child, filterLower));
	}, [children, filter, treeMatchesFilter]);

	const handleSelect = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onSelectSpan(spanId);
	};

	const spanAny = span as any;
	const spanSummary = spanAny.attributes?.input?.message 
		? <div>Message: {JSON.stringify(spanAny.attributes.input.message).substring(0,100)}</div>
		: null;

	return (
		<div style={{ marginLeft: '20px', marginTop: '5px', borderLeft: '2px solid #ccc', paddingLeft: '10px' }}>
			<div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '5px' }}>
				<ExpandCollapseControl 
					hasChildren={children.length > 0}
					isExpanded={isExpanded}
					onToggle={() => onToggleExpanded(spanId)}
				/>
				<div 
					style={{ 
						flex: 1,
						cursor: 'pointer',
						padding: '5px',
						borderRadius: '4px',
						backgroundColor: isSelected ? '#e3f2fd' : 'transparent',
						border: isSelected ? '2px solid #2196f3' : '2px solid transparent',
						position: 'relative'
					}}
					onClick={handleSelect}
				>									
					{(span as any).name && <div>Name: {(span as any).name}</div>}
					{spanSummary}
					<div>Span ID: {spanId}</div>
					<div>Duration: <span>{durationString(getDurationMs(span), durationUnit)}</span></div>
				<div style={{ position: 'absolute', right: '20px', top: '10px' }}>
					<CopyButton content={span} logToConsole />
				</div>
				</div>
			</div>
			{/* Only render children when expanded - this is the key optimization */}
			{isExpanded && filteredChildren.length > 0 && (
				<div>
					{filteredChildren.map(kid => (
						<SpanTreeViewer 
							key={getSpanId(kid.span)} 
							spanTree={kid}
							selectedSpanId={selectedSpanId}
							expandedSpanIds={expandedSpanIds}
							onSelectSpan={onSelectSpan}
							onToggleExpanded={onToggleExpanded}
							durationUnit={durationUnit}
							filter={filter}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function SpanDetails({ span }: { span: Span }) {
	const spanId = getSpanId(span);
	const input = (span as any).attributes?.input;
	const output = (span as any).attributes?.output;

	// Convert input/output to string for TextWithStructureViewer
	const inputText = input !== undefined && input !== null 
		? (typeof input === 'string' ? input : JSON.stringify(input, null, 2))
		: null;
	const outputText = output !== undefined && output !== null
		? (typeof output === 'string' ? output : JSON.stringify(output, null, 2))
		: null;

	return (
		<div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9', minWidth: 0, maxWidth: '100%' }}>
			<div style={{ marginBottom: '15px' }}>
				<div><strong>Span ID:</strong> {spanId}</div>
				<div><strong>Name:</strong> {(span as any).name || 'Unnamed Span'}</div>
				<div><strong>Date:</strong> {getStartTime(span)?.toLocaleString() || 'N/A'}</div>
				<div><strong>Duration:</strong> {getDurationMs(span) ? `${getDurationMs(span)}ms` : 'N/A'}</div>
			</div>
			{inputText && (
				<div style={{ marginTop: '15px', minWidth: 0, maxWidth: '100%' }}>
					<strong>Input:</strong>
					<div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '4px', overflowX: 'auto', maxWidth: '100%', minWidth: 0, wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
						<TextWithStructureViewer text={inputText} />
					</div>
				</div>
			)}
			{outputText && (
				<div style={{ marginTop: '15px', minWidth: 0, maxWidth: '100%' }}>
					<strong>Output:</strong>
					<div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '4px', overflowX: 'auto', maxWidth: '100%', minWidth: 0, wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
						<TextWithStructureViewer text={outputText} />
					</div>
				</div>
			)}
			{!inputText && !outputText && (
				<div style={{ marginTop: '15px', color: '#666', fontStyle: 'italic' }}>
					No input or output data available for this span.
				</div>
			)}
			<OtherAttributes span={span} />
		</div>
	);
}


function OtherAttributes({ span }: { span: Span }) {
	if ( ! span || ! span.attributes ) {
		return null;
	}
	const attributes2 = {...span.attributes};	
	delete attributes2.input;
	delete attributes2.output;
	return (
	<div style={{ marginTop: '15px', minWidth: 0, maxWidth: '100%' }}>
					<strong>Other Attributes:</strong>
					<JsonObjectViewer json={attributes2} />
				</div>
	);
}


export default TraceDetailsPage;

