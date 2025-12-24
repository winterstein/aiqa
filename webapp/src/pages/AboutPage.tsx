import React from 'react';
import { Container, Row, Col, Card, CardBody, CardHeader } from 'reactstrap';
import Logo from '../components/Logo';

const AboutPage: React.FC = () => {
  return (
    <Container className="mt-4">
      <Row>
        <Col>
          <div className="d-flex align-items-center mb-4">
            <Logo size={48} showText={true} />
          </div>
          <h1>About this App</h1>
        </Col>
      </Row>

      <Row className="mt-4">
        <Col md={8}>
          <Card>
            <CardHeader>
              <h5>Welcome to AIQA</h5>
            </CardHeader>
            <CardBody>
              <p>
                AIQA is a platform for evaluating and improving AI systems through experiments,
                datasets, and comprehensive metrics tracking.
              </p>
              <h6 className="mt-4">Features</h6>
              <ul>
                <li>Create and manage datasets for your AI models</li>
                <li>Run experiments to test different configurations</li>
                <li>Track metrics and performance over time</li>
                <li>Analyze traces and spans for debugging</li>
                <li>Compare results across different experiments</li>
              </ul>
              <h6 className="mt-4">Getting Started</h6>
              <p>
                Start by creating a dataset, then run experiments to evaluate your AI models.
                Use the metrics dashboard to track performance and identify areas for improvement.
              </p>
            </CardBody>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default AboutPage;

