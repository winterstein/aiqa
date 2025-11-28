"use strict";
/**
 * ExperimentRunner - runs experiments on datasets and scores results
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExperimentRunner = void 0;
class ExperimentRunner {
    constructor(options) {
        this.scores = [];
        this.datasetId = options.datasetId;
        this.serverUrl = (options.serverUrl || process.env.AIQA_SERVER_URL).replace(/\/$/, '');
        this.apiKey = options.apiKey || process.env.AIQA_API_KEY || '';
        this.organisationId = options.organisationId;
    }
    /**
     * Fetch example inputs from the dataset
     */
    async getExampleInputs() {
        const params = new URLSearchParams();
        params.append('dataset_id', this.datasetId);
        if (this.organisationId) {
            params.append('organisation_id', this.organisationId);
        }
        params.append('limit', '10000'); // Fetch big - probably all the examples
        const response = await fetch(`${this.serverUrl}/input?${params.toString()}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `ApiKey ${this.apiKey}`
            }
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Failed to fetch example inputs: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const data = await response.json();
        return data.hits || [];
    }
    /**
     * Score an example result. Stores the score for later summary calculation.
     */
    async score(example, result) {
        // For now, return empty scores. In a real implementation, this would:
        // 1. Extract metrics from the dataset configuration
        // 2. Calculate scores based on example and result
        // 3. Store scores for summary calculation
        const scores = {};
        // Store the score for summary calculation
        this.scores.push({ example, result, scores });
        return scores;
    }
    /**
     * Run an engine function on all examples and score the results
     */
    async run(engine) {
        const examples = await this.getExampleInputs();
        for (const example of examples) {
            const input = example.input;
            const result = await Promise.resolve(engine(input));
            await this.score(example, result);
        }
    }
    /**
     * Get summary results aggregated from all scored examples
     */
    async getSummaryResults() {
        // Calculate summary statistics from all scores
        // For now, return a simple summary. In a real implementation, this would:
        // 1. Aggregate metrics across all examples
        // 2. Calculate statistics (mean, median, etc.)
        // 3. Return structured summary results
        if (this.scores.length === 0) {
            return [];
        }
        // Simple summary: count of examples
        const summary = {
            total_examples: this.scores.length,
            scored_examples: this.scores.length,
        };
        // If we have an experiment ID, we could fetch it from the server
        // For now, return the local summary
        return [summary];
    }
}
exports.ExperimentRunner = ExperimentRunner;
