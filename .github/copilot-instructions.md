# AIQA - AI Quality Assurance System

## Repository Overview

AIQA is an AI Quality Assurance tracing system built on OpenTelemetry. It consists of:

- **Server**: TypeScript/Fastify API server that receives and stores OpenTelemetry traces
- **Web App**: React/TypeScript web application for viewing and analyzing traces
- **Client Libraries**: 
  - JavaScript/TypeScript client for Node.js applications
  - Python client for Python applications

## Technology Stack

### Server (`/server`)
- **Language**: TypeScript
- **Framework**: Fastify
- **Databases**:
  - ElasticSearch (for storing traces/spans)
  - PostgreSQL (for metadata: organizations, users, API keys, datasets, experiments)
- **Testing**: TAP (Test Anything Protocol)
- **Package Manager**: pnpm

### Web App (`/webapp`)
- **Language**: TypeScript
- **Framework**: React with Vite
- **UI Libraries**: Bootstrap, Reactstrap
- **State Management**: React Query (@tanstack/react-query) and rerenderer
- **Authentication**: Auth0
- **Package Manager**: pnpm
- **Note**: `src/common` is a symlink to `server/src/common` - shared code between server and webapp

### Client Libraries

#### JavaScript Client (`/client-js`)
- **Language**: TypeScript
- **Based on**: OpenTelemetry SDK
- **Package Manager**: npm

#### Python Client (`/client-python`)
- **Language**: Python 3.8+
- **Based on**: OpenTelemetry SDK
- **Package Manager**: pip

## Code Organization

### Server Structure
- `src/common/types/` - TypeScript type definitions (shared with webapp)
- `src/db_sql.ts` - PostgreSQL database operations
- `src/db_es.ts` - ElasticSearch database operations
- Use a single type per database table/index
- Type definitions belong in `Types.ts` files in the types directory
- Avoid code duplication - write reusable functions

### Web App Structure
- `src/common/` - Symlink to server's common directory (shared code)
- `src/app/` - Most pages and components

## Development Workflow

### Server
```bash
pnpm install           # Install dependencies
pnpm run build        # Compile TypeScript
pnpm run test         # Run tests
pnpm run dev          # Watch mode + auto-reload
pnpm run start        # Start production server
```

### Web App
```bash
pnpm install           # Install dependencies
pnpm run build        # Build for production
pnpm run dev          # Development server (port 4000)
pnpm run lint         # Run ESLint
```

### JavaScript Client
```bash
npm install           # Install dependencies
npm run build        # Compile TypeScript
npm start            # Run example
npm run dev          # Run with ts-node
```

### Python Client
```bash
pip install -r requirements.txt  # Install dependencies
pip install -e .                  # Install in development mode
python example.py                 # Run example
```

## API Architecture

### Multi-Tenant Design
- Organizations have members (users) and API keys
- API keys authenticate logging requests
- Each organization has rate limits and data retention periods
- Spans are tagged with organization ID

### RESTful Endpoints
- `/span` - ElasticSearch bulk insert for traces
- `/organisation` - PostgreSQL CRUD
- `/user` - PostgreSQL CRUD
- `/api-key` - PostgreSQL CRUD
- `/dataset` - PostgreSQL CRUD (with optional schema and metrics)
- `/input` - Copies of spans for datasets (ElasticSearch)
- `/experiment` - Experiment results (PostgreSQL)

### Query Syntax
- Use Gmail-style search syntax (see `SearchQuery.ts`)

## Coding Conventions

### TypeScript
- Keep types minimal - one type per database table/index
- Local utility types are acceptable for complex function parameters
- Avoid defining similar or overly simple types
- Type definitions go in `Types.ts` files in the types directory
- Write reusable code, avoid repetition

### React (Web App)
- Use `rerenderer` for JSON object state (API-served data editing)
- Use `useState` for local view parameters
- Use Reactstrap components where appropriate
- Support deep-linking URLs for all major views

### Python
- Follow PEP conventions
- Support both sync and async functions
- Use OpenTelemetry context propagation for nested spans

## Testing

### Server
- Testing framework: TAP
- Run with: `pnpm run test`
- Tests located in: `test/` directory

### Web App
- Linting: ESLint with TypeScript plugin
- Run with: `pnpm run lint`

### Python Client
- See `TESTING.md` for detailed testing instructions
- Development mode: `pip install -e .`
- Test without server (spans buffered locally)

## Authentication & Authorization

- Web app uses Auth0 for authentication
- API uses JWT tokens and API keys
- Multi-tenant with organization-based access control

## Key Features to Maintain

1. **OpenTelemetry Integration**: All clients use OpenTelemetry SDK
2. **Automatic Span Buffering**: Spans are buffered and auto-flushed (every 5 seconds)
3. **Thread Safety**: Span buffering is thread-safe
4. **Context Propagation**: Support for nested spans with proper parent-child relationships
5. **Error Tracking**: Automatic exception recording in spans
6. **Flexible Filtering**: Input/output filtering for sensitive data

## Environment Variables

### Server
- Database connection strings for PostgreSQL and ElasticSearch
- JWT/Auth0 configuration

### Clients
- `AIQA_SERVER_URL`: Server endpoint
- `AIQA_API_KEY`: Authentication key
- `OTEL_EXPORTER_OTLP_ENDPOINT`: Alternative OTLP endpoint

## Common Patterns

### Adding New Database Tables (Server)
1. Define type in appropriate `Types.ts`
2. Add schema creation in `db_sql.ts` or `db_es.ts`
3. Add CRUD operations
4. Create corresponding API endpoint

### Adding New Pages (Web App)
1. Create component in `src/app/`
2. Add route in router configuration
3. Support deep-linking URL structure
4. Use React Query for data fetching
5. Use rerenderer for complex state

### Adding Tracing to Applications
1. Import appropriate client library
2. Decorate functions with `@WithTracing` (Python) or equivalent
3. Configure server URL and API key
4. Optionally customize span names and filter I/O

## Important Notes

- **Package Manager**: Use `pnpm` for server and webapp, `npm` for client-js, `pip` for client-python
- **Shared Code**: Changes to `server/src/common/` affect both server and webapp
- **Type Safety**: Maintain TypeScript strict mode compliance
- **No Git Operations**: Do not add git hooks or modify git configuration
