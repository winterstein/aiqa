import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Row, Col } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { createExampleFromSpans, listDatasets, searchSpans } from '../api';
import { Span } from '../common/types';
import { getSpanId, getStartTime, getEndTime, getDurationMs, getDurationUnits } from '../utils/span-utils';
import TextWithStructureViewer from '../components/generic/TextWithStructureViewer';
import CopyButton from '../components/generic/CopyButton';
import ExpandCollapseControl from '../components/generic/ExpandCollapseControl';
import { useToast } from '../utils/toast';
import { durationString } from '../utils/span-utils';

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
  const { data: traceSpans } = useQuery({
    queryKey: ['spans', organisationId, traceId],
    queryFn: async () => {
      const result = await searchSpans({ organisationId: organisationId!, query: `traceId:${traceId}`, limit: 1000, offset: 0 });
	  return result.hits;
    },
    enabled: !!organisationId && !!traceId,
  });
  // organise the traceSpans into a tree of spans, with the root span at the top
  const spanTree = traceSpans ? organiseSpansIntoTree(traceSpans, null) : null;
  
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

  // Initialize selected span to the root span when tree is loaded
  useEffect(() => {
    if (spanTree && !selectedSpanId) {
      const rootSpanId = getSpanId(spanTree.span);
      setSelectedSpanId(rootSpanId);
      // Expand all spans initially
      const allSpanIds = new Set<string>();
      const collectAllSpanIds = (tree: SpanTree) => {
        allSpanIds.add(getSpanId(tree.span));
        tree.children.forEach(child => collectAllSpanIds(child));
      };
      collectAllSpanIds(spanTree);
      setExpandedSpanIds(allSpanIds);
    }
  }, [spanTree, selectedSpanId]);

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
        <Col md={4} style={{ minWidth: 0 }}>
          <h3>Span Tree</h3>
          {spanTree && (
            <SpanTreeViewer 
              spanTree={spanTree} 
              selectedSpanId={selectedSpanId}
              expandedSpanIds={expandedSpanIds}
              onSelectSpan={handleSelectSpan}
              onToggleExpanded={toggleExpanded}
              durationUnit={durationUnit}
            />
          )}
        </Col>
        <Col md={8} style={{ minWidth: 0 }}>
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
	if (!json) return null;
	const jsonString = JSON.stringify(json, null, 2);
	const {showToast} = useToast();
	return (
		<div style={{ marginTop: '30px', padding: '15px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9', maxWidth: '100%', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
		  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', minWidth: 0, maxWidth: '100%' }}>
			<strong>Full trace JSON</strong>
			<CopyButton content={json} showToast={showToast} logToConsole  successMessage="Copied json to clipboard and logged to console." />
		  </div>
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
			<code style={{ maxWidth: '100%', wordBreak: 'break-all', overflowWrap: 'anywhere', display: 'block' }}>{jsonString}</code>
		  </pre>
		</div>
	  )
}

function SpanTreeViewer({ 
	spanTree, 
	selectedSpanId,
	expandedSpanIds,
	onSelectSpan,
	onToggleExpanded,
	durationUnit
}: { 
	spanTree: SpanTree;
	selectedSpanId: string | null;
	expandedSpanIds: Set<string>;
	onSelectSpan: (spanId: string) => void;
	onToggleExpanded: (spanId: string) => void;
	durationUnit: 'ms' | 's' | 'm' | 'h' | 'd' | null | undefined;
}) {
	const span = spanTree.span;
	const children = spanTree.children;
	const spanId = getSpanId(span);
	const isExpanded = expandedSpanIds.has(spanId);
	const isSelected = selectedSpanId === spanId;

	const handleSelect = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onSelectSpan(spanId);
	};

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
					{span.name && <div>Name: {(span as any).name}</div>}
					<div>Span ID: {spanId}</div>
					<div>Duration: <span>{durationString(getDurationMs(span), durationUnit)}</span></div>
				<div style={{ position: 'absolute', right: '20px', top: '10px' }}>
					<CopyButton content={span} logToConsole />
				</div>
				</div>
			</div>
			{isExpanded && children.length > 0 && (
				<div>
					{children.map(kid => (
						<SpanTreeViewer 
							key={getSpanId(kid.span)} 
							spanTree={kid}
							selectedSpanId={selectedSpanId}
							expandedSpanIds={expandedSpanIds}
							onSelectSpan={onSelectSpan}
							onToggleExpanded={onToggleExpanded}
							durationUnit={durationUnit}
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
		</div>
	);
}

export default TraceDetailsPage;

