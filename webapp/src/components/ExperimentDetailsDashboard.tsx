import React, { useMemo } from 'react';
import { Row, Col, Card, CardBody, CardHeader, Alert } from 'reactstrap';
import { useQuery } from '@tanstack/react-query';
import { getDataset } from '../api';
import type Dataset from '../common/types/Dataset';
import type { Metric } from '../common/types/Dataset';
import type Experiment from '../common/types/Experiment';
import Histogram, { createHistogram, type HistogramDataPoint } from './generic/Histogram';

type MetricDataResult = {
	metric: Metric;
	values: number[];
	histogram: HistogramDataPoint[];
	min: number;
	max: number;
	mean: number;
	count: number;
	unmeasuredCount: number;
};

/**
 * Process experiment results for each metric, extracting numerical values
 */
function processMetricData(metrics: Metric[], experiment: Experiment): MetricDataResult[] {
	const results = experiment.results || [];
	const totalResults = results.length;
	
	return metrics.map((metric: Metric) => {
		const values: number[] = [];
		
		results.forEach((result) => {
			const score = result.scores?.[metric.name];
			if (score !== undefined && score !== null) {
				const numericValue = typeof score === 'number' ? score : 
					(typeof score === 'string' && !isNaN(parseFloat(score)) ? parseFloat(score) : null);
				
				if (numericValue !== null && !isNaN(numericValue) && isFinite(numericValue)) {
					values.push(numericValue);
				}
			}
		});
		
		const count = values.length;
		const unmeasuredCount = totalResults - count;
		
		let min = 0;
		let max = 0;
		let mean = 0;
		let histogram: HistogramDataPoint[] = [];
		
		if (values.length > 0) {
			min = Math.min(...values);
			max = Math.max(...values);
			mean = values.reduce((sum, val) => sum + val, 0) / values.length;
			histogram = createHistogram(values);
		}
		
		return {
			metric,
			values,
			histogram,
			min,
			max,
			mean,
			count,
			unmeasuredCount,
		};
	});
}

/**
 * Similar to ExperimentListMetricsDashboard, but for a single experiment
 
 * For each metric (with some numerical data):
 * Show a histogram of the scores for that metric.
 * Plus min, max, mean
 * If count < results.length - give the unmeasured count.
 * 
 * If no numerical data, show a message saying so.
 * 
 */
export default function ExperimentDetailsDashboard({ experiment }: { experiment: Experiment }) {
	const { data: dataset, isLoading, error } = useQuery({
		queryKey: ['dataset', experiment.dataset],
		queryFn: () => getDataset(experiment.dataset),
		enabled: !!experiment.dataset,
	});

	// Get metrics from dataset, or extract from results if dataset not available
	const metrics = useMemo(() => {
		const datasetMetrics = dataset?.metrics || [];
		const resultMetrics = new Set<string>();
		
		// Also collect metrics from results
		if (experiment.results) {
			experiment.results.forEach(result => {
				if (result.scores) {
					Object.keys(result.scores).forEach(metricName => {
						resultMetrics.add(metricName);
					});
				}
			});
		}
		
		// Combine dataset metrics with result metrics
		const metricMap = new Map<string, Metric>();
		datasetMetrics.forEach(metric => {
			metricMap.set(metric.name, metric);
		});
		
		resultMetrics.forEach(metricName => {
			if (!metricMap.has(metricName)) {
				metricMap.set(metricName, { name: metricName, type: 'number' });
			}
		});
		
		return Array.from(metricMap.values());
	}, [dataset?.metrics, experiment.results]);

	// Process data for each metric
	const metricData = useMemo(() => {
		return processMetricData(metrics, experiment);
	}, [metrics, experiment]);

	if (isLoading) {
		return (
			<Alert color="info" className="mt-3">
				Loading dataset...
			</Alert>
		);
	}

	if (error) {
		return (
			<Alert color="warning" className="mt-3">
				Could not load dataset, but showing metrics from results.
			</Alert>
		);
	}

	if (metrics.length === 0) {
		return (
			<Alert color="info" className="mt-3">
				No metrics found. Add metrics to the dataset or ensure results contain scores.
			</Alert>
		);
	}

	// Filter to only metrics with numerical data
	const metricsWithData = metricData.filter(md => md.count > 0);

	if (metricsWithData.length === 0) {
		return (
			<Alert color="info" className="mt-3">
				No numerical data found for any metrics. Ensure experiment results contain numeric scores.
			</Alert>
		);
	}

	// Calculate column width based on number of metrics
	const getColumnWidth = () => {
		if (metricsWithData.length <= 1) return 12;
		if (metricsWithData.length === 2) return 6;
		return 4; // 3 or more metrics
	};
	const colWidth = getColumnWidth();

	return (
		<Row className="mt-3">
			{metricsWithData.map(({ metric, histogram, min, max, mean, count, unmeasuredCount }) => (
				<Col md={colWidth} key={metric.name} className="mb-4">
					<MetricDataCard
						metric={metric}
						histogram={histogram}
						min={min}
						max={max}
						mean={mean}
						count={count}
						unmeasuredCount={unmeasuredCount}
						totalResults={experiment.results?.length || 0}
					/>
				</Col>
			))}
		</Row>
	);
}

/**
 * Show the info for one metric
 */
function MetricDataCard({ metric, histogram, min, max, mean, count, unmeasuredCount, totalResults }: {
	metric: Metric;
	histogram: HistogramDataPoint[];
	min: number;
	max: number;
	mean: number;
	count: number;
	unmeasuredCount: number;
	totalResults: number;
}) {
	return (
		<Card>
			<CardHeader>
				<h5>{metric.name}</h5>
				{metric.description && (
					<p className="text-muted small mb-0">{metric.description}</p>
				)}
				{metric.unit && (
					<span className="badge bg-secondary">{metric.unit}</span>
				)}
			</CardHeader>
			<CardBody>
				{histogram.length === 0 ? (
					<Alert color="warning" className="mb-0">
						No valid data points found for this metric.
					</Alert>
				) : (
					<>
						{unmeasuredCount > 0 && (
							<Alert color="warning" className="mb-2 small">
								{unmeasuredCount} of {totalResults} result{totalResults !== 1 ? 's' : ''} had missing or invalid values.
							</Alert>
						)}
						<Histogram data={histogram} />
						<div className="mt-3">
							<p className="mb-1">
								<strong>Statistics:</strong>
							</p>
							<ul className="list-unstyled mb-0">
								<li>Count: {count}</li>
								<li>Min: {min.toFixed(2)} {metric.unit || ''}</li>
								<li>Max: {max.toFixed(2)} {metric.unit || ''}</li>
								<li>Mean: {mean.toFixed(2)} {metric.unit || ''}</li>
							</ul>
						</div>
					</>
				)}
			</CardBody>
		</Card>
	);
}
