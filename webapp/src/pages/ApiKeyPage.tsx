import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, ListGroup, ListGroupItem, Alert, Button } from 'reactstrap';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listApiKeys, createApiKey, deleteApiKey } from '../api';

// Generate a secure random API key
function generateApiKey(): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  return Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

const ApiKeyPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const isCreatingRef = useRef(false); // Synchronous flag to prevent race conditions

  const { data: apiKeys, isLoading, error } = useQuery({
    queryKey: ['apiKeys', organisationId],
    queryFn: () => listApiKeys(organisationId!),
    enabled: !!organisationId,
  });

  const handleCreateApiKey = useCallback(async (key: string) => {
    // Check ref first (synchronous) - this prevents race conditions
    if (isCreatingRef.current) return;
    isCreatingRef.current = true; // Set immediately (synchronous)
    setIsCreating(true);
    try {
      await createApiKey({
        organisation: organisationId!,
        key,
      });
      queryClient.invalidateQueries({ queryKey: ['apiKeys', organisationId] });
    } finally {
      setIsCreating(false);
      isCreatingRef.current = false; // Reset ref when done
    }
  }, [organisationId, queryClient]);

  const deleteApiKeyMutation = useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys', organisationId] });
    },
  });

  const handleDelete = (apiKeyId: string) => {
    if (window.confirm('Are you sure you want to delete this API key? This action cannot be undone.')) {
      deleteApiKeyMutation.mutate(apiKeyId);
    }
  };

  // Reset ref when organisation changes
  useEffect(() => {
    isCreatingRef.current = false;
  }, [organisationId]);

  // Auto-create API key if none exist
  useEffect(() => {
    if (!isLoading && apiKeys && Array.isArray(apiKeys) && apiKeys.length === 0 && !isCreatingRef.current) {
      const newKey = generateApiKey();
      handleCreateApiKey(newKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, apiKeys]);

  if (isLoading || isCreating) {
    return (
      <Container className="mt-4">
        <Row>
          <Col>
            <h1>API Keys</h1>
            <p className="text-muted">Manage API keys for organisation: {organisationId}</p>
          </Col>
        </Row>
        <Row className="mt-4">
          <Col>
            <div className="text-center">
              {isCreating ? (
                <Alert color="info">
                  <div className="spinner-border spinner-border-sm me-2" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                  Creating an API key for you...
                </Alert>
              ) : (
                <div className="spinner-border" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
              )}
            </div>
          </Col>
        </Row>
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="mt-4">
        <div className="alert alert-danger">
          <h4>Error</h4>
          <p>Failed to load API keys: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </Container>
    );
  }

  const keys = Array.isArray(apiKeys) ? apiKeys : [];

  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>API Keys</h1>
          <p className="text-muted">Manage API keys for organisation: {organisationId}</p>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col>
          <Card>
            <CardHeader>
              <h5>API Key Management</h5>
            </CardHeader>
            <CardBody>
              {keys.length === 0 ? (
                <Alert color="info">
                  Creating an API key for you...
                </Alert>
              ) : (
                <ListGroup flush>
                  {keys.map((apiKey: any) => (
                    <ListGroupItem key={apiKey.id}>
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="flex-grow-1">
                          <div>
                            <strong>API Key:</strong> {apiKey.id}
                          </div>
                          {apiKey.rate_limit_per_hour && (
                            <div>
                              <strong>Rate Limit:</strong> {apiKey.rate_limit_per_hour} per hour
                            </div>
                          )}
                          {apiKey.retention_period_days && (
                            <div>
                              <strong>Retention Period:</strong> {apiKey.retention_period_days} days
                            </div>
                          )}
                          <div className="text-muted small mt-2">
                            Created: {new Date(apiKey.created).toLocaleString()}
                          </div>
                        </div>
                        <Button
                          color="danger"
                          size="sm"
                          onClick={() => handleDelete(apiKey.id)}
                          disabled={deleteApiKeyMutation.isPending}
                        >
                          {deleteApiKeyMutation.isPending ? 'Deleting...' : 'Delete'}
                        </Button>
                      </div>
                    </ListGroupItem>
                  ))}
                </ListGroup>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default ApiKeyPage;

