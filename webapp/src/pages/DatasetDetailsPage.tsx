import React, { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem, Badge, Button, Modal, ModalHeader, ModalBody, ModalFooter, Form, FormGroup, Label, Input } from 'reactstrap';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { getDataset, listExperiments, searchExamples, updateDataset } from '../api';
import type { Dataset, Example, Span } from '../common/types';
import type Experiment from '../common/types/Experiment';
import { Metric } from '../common/types/Dataset';
import { getSpanId, getStartTime, getEndTime, getDurationMs } from '../utils/span-utils';

import TableUsingAPI, { PageableData } from '../components/TableUsingAPI';

// Helper to get the first span from an Example, or return the example itself if it has span-like fields
function getFirstSpan(example: Example): Span | null {
  if (example.spans && example.spans.length > 0) {
    return example.spans[0] as Span;
  }
  // If no spans array, check if example itself has span-like fields (for backward compatibility)
  if ((example as any).name || (example as any).spanId) {
    return example as any as Span;
  }
  return null;
}

const getTraceId = (example: Example) => {
  const span = getFirstSpan(example);
  if (span) {
    return (span as any).trace?.id || (span as any).client_trace_id || span.traceId || example.traceId || 'N/A';
  }
  return example.traceId || 'N/A';
};

const DatasetDetailsPage: React.FC = () => {
  const { organisationId, datasetId } = useParams<{ organisationId: string; datasetId: string }>();
  const queryClient = useQueryClient();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newMetric, setNewMetric] = useState<Partial<Metric>>({
    name: '',
    description: '',
    unit: '',
    type: 'javascript',
    parameters: {},
  });

  const { data: dataset, isLoading, error } = useQuery({
    queryKey: ['dataset', datasetId],
    queryFn: () => getDataset(datasetId!),
    enabled: !!datasetId,
  });

  const updateDatasetMutation = useMutation({
    mutationFn: (updates: Partial<Dataset>) => updateDataset(datasetId!, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataset', datasetId] });
    },
  });

  const { data: experiments } = useQuery({
    queryKey: ['experiments', organisationId, datasetId],
    queryFn: () => listExperiments(organisationId!),
    enabled: !!datasetId && !!organisationId,
    select: (data) => {
      // Filter by dataset
      return data.filter((exp: Experiment) => exp.dataset === datasetId);
    },
  });

  const loadExamplesData = async (query: string): Promise<PageableData<Example>> => {
    const result = await searchExamples({
      organisationId: organisationId!,
      datasetId,
      query: query || undefined,
      limit: 1000,
      offset: 0,
    });
    return {
      hits: result.hits || [],
      offset: result.offset || 0,
      limit: result.limit || 1000,
      total: result.total,
    };
  };
  const columns = useMemo<ColumnDef<Example>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'Example ID',
        cell: ({ row }) => (
          <code className="small">{row.original.id?.substring(0, 16)}...</code>
        ),
      },
      {
        id: 'name',
        header: 'Name',
        cell: ({ row }) => {
          const span = getFirstSpan(row.original);
          return span ? (span as any).name || 'N/A' : 'N/A';
        },
      },
      {
        id: 'spanId',
        header: 'Span ID',
        cell: ({ row }) => {
          const span = getFirstSpan(row.original);
          return span ? (
            <code className="small">{getSpanId(span).substring(0, 16)}...</code>
          ) : 'N/A';
        },
      },
      {
        id: 'traceId',
        header: 'Trace ID',
        cell: ({ row }) => (
          <code className="small">{getTraceId(row.original).substring(0, 16)}...</code>
        ),
      },
      {
        id: 'startTime',
        header: 'Start Time',
        cell: ({ row }) => {
          const span = getFirstSpan(row.original);
          if (!span) return 'N/A';
          const startTime = getStartTime(span);
          return startTime ? startTime.toLocaleString() : 'N/A';
        },
      },
      {
        id: 'duration',
        header: 'Duration',
        cell: ({ row }) => {
          const span = getFirstSpan(row.original);
          if (!span) return 'N/A';
          const duration = getDurationMs(span);
          return duration !== null ? `${duration.toFixed(2)}ms` : 'N/A';
        },
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => {
          const span = getFirstSpan(row.original);
          if (!span) return 'N/A';
          const status = (span as any).status;
          if (!status) return 'N/A';
          const code = status.code === 1 ? 'OK' : status.code === 2 ? 'ERROR' : 'UNSET';
          return <Badge color={code === 'ERROR' ? 'danger' : code === 'OK' ? 'success' : 'secondary'}>{code}</Badge>;
        },
      },
    ],
    []
  );

  if (isLoading) {
    return (
      <Container className="mt-4">
        <div className="text-center">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      </Container>
    );
  }

  if (error || !dataset) {
    return (
      <Container className="mt-4">
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load dataset: {error instanceof Error ? error.message : 'Unknown error'}</p>
          <Link to={`/organisation/${organisationId}/dataset`} className="btn btn-primary">
            Back to Datasets
          </Link>
        </div>
      </Container>
    );
  }

  const datasetExperiments = experiments || [];

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <Link to={`/organisation/${organisationId}/dataset`} className="btn btn-link mb-3">
            ← Back to Datasets
          </Link>
          <h1>{dataset.name}</h1>
		  <ListGroup flush>
			<ListGroupItem>
				<strong>Dataset ID:</strong> {dataset.id}
			</ListGroupItem>
                <ListGroupItem>
                  <strong>Description:</strong>{' '}
                  {dataset.description || <span className="text-muted">Not provided</span>}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Tags:</strong>{' '}
                  {dataset.tags && dataset.tags.length > 0 ? (
                    <div className="mt-1">
                      {dataset.tags.map((tag, idx) => (
                        <Badge key={idx} color="secondary" className="me-1">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted">None</span>
                  )}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Created:</strong> {new Date(dataset.created).toLocaleString()}
                </ListGroupItem>
                <ListGroupItem>
                  <strong>Updated:</strong> {new Date(dataset.updated).toLocaleString()}
                </ListGroupItem>
              </ListGroup>
        </Col>
      </Row>

      <Row className="mt-3">
        <Col>
          <Card>
            <CardHeader className="d-flex justify-content-between align-items-center">
              <h5>Metrics</h5>
              <Button color="primary" size="sm" onClick={() => setIsAddModalOpen(true)}>
                + Add Metric
              </Button>
            </CardHeader>
            <CardBody>
              {dataset.metrics && dataset.metrics.length > 0 ? (
                <Row>
                  {dataset.metrics.map((metric, index) => (
                    <Col md={6} lg={4} key={index} className="mb-3">
                      <Card>
                        <CardBody>
                          <div className="d-flex justify-content-between align-items-start mb-2">
                            <h6 className="mb-0">{metric.name}</h6>
                            <div className="d-flex gap-1">
                              <Button
                                color="primary"
                                size="sm"
                                onClick={() => {
                                  setEditingIndex(index);
                                  setNewMetric({
                                    name: metric.name,
                                    description: metric.description || '',
                                    unit: metric.unit || '',
                                    type: metric.type,
                                    parameters: metric.parameters || {},
                                  });
                                  setIsAddModalOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                color="danger"
                                size="sm"
                                onClick={() => {
                                  const updatedMetrics = dataset.metrics!.filter((_, i) => i !== index);
                                  updateDatasetMutation.mutate({ metrics: updatedMetrics });
                                }}
                              >
                                ×
                              </Button>
                            </div>
                          </div>
                          {metric.description && (
                            <p className="text-muted small mb-1">{metric.description}</p>
                          )}
                          <div className="d-flex gap-2 flex-wrap">
                            <Badge color="info">{metric.type}</Badge>
                            {metric.unit && <Badge color="secondary">{metric.unit}</Badge>}
                          </div>
                          {metric.parameters && Object.keys(metric.parameters).length > 0 && (
                            <details className="mt-2">
                              <summary className="small text-muted" style={{ cursor: 'pointer' }}>
                                Parameters
                              </summary>
                              <pre className="small bg-light p-2 mt-1 mb-0">
                                {JSON.stringify(metric.parameters, null, 2)}
                              </pre>
                            </details>
                          )}
                        </CardBody>
                      </Card>
                    </Col>
                  ))}
                </Row>
              ) : (
                <p className="text-muted">No metrics defined. Click "Add Metric" to create one.</p>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      <Modal isOpen={isAddModalOpen} toggle={() => {
        setIsAddModalOpen(false);
        setEditingIndex(null);
        setNewMetric({
          name: '',
          description: '',
          unit: '',
          type: 'javascript',
          parameters: {},
        });
      }}>
        <ModalHeader toggle={() => {
          setIsAddModalOpen(false);
          setEditingIndex(null);
          setNewMetric({
            name: '',
            description: '',
            unit: '',
            type: 'javascript',
            parameters: {},
          });
        }}>
          {editingIndex !== null ? 'Edit Metric' : 'Add Metric'}
        </ModalHeader>
        <ModalBody>
          <Form>
            <FormGroup>
              <Label for="metricName">Name *</Label>
              <Input
                id="metricName"
                type="text"
                value={newMetric.name}
                onChange={(e) => setNewMetric({ ...newMetric, name: e.target.value })}
                placeholder="e.g., latency"
              />
            </FormGroup>
            <FormGroup>
              <Label for="metricDescription">Description</Label>
              <Input
                id="metricDescription"
                type="text"
                value={newMetric.description || ''}
                onChange={(e) => setNewMetric({ ...newMetric, description: e.target.value })}
                placeholder="Optional description"
              />
            </FormGroup>
            <FormGroup>
              <Label for="metricUnit">Unit</Label>
              <Input
                id="metricUnit"
                type="text"
                value={newMetric.unit || ''}
                onChange={(e) => setNewMetric({ ...newMetric, unit: e.target.value })}
                placeholder="e.g., ms, USD, tokens"
              />
            </FormGroup>
            <FormGroup>
              <Label for="metricType">Type *</Label>
              <Input
                id="metricType"
                type="select"
                value={newMetric.type}
                onChange={(e) => setNewMetric({ ...newMetric, type: e.target.value as 'javascript' | 'llm' })}
              >
                <option value="javascript">JavaScript</option>
                <option value="llm">LLM</option>
              </Input>
            </FormGroup>
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" onClick={() => {
            setIsAddModalOpen(false);
            setEditingIndex(null);
            setNewMetric({
              name: '',
              description: '',
              unit: '',
              type: 'javascript',
              parameters: {},
            });
          }}>
            Cancel
          </Button>
          <Button
            color="primary"
            onClick={() => {
              if (!newMetric.name || !newMetric.type) {
                alert('Name and Type are required');
                return;
              }
              let updatedMetrics: Metric[];
              if (editingIndex !== null) {
                // Edit existing metric
                updatedMetrics = [...(dataset?.metrics || [])];
                updatedMetrics[editingIndex] = newMetric as Metric;
              } else {
                // Add new metric
                updatedMetrics = [...(dataset?.metrics || []), newMetric as Metric];
              }
              updateDatasetMutation.mutate({ metrics: updatedMetrics });
              setIsAddModalOpen(false);
              setEditingIndex(null);
              setNewMetric({
                name: '',
                description: '',
                unit: '',
                type: 'javascript',
                parameters: {},
              });
            }}
          >
            {editingIndex !== null ? 'Save Changes' : 'Add Metric'}
          </Button>
        </ModalFooter>
      </Modal>

      <Row className="mt-3">
        <Col>
          <TableUsingAPI
            loadData={loadExamplesData}
            columns={columns}
            searchPlaceholder="Search examples..."
            searchDebounceMs={500}
            pageSize={50}
            enableInMemoryFiltering={true}
          />
        </Col>
      </Row>

    </Container>
  );
};

export default DatasetDetailsPage;

