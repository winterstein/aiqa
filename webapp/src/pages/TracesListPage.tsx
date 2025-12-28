import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Row, Col } from 'reactstrap';
import { ColumnDef } from '@tanstack/react-table';
import { searchSpans } from '../api';
import { Span } from '../common/types';
import TableUsingAPI, { PageableData } from '../components/generic/TableUsingAPI';
import TracesListDashboard from '../components/TracesListDashboard';
import { getTraceId, getStartTime, getDurationMs, getTotalTokenCount, getCost } from '../utils/span-utils';

const getFeedback = (span: Span): { type: 'positive' | 'negative' | 'neutral' | null; comment?: string } | null => {
  const attributes = (span as any).attributes || {};
  const spanType = attributes['aiqa.span_type'];
  if (spanType === 'feedback') {
    const feedbackType = attributes['feedback.type'] as string | undefined;
    const thumbsUp = attributes['feedback.thumbs_up'] as boolean | undefined;
    const comment = attributes['feedback.comment'] as string | undefined;
    
    let type: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (feedbackType === 'positive' || thumbsUp === true) {
      type = 'positive';
    } else if (feedbackType === 'negative' || thumbsUp === false) {
      type = 'negative';
    }
    
    return { type, comment };
  }
  return null;
};

const TracesListPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const navigate = useNavigate();
  const [feedbackMap, setFeedbackMap] = useState<Map<string, { type: 'positive' | 'negative' | 'neutral'; comment?: string }>>(new Map());
  const [allSpans, setAllSpans] = useState<Span[]>([]);

  const loadData = async (query: string): Promise<PageableData<Span>> => {
    const limit = 1000; // Fetch more traces for in-memory filtering
    // Request all fields including attributes since we need them for tokens, cost, feedback, and component
    const result = await searchSpans({ organisationId: organisationId!, query, isRoot: true, limit, offset: 0, fields: '*' });
    
    console.log('[TracesListPage] API Response:', {
      total: result.total,
      offset: result.offset,
      limit: result.limit,
      hitsCount: result.hits?.length || 0,
    });
    
    if (result.hits && result.hits.length > 0) {
      console.log('[TracesListPage] First span sample:', result.hits[0]);
      console.log('[TracesListPage] First span keys:', Object.keys(result.hits[0]));
      console.log('[TracesListPage] First span properties:', {
        name: (result.hits[0] as any).name,
        traceId: (result.hits[0] as any).traceId,
        client_trace_id: (result.hits[0] as any).client_trace_id,
        startTime: (result.hits[0] as any).startTime,
        duration: (result.hits[0] as any).duration,
      });
      
      // Fetch feedback spans for all traces
      const traceIds = result.hits.map(span => getTraceId(span)).filter(id => id);
      if (traceIds.length > 0) {
        // Query for feedback spans - use attribute path format
        const feedbackQuery = traceIds.map(id => `traceId:${id}`).join(' OR ');
        const feedbackResult = await searchSpans({
          organisationId: organisationId!,
          query: `(${feedbackQuery}) AND attributes.aiqa\\.span_type:feedback`,
          limit: 1000,
          offset: 0,
          fields: '*' // Need attributes for feedback information
        });
        
        // Create feedback map
        const newFeedbackMap = new Map<string, { type: 'positive' | 'negative' | 'neutral'; comment?: string }>();
        if (feedbackResult.hits) {
          feedbackResult.hits.forEach((span: Span) => {
            const traceId = getTraceId(span);
            if (traceId) {
              const feedback = getFeedback(span);
              if (feedback && feedback.type !== null) {
                newFeedbackMap.set(traceId, feedback);
              }
            }
          });
        }
        setFeedbackMap(newFeedbackMap);
      }
      
      // Store all spans for dashboard
      setAllSpans(result.hits || []);
    }
    
    return result;
  };

  const columns = useMemo<ColumnDef<Span>[]>(
    () => [
		{
			id: 'startTime',
			header: 'Start Time',
			accessorFn: (row) => {
			  const startTime = getStartTime(row);
			  return startTime ? startTime.getTime() : null;
			},
			cell: ({ row }) => {
			  const startTime = getStartTime(row.original);
			  console.log('[TracesListPage] startTime cell render:', { startTime, span: row.original });
			  return <span>{startTime ? startTime.toLocaleString() : 'N/A'}</span>;
			},
			enableSorting: true,
		  },
	
		{
        id: 'traceId',
        header: 'Trace ID',
        cell: ({ row }) => {
          const traceId = getTraceId(row.original);
          console.log('[TracesListPage] traceId cell render:', { traceId, span: row.original });
          if (!traceId) return <span>N/A</span>;
          return <code className="small">{traceId.length > 16 ? `${traceId.substring(0, 16)}...` : traceId}</code>;
        },
      },
      {
        accessorKey: 'name',
        header: 'Name',
        cell: ({ row }) => {
          const name = (row.original as any).name || 'Unknown';
          console.log('[TracesListPage] name cell render:', { name, span: row.original });
          return <span>{name}</span>;
        },
      },
      {
        id: 'duration',
        header: 'Duration',
        accessorFn: (row) => {
          const duration = getDurationMs(row);
          return duration !== null ? duration : null;
        },
        cell: ({ row }) => {
          const duration = getDurationMs(row.original);
          console.log('[TracesListPage] duration cell render:', { duration, span: row.original });
          if (duration === null) return <span>N/A</span>;
          // Format duration nicely
          if (duration < 1000) {
            return <span>{Math.round(duration)}ms</span>;
          } else if (duration < 60000) {
            return <span>{(duration / 1000).toFixed(2)}s</span>;
          } else {
            const minutes = Math.floor(duration / 60000);
            const seconds = ((duration % 60000) / 1000).toFixed(0);
            return <span>{minutes}m {seconds}s</span>;
          }
        },
        enableSorting: true,
      },
      {
        id: 'totalTokens',
        header: 'Tokens',
        accessorFn: (row) => {
          const tokenCount = getTotalTokenCount(row);
          return tokenCount !== null ? tokenCount : null;
        },
        cell: ({ row }) => {
          const tokenCount = getTotalTokenCount(row.original);
          return <span>{tokenCount !== null ? tokenCount.toLocaleString() : 'N/A'}</span>;
        },
        enableSorting: true,
      },
      {
        id: 'cost',
        header: 'Cost (USD)',
        accessorFn: (row) => {
          const cost = getCost(row);
          return cost !== null ? cost : null;
        },
        cell: ({ row }) => {
          const cost = getCost(row.original);
          if (cost === null) return <span>N/A</span>;
          // Format cost with appropriate precision
          if (cost < 0.01) {
            return <span>${cost.toFixed(4)}</span>;
          } else if (cost < 1) {
            return <span>${cost.toFixed(3)}</span>;
          } else {
            return <span>${cost.toFixed(2)}</span>;
          }
        },
        enableSorting: true,
      },
      {
        id: 'component',
        header: 'Component',
        cell: ({ row }) => {
          const component = (row.original as any).attributes?.['gen_ai.component.id'] || 
                           (row.original as any).attributes?.component || 
                           null;
          return <span>{component || 'N/A'}</span>;
        },
      },
      {
        id: 'feedback',
        header: 'Feedback',
        cell: ({ row }) => {
          const traceId = getTraceId(row.original);
          const feedback = traceId ? feedbackMap.get(traceId) : null;
          if (!feedback) {
            return <span className="text-muted">—</span>;
          }
          return (
            <span>
              {feedback.type === 'positive' && <span className="text-success">👍</span>}
              {feedback.type === 'negative' && <span className="text-danger">👎</span>}
              {feedback.type === 'neutral' && <span className="text-muted">○</span>}
              {feedback.comment && (
                <span className="ms-2" title={feedback.comment}>
                  💬
                </span>
              )}
            </span>
          );
        },
      },
    ],
    [organisationId, feedbackMap]
  );

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>Traces</h1>
        </Col>
      </Row>

      {allSpans.length > 0 && (
        <Row className="mt-3">
          <Col>
            <TracesListDashboard spans={allSpans} feedbackMap={feedbackMap} />
          </Col>
        </Row>
      )}

      <Row className="mt-3">
        <Col>
          <TableUsingAPI
            loadData={loadData}
			refetchInterval={30000} // 30 seconds
            columns={columns}
            searchPlaceholder="Search traces"
            searchDebounceMs={500}
            pageSize={50}
            enableInMemoryFiltering={true}
            initialSorting={[{ id: 'startTime', desc: true }]}
            onRowClick={(span) => {
              const traceId = getTraceId(span);
              if (traceId) {
                navigate(`/organisation/${organisationId}/traces/${traceId}`);
              }
            }}
          />
        </Col>
      </Row>
    </Container>
  );
};

export default TracesListPage;

