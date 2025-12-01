import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Nav, NavItem, NavLink, TabContent, TabPane } from 'reactstrap';
import { listApiKeys } from '../api';
import { useQuery } from '@tanstack/react-query';
import { ApiKey } from '../common/types';

const CodeSetupPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const [activeTab, setActiveTab] = useState('python');

  const {data:apiKeys, isLoading, error} = useQuery({
    queryKey: ['apiKeys', organisationId],
    queryFn: () => listApiKeys(organisationId!),
    enabled: !!organisationId,
  });
  const apiKey = apiKeys?.[0];
console.log(apiKey, apiKeys);
  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <h1>Code Setup</h1>
          <p className="text-muted">Setup instructions for organisation: {organisationId}</p>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col>
          <Card>
            <CardHeader>
              <Nav tabs>
                <NavItem>
                  <NavLink
                    className={activeTab === 'python' ? 'active' : ''}
                    onClick={() => setActiveTab('python')}
                    style={{ cursor: 'pointer' }}
                  >
                    Python
                  </NavLink>
                </NavItem>
                <NavItem>
                  <NavLink
                    className={activeTab === 'javascript' ? 'active' : ''}
                    onClick={() => setActiveTab('javascript')}
                    style={{ cursor: 'pointer' }}
                  >
                    JavaScript
                  </NavLink>
                </NavItem>
				<NavItem>
                  <NavLink
                    className={activeTab === 'api' ? 'active' : ''}
                    onClick={() => setActiveTab('api')}
                    style={{ cursor: 'pointer' }}
                  >
                    API
                  </NavLink>
                </NavItem>
              </Nav>
            </CardHeader>
            <CardBody>
              <TabContent activeTab={activeTab}>
                <TabPane tabId="python">
                  <PythonCodeSetupPane apiKey={apiKey} />
                </TabPane>
                <TabPane tabId="javascript">
				<JavaScriptCodeSetupPane apiKey={apiKey} />
                </TabPane>
				<TabPane tabId="api">
				<APICodeSetupPane apiKey={apiKey} />
				</TabPane>
              </TabContent>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

function PythonCodeSetupPane({ apiKey }: { apiKey: ApiKey }) {
  return (
    <div>
      <h5>Python Integration Instructions</h5>
      <h5>Install the Python client</h5>
      <pre>
pip install aiqa-client
      </pre>
	  <p>In .env or otherwise, set the API key:</p>
	  <p><code>AIQA_API_KEY={apiKey?.id || 'your-api-key'}</code></p>
      <h5>Trace your functions</h5>
      <p>
        Use the <code>@WithTracing</code> or <code>@WithTracingAsync</code> decorators from the client. For example:
      </p>
      <pre><code>{`from aiqa import get_client, WithTracing

# Initialize the client
client = get_client()

@WithTracing
def my_function(x):
    return x * 2

result = my_function(5)
      `}</code></pre>

    </div>
  );
}

function JavaScriptCodeSetupPane({ apiKey }: { apiKey: ApiKey }) {
  return (
    <div>
 <h5>Install the client-js library</h5>
<p><code>npm install @aiqa/client-js</code></p>
<p>In .env or otherwise, set the API key:</p>
<p><code>AIQA_API_KEY={apiKey?.id || 'your-api-key'}</code></p>
<h5>Wrap the functions you want to trace using the <code>withTracing</code> or <code>withTracingAsync</code> decorators</h5>
<pre><code>{`import { withTracing, withTracingAsync } from '@aiqa/client-js';

const tracedFn = withTracing(fn);

// Just use the tracedFn as normal instead of the original fn
tracedFn(5);`}</code></pre>
<h5>That's it!</h5>
<p>For setting extra attributes and other features - please see <code>tracing.ts</code> in the client-js library.</p>
    </div>
  );
}
function APICodeSetupPane({ apiKey }: { apiKey: ApiKey }) {
  return (
    <div>
      <h5>API Integration Instructions</h5>
      <p>Your API key: <code>{apiKey?.id || 'your-api-key'}</code></p>
    </div>
  );
}

export default CodeSetupPage;

