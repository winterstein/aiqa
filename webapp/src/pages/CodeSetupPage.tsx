import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Card, CardBody, CardHeader, Nav, NavItem, NavLink, TabContent, TabPane } from 'reactstrap';
import { API_BASE_URL, listApiKeys } from '../api';
import { useQuery } from '@tanstack/react-query';
import ApiKey from '../common/types/ApiKey.js';

const CodeSetupPage: React.FC = () => {
  const { organisationId } = useParams<{ organisationId: string }>();
  const [activeTab, setActiveTab] = useState('python');

  const {data:apiKeys, isLoading, error} = useQuery({
    queryKey: ['apiKeys', organisationId],
    queryFn: () => listApiKeys(organisationId!),
    enabled: !!organisationId,
  });
  const apiKey = apiKeys?.[0];
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
                    className={activeTab === 'golang' ? 'active' : ''}
                    onClick={() => setActiveTab('golang')}
                    style={{ cursor: 'pointer' }}
                  >
                    Golang
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
				<TabPane tabId="golang">
				<GolangCodeSetupPane apiKey={apiKey} />
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

function PythonCodeSetupPane({ apiKey }: { apiKey?: ApiKey }) {
  return (
    <div>
      <h5>Python Integration Instructions</h5>
      <h5>Install the Python client</h5>
      <pre>
pip install aiqa-client
      </pre>
	  <p>In .env or otherwise, set the API key and server URL:</p>
	  {apiKey ? (
	    <p><code>AIQA_API_KEY=your-saved-api-key<br/>
AIQA_SERVER_URL={API_BASE_URL}</code></p>
	  ) : (
	    <p><code>AIQA_API_KEY=your-api-key<br/>
AIQA_SERVER_URL={API_BASE_URL}</code></p>
	  )}
	  {apiKey && (
	    <p className="text-muted small mt-2">
	      <strong>Note:</strong> Use the API key you saved when creating it. The key is only shown once during creation.
	    </p>
	  )}
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

function JavaScriptCodeSetupPane({ apiKey }: { apiKey?: ApiKey }) {
  return (
    <div>
 <h5>Install the client-js library</h5>
<p><code>npm install @aiqa/client-js</code></p>
<p>In .env or otherwise, set the API key and server URL:</p>
{apiKey ? (
  <p><code>AIQA_API_KEY=your-saved-api-key<br/>
AIQA_SERVER_URL={API_BASE_URL}</code></p>
) : (
  <p><code>AIQA_API_KEY=your-api-key<br/>
AIQA_SERVER_URL={API_BASE_URL}</code></p>
)}
{apiKey && (
  <p className="text-muted small mt-2">
    <strong>Note:</strong> Use the API key you saved when creating it. The key is only shown once during creation.
  </p>
)}
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
function GolangCodeSetupPane({ apiKey }: { apiKey?: ApiKey }) {
  return (
    <div>
      <h5>Install the client-go library</h5>
      <p><code>go get github.com/aiqa/client-go</code></p>
      <p>In .env or otherwise, set the API key and server URL:</p>
      {apiKey ? (
        <p><code>AIQA_API_KEY=your-saved-api-key<br/>
AIQA_SERVER_URL={API_BASE_URL}</code></p>
      ) : (
        <p><code>AIQA_API_KEY=your-api-key<br/>
AIQA_SERVER_URL={API_BASE_URL}</code></p>
      )}
      {apiKey && (
        <p className="text-muted small mt-2">
          <strong>Note:</strong> Use the API key you saved when creating it. The key is only shown once during creation.
        </p>
      )}
      <h5>Initialize tracing and wrap functions with <code>WithTracing</code></h5>
      <pre><code>{`import (
    "context"
    "time"
    "github.com/aiqa/client-go"
)

func main() {
    // Initialize tracing
    err := aiqa.InitTracing("", "")
    if err != nil {
        panic(err)
    }
    defer func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        aiqa.ShutdownTracing(ctx)
    }()

    // Wrap a function with tracing
    multiply := func(x, y int) int {
        return x * y
    }
    tracedMultiply := aiqa.WithTracing(multiply).(func(int, int) int)
    
    result := tracedMultiply(5, 3)
}`}</code></pre>
      <h5>That's it!</h5>
      <p>For setting extra attributes and other features - please see <code>tracing.go</code> in the client-go library.</p>
    </div>
  );
}

function APICodeSetupPane({ apiKey }: { apiKey?: ApiKey }) {
  return (
    <div>
      <h5>API Integration Instructions</h5>
      {apiKey ? (
        <>
          <p>API Key ID: <code>{apiKey.id}</code></p>
          <p className="text-muted small mt-2">
            <strong>Note:</strong> Use the API key you saved when creating it. The key is only shown once during creation.
            Include it in the Authorization header as: <code>ApiKey &lt;your-saved-api-key&gt;</code>
          </p>
        </>
      ) : (
        <p>Your API key: <code>your-api-key</code></p>
      )}
    </div>
  );
}

export default CodeSetupPage;

