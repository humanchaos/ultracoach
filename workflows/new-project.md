---
description: Create a new project with the standardized structure matching existing projects
---

# New Project Creation Workflow

When creating a **new TypeScript/Express API project**, follow this exact structure to match the established codebase pattern.

## Project Root Structure

```
<project-name>/
├── .env                    # Local environment (gitignored)
├── .env.example            # Template with documented variables
├── .gitignore              # Standard ignores
├── Dockerfile              # Production container
├── README.md               # Comprehensive project documentation
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
└── src/
    ├── index.ts            # Express app entry point
    ├── config.ts           # Environment configuration
    ├── clients/            # External API clients (Notion, Gemini, etc.)
    ├── routes/             # Express route handlers
    ├── services/           # Business logic
    └── types/              # TypeScript type definitions
```

---

## Notion Project Hub Setup

Every new project must also have a corresponding **Notion Project Hub** page in the Second Brain database. This provides the single source of truth for tasks, notes, and project context.

### Create the Project Hub Page

1. Create a new page in the **Second Brain** database
2. Set **Category** to `Project`
3. Set **Name** to the project name (e.g., "NEVER", "Earth Care Companion")
4. Add a matching **Tags** multi-select option with the same name

### Add the Context Callout

At the top of the page, add a **callout block** (blue background, 📊 emoji):
```
This project hub contains items tagged with "<PROJECT_NAME>"
```

### Add the ✅ Tasks Section

1. Add heading: `## ✅ Tasks`
2. Add a **Linked View** of the Second Brain database
3. Configure filters:
   - `Category` equals `Task`
   - `Tags` contains `<PROJECT_NAME>`
   - `Status` does not equal `Done`
4. Show columns: Title, Category, Priority, Status, Tags

### Add the 📝 Notes & Meetings Section

1. Add heading: `## 📝 Notes & Meetings`
2. Add a **Linked View** of the Second Brain database
3. Configure filters:
   - `Category` is any of: `Note`, `Meeting`, `Project`
   - `Tags` contains `<PROJECT_NAME>`
4. Sort by: `Created time` (Descending)
5. Show columns: Title, Category, Priority, Status, Tags

---

## Code Project Structure

## Step 1: Create Directory Structure

```bash
mkdir -p <project-name>/src/{clients,routes,services,types}
cd <project-name>
```

---

## Step 2: package.json

Create with these exact scripts and TypeScript configuration:

```json
{
  "name": "<project-name>",
  "version": "1.0.0",
  "description": "<Project description>",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js"
  },
  "keywords": [],
  "author": "",
  "license": "MIT",
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4"
  }
}
```

**Add project-specific dependencies as needed** (e.g., `@notionhq/client`, `@google/genai`)

---

## Step 3: tsconfig.json

Use this exact configuration:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Step 4: .gitignore

```
node_modules/
dist/
.env
*.log
.DS_Store
```

---

## Step 5: .env.example

Document all environment variables with setup instructions:

```bash
# <Service Name> Configuration
# Create at: <URL to get credentials>
<SERVICE_KEY>=<placeholder>

# Server port (default: 3000)
PORT=3000
```

---

## Step 6: Dockerfile

Standard Node.js production container:

```dockerfile
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for tsc)
RUN npm ci

# Copy source
COPY . .

# Build
RUN npm run build

# Remove devDependencies
RUN npm prune --production

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/index.js"]
```

---

## Step 7: src/config.ts

Centralized configuration with validation:

```typescript
import 'dotenv/config';

export const config = {
    // Add service-specific config objects here
    port: parseInt(process.env.PORT || '3000', 10),
} as const;

// Validate required config
export function validateConfig(): void {
    // Add required environment variable checks
    // Example:
    // if (!config.notion.token) {
    //     throw new Error('NOTION_TOKEN is required. Set it in your .env file.');
    // }
}
```

---

## Step 8: src/index.ts

Express app with standard patterns:

```typescript
import express from 'express';
import { config, validateConfig } from './config.js';

// Validate configuration on startup
try {
    validateConfig();
} catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : error);
    process.exit(1);
}

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
// app.use('/api', apiRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

// Start server
app.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
});
```

---

## Step 9: README.md Template

Use this structure for comprehensive documentation:

```markdown
# <PROJECT NAME>

<One-line description of what this API does>

## Features

- **Feature 1**: Description
- **Feature 2**: Description

## Setup

### 1. Prerequisites
<List external services/accounts needed>

### 2. Configure Environment

\`\`\`bash
cd <project-name>
cp .env.example .env
\`\`\`

Edit `.env` with your values.

### 3. Install and Run

\`\`\`bash
npm install
npm run dev
\`\`\`

## API Endpoints

### POST /endpoint-name

<Description of what it does>

\`\`\`bash
curl -X POST http://localhost:3000/endpoint-name | jq
\`\`\`

**Response:**
\`\`\`json
{
  "field": "value"
}
\`\`\`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |

## Safety Features

- **Feature 1**: Description
- **Feature 2**: Description

## License

MIT
```

---

## Final Step: Install and Verify

```bash
npm install
npm run dev
```

Verify the health endpoint works:
```bash
curl http://localhost:3000/health
```
