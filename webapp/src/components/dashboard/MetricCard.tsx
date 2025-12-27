import React from 'react';
import { Card, CardBody } from 'reactstrap';

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value }) => {
  return (
    <Card>
      <CardBody>
        <h6 className="text-muted mb-1">{label}</h6>
        <h4>{value}</h4>
      </CardBody>
    </Card>
  );
};

export default MetricCard;

